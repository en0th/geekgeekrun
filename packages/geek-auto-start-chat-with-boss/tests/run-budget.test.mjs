import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRunBudget, normalizeBudgetUsage, RUN_BUDGET_TICK_MS } from '../run-budget.mjs'
import { budgetStateError } from '../run-budget.mjs'
import { createBudgetStore } from '../run-budget-store.mjs'
import { DEFAULT_RUN_BUDGET, MAX_RUN_BUDGET, normalizeRunBudget, readRunSettings } from '../run-settings.mjs'
import { validateJobFilterConfig } from '../job-filter-config.mjs'

const limits = (extra = {}) => ({ requests: 3, detailRequests: 2, activeMinutes: 1, ...extra })
function clockBudget(options = {}) {
  let time = 0, tick = null, saved = null
  const budget = createRunBudget({ limits: limits(), now: () => time, setTimer: fn => { tick = fn; return 1 }, clearTimer: () => { tick = null },
    persist: state => { saved = structuredClone(state) }, ...options })
  return { budget, advance: ms => { time += ms }, tick: () => tick?.(), saved: () => saved }
}

test('budget settings have finite defaults, explicit zero, and strict validation before saving', () => {
  assert.deepEqual(normalizeRunBudget(), DEFAULT_RUN_BUDGET)
  assert.deepEqual(normalizeRunBudget({ requests: '4', detailRequests: 0, activeMinutes: null }), { requests: 4, detailRequests: 0, activeMinutes: 120 })
  for (const value of [true, false, [], -1, ' ', 1.5, Infinity, NaN, 'invalid', MAX_RUN_BUDGET.requests + 1]) {
    assert.throws(() => normalizeRunBudget({ requests: value }), /预算/)
    assert.throws(() => validateJobFilterConfig({ autoChatRunBudget: { requests: value } }), /预算/)
  }
  for (const value of [null, 3, 'abc', []]) assert.throws(() => normalizeRunBudget(value), /预算/)
  assert.deepEqual(normalizeBudgetUsage(null), { requests: 0, detailRequests: 0, activeMs: 0 })
  for (const value of [{}, { requests: 1, detailRequests: 2, activeMs: 0 }, { requests: -1, detailRequests: 0, activeMs: 0 }])
    assert.throws(() => normalizeBudgetUsage(value), /RUN_BUDGET_UNAVAILABLE/)
})

test('request limits charge attempts including failed/repeated requests and never allow N+1', () => {
  const { budget, saved } = clockBudget()
  budget.resume()
  budget.reserveRequest('list')
  budget.reserveRequest('list')
  budget.reserveRequest('detail')
  assert.deepEqual(budget.snapshot().usage, { requests: 3, detailRequests: 1, activeMs: 0 })
  assert.equal(saved().usage.requests, 3)
  assert.throws(() => budget.reserveRequest('detail'), /RUN_BUDGET_EXCEEDED/)
  assert.equal(budget.snapshot().usage.requests, 3)
  assert.throws(() => budget.checkpoint(), /RUN_BUDGET_EXCEEDED/)
})

test('the detail limit stops further list and detail requests; zero disables individual limits', () => {
  const { budget } = clockBudget({ limits: limits({ requests: 0, detailRequests: 1 }) })
  budget.resume(); budget.reserveRequest('detail')
  assert.throws(() => budget.reserveRequest('list'), /RUN_BUDGET_EXCEEDED/)
  const unlimited = clockBudget({ limits: limits({ requests: 0, detailRequests: 0, activeMinutes: 0 }) })
  unlimited.budget.resume()
  for (let i = 0; i < 10; i++) unlimited.budget.reserveRequest('detail')
  unlimited.advance(100000000); unlimited.tick()
  assert.equal(unlimited.budget.snapshot().usage.requests, 10)
  unlimited.budget.pause()
})

test('waiting and rests consume time, paused/queued/security periods do not', async () => {
  const current = clockBudget(), { budget } = current
  budget.resume(); current.advance(20000); budget.pause()
  current.advance(1000000) // stopped or waiting in the task queue
  assert.equal(budget.snapshot().usage.activeMs, 20000)
  budget.resume(); current.advance(40000)
  await assert.rejects(budget.guard(() => Promise.resolve('must not run')), /RUN_BUDGET_EXCEEDED/)
  assert.equal(budget.snapshot().usage.activeMs, 60000)
  assert.equal(budget.snapshot().running, false)
})

test('the time watchdog interrupts a long wait even without another job checkpoint', async () => {
  const current = clockBudget(), { budget } = current
  budget.resume()
  const blocked = budget.guard(() => new Promise(() => {}))
  await Promise.resolve()
  current.advance(60000); current.tick()
  await assert.rejects(blocked, /RUN_BUDGET_EXCEEDED/)
  assert.equal(current.saved().usage.activeMs, 60000)
})

test('durable usage survives abrupt restart, stale progress and changed source scope', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-budget-'))
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }))
  const store = createBudgetStore(folder, 42)
  const first = clockBudget({ persist: store.save })
  first.budget.resume(); first.advance(1450); first.budget.reserveRequest('detail')
  const disk = store.load()
  assert.equal(disk.usage.requests, 1)
  assert.equal(disk.usage.activeMs, 1450 + RUN_BUDGET_TICK_MS)
  const second = clockBudget({ saved: disk, seed: { usage: { requests: 0, detailRequests: 0, activeMs: 0 } }, persist: store.save })
  second.budget.resume(); second.budget.reserveRequest('list')
  assert.equal(second.budget.snapshot().usage.requests, 2)
  second.budget.pause()
  const third = clockBudget({ saved: store.load(), persist: store.save })
  third.budget.resume(); third.budget.reserveRequest('list')
  assert.throws(() => third.budget.checkpoint(), /RUN_BUDGET_EXCEEDED/)
  assert.equal(store.load().usage.requests, 3)
  // Raising limits permits more work; spent amounts never go down.
  const raised = clockBudget({ saved: store.load(), limits: limits({ requests: 4 }), persist: store.save })
  raised.budget.resume(); raised.budget.reserveRequest('list')
  assert.equal(store.load().usage.requests, 4)
  raised.budget.pause()
})

test('normal pauses save exact time while repeated resume and heartbeats do not double charge', () => {
  const current = clockBudget()
  current.budget.resume(); current.budget.resume(); current.advance(1234); current.tick(); current.tick()
  assert.equal(current.budget.snapshot().usage.activeMs, 1234)
  assert.equal(current.saved().usage.activeMs, 2234)
  current.budget.pause(); current.budget.pause()
  assert.equal(current.saved().usage.activeMs, 1234)
})

test('a damaged or mismatched journal fails closed without overwriting it', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-budget-bad-'))
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }))
  const store = createBudgetStore(folder, 5)
  const file = path.join(folder, 'auto-chat-run-budgets/5.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  for (const content of ['{', '{"version":1,"runRecordId":6,"usage":{}}', '{"version":1,"runRecordId":5}']) {
    fs.writeFileSync(file, content)
    assert.throws(() => store.load(), /RUN_BUDGET_UNAVAILABLE/)
    assert.equal(fs.readFileSync(file, 'utf8'), content)
  }
  for (const id of ['../5', -1, 0.5]) assert.throws(() => createBudgetStore(folder, id), /RUN_BUDGET_UNAVAILABLE/)
})

test('persistence failure stops before another request can be reserved', async () => {
  let fail = false
  const { budget } = clockBudget({ persist: () => { if (fail) throw Error('disk full') } })
  budget.resume(); fail = true
  assert.throws(() => budget.reserveRequest('list'), /RUN_BUDGET_UNAVAILABLE/)
  await assert.rejects(budget.guard(() => 'must not run'), /RUN_BUDGET_UNAVAILABLE/)
})

test('a slow durable write cannot release a request after its time budget expires', () => {
  let current
  current = clockBudget({ persist: state => { if (state.usage.requests) current.advance(60001) } })
  current.budget.resume()
  assert.throws(() => current.budget.reserveRequest('list'), /RUN_BUDGET_EXCEEDED/)
  assert.equal(current.budget.snapshot().usage.requests, 1, 'the interrupted reservation stays charged')
  assert.equal(current.budget.snapshot().stopped, true)
})

test('legacy resumes disclose unknown prior usage; an existing journal takes precedence', () => {
  const legacy = clockBudget({ legacy: true })
  assert.equal(legacy.budget.snapshot().baselineUnknown, true)
  const known = clockBudget({ legacy: true, saved: { usage: { requests: 2, detailRequests: 1, activeMs: 9000 } } })
  assert.equal(known.budget.snapshot().baselineUnknown, false)
  assert.equal(known.budget.snapshot().usage.requests, 2)
})

test('the core refuses a missing resume journal and restores spent amounts with either CLI argument form', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-budget-core-'))
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }))
  const core = fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8')
  const code = core.slice(core.indexOf('function ensureRunBudget ()'), core.indexOf('export function pauseRunBudget'))
  const usage = { requests: 3, detailRequests: 1, activeMs: 7000 }
  for (const args of [['--run-record-id=42'], ['--run-record-id', '42']]) {
    const context = vm.createContext({ createBudgetStore, createRunBudget, budgetStateError, readRunSettings,
      readConfigFile: () => ({ autoChatRunBudget: limits() }), storageFilePath: folder,
      process: { argv: ['node', 'script', ...args], once() {} }, autoStartChatEventBus: { emit() {} }, seed: { usage } })
    vm.runInContext('let runBudget = null, pendingBudgetSeed = seed, legacyBudgetSeed = false;\n' + code, context)
    const store = createBudgetStore(folder, 42)
    const file = path.join(folder, 'auto-chat-run-budgets/42.json')
    fs.rmSync(file, { force: true })
    assert.throws(() => context.ensureRunBudget(), /RUN_BUDGET_UNAVAILABLE/)
    store.save({ usage, baselineUnknown: false })
    const budget = context.ensureRunBudget()
    assert.equal(budget.snapshot().usage.requests, 3)
    assert.throws(() => budget.resume(), /RUN_BUDGET_EXCEEDED/)
  }
})
