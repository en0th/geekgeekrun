import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createAutomaticRetry, retryProblem } from '../automatic-retry.mjs'
import { taskBrowserError } from '../browser-health.mjs'
import { beginBrowserAttempt, abortBrowserAttempt, sleep as attemptSleep } from '../attempt-sleep.mjs'

function fixture({ pending = () => false, prepare = async () => {}, stopAfter = Infinity } = {}) {
  let clock = 0, progress = 24, waits = 0
  const states = [], calls = []
  const retry = createAutomaticRetry({ prepare: async () => { calls.push('prepare'); await prepare() },
    sendPending: pending, now: () => clock, progressKey: () => progress,
    isStopping: () => waits >= stopAfter, sleep: async ms => { clock += ms; waits++ }, publish: state => states.push(state) })
  return { retry, states, calls, advance: () => progress++, time: () => clock }
}

test('transport, page loading and unknown read responses retry; decisive platform and sending failures do not', () => {
  for (const error of [taskBrowserError('network'), taskBrowserError('crashed'), taskBrowserError('closed'), taskBrowserError('site', { httpStatus: 503 }),
    Error('net::ERR_CONNECTION_RESET'), Error('AUTO_CHAT_DETAIL_NOT_READY'), Error('AUTO_CHAT_LIST_STALLED'), Error('LOGIN_STATUS_UNKNOWN')]) {
    assert(retryProblem(error), error.message); assert.equal(retryProblem(error, { sendPending: true }), null)
  }
  for (const message of ['LOGIN_STATUS_INVALID', 'LOGIN_STATUS_RESTRICTED', 'AUTO_CHAT_SECURITY_CHECK', 'AUTO_CHAT_ACCOUNT_CHANGED', 'AUTO_CHAT_MESSAGE_SEND_UNCONFIRMED',
    'AUTO_CHAT_DAILY_GOAL_REACHED', 'AUTO_CHAT_DAILY_PLATFORM_LIMIT', 'AUTO_CHAT_RUN_BUDGET_EXCEEDED', 'AUTO_CHAT_RUN_BUDGET_UNAVAILABLE', 'AUTO_CHAT_ALL_SOURCES_ROTATED', 'AUTO_CHAT_REQUIRED_CONDITION_CHAT_BLOCKED']) assert.equal(retryProblem(Error(message)), null)
  assert.equal(retryProblem(taskBrowserError('executable')), null)
  assert.equal(retryProblem(taskBrowserError('certificate')), null)
  assert.equal(retryProblem(taskBrowserError('site', { httpStatus: 404 })), null)
  assert.equal(retryProblem(Object.assign(Error('ERR_CONNECTION_RESET'), { code: 'GGR_FILE_WRITE_FAILED' })), null)
})

test('a long outage keeps the same task waiting, caps the delay at two minutes, and progress resets the backoff', async () => {
  const f = fixture()
  for (let i = 0; i < 12; i++) assert.equal(await f.retry.recover(taskBrowserError('network')), true)
  assert.deepEqual(f.states.filter(s => s.until).map(s => s.delayMs), [5000, 15000, 30000, 60000, ...Array(8).fill(120000)])
  f.advance(); await f.retry.recover(Error('AUTO_CHAT_DETAIL_NOT_READY'))
  assert.equal(f.states.at(-2).delayMs, 5000); assert.equal(f.states.at(-2).attempt, 1)
})

test('manual stop cancels an outage wait without reconnecting; pending sends are never retried', async () => {
  const cancelled = fixture({ stopAfter: 1 })
  assert.equal(await cancelled.retry.recover(taskBrowserError('network')), false)
  assert.equal(cancelled.time(), 1000); assert.equal(cancelled.states.length, 1)
  const pending = fixture({ pending: () => true })
  assert.equal(await pending.retry.recover(taskBrowserError('network')), false)
  assert.equal(pending.calls.length, 0)
  let inFlight = false
  const raced = fixture({ pending: () => inFlight, prepare: async () => { inFlight = true } })
  await assert.rejects(raced.retry.recover(taskBrowserError('network')), /SEND_UNCONFIRMED/)
  assert.equal(raced.states.length, 0)
})

test('failed checkpoint writes propagate; repeated filter failures get three reapplication attempts without loosening conditions', async () => {
  const failed = fixture({ prepare: async () => { throw Object.assign(Error('cannot save'), { code: 'GGR_FILE_WRITE_FAILED' }) } })
  await assert.rejects(failed.retry.recover(taskBrowserError('network')), /cannot save/)
  assert.equal(failed.states.length, 0)
  const filters = fixture()
  for (let i = 0; i < 3; i++) assert.equal(await filters.retry.recover(Error('AUTO_CHAT_CITY_FILTER_NOT_APPLIED')), true)
  assert.equal(await filters.retry.recover(Error('AUTO_CHAT_CITY_FILTER_NOT_APPLIED')), false)
  assert.equal(filters.calls.length, 3)
})

test('closing a browser attempt cancels a long rest before a replacement can start', async () => {
  beginBrowserAttempt()
  const old = attemptSleep(60 * 60 * 1000)
  abortBrowserAttempt(); await assert.rejects(old, /ATTEMPT_CLOSED/)
  beginBrowserAttempt(); await attemptSleep(1); abortBrowserAttempt()
})

test('automatic browser preparation waits for old work and preserves cursor, block lists, identity and spent usage', async () => {
  const source = fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8')
  const code = source.slice(source.indexOf('export async function prepareForAutomaticRetry'), source.indexOf('\nfunction ensureRunBudget')).replace('export ', '')
  const old = { accountId: 'a', position: { sourceIndex: 1, filterConditionIndex: 7, sourceSuccessCount: 14, noMatchStreak: 3 }, blockedJobs: [['j1', null]], budget: { usage: { requests: 37, detailRequests: 24, activeMs: 10000 } } }
  let settle, restored
  const work = new Promise(resolve => { settle = resolve }), calls = []
  const ctx = vm.createContext({ hasLiveTaskBrowser: () => false, keepBrowserForRecovery: false, exportRunState: () => structuredClone(old), closeBrowserWindow: async () => { calls.push('close'); settle() },
    importRunState: state => { calls.push('restore'); restored = state }, jobRequestBudgetMonitor: null, work, spent: old.budget })
  vm.runInContext('let runBudget = { snapshot: () => spent }, browserAttemptWork = work;\n' + code, ctx)
  await ctx.prepareForAutomaticRetry()
  assert.deepEqual(calls, ['close', 'restore']); assert.deepEqual(restored, old)
  assert.equal(vm.runInContext('runBudget', ctx), null)
})

test('the actual GUI worker loop recovers network and detail faults without exiting or replacing its task', async () => {
  const source = fs.readFileSync(new URL('../../ui/src/main/flow/GEEK_AUTO_START_CHAT_WITH_BOSS_MAIN/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const { transform } = await import('esbuild')
  const body = source.slice(source.indexOf('  const automaticRetry ='), source.indexOf('\n}\n\nexport const waitForProcessHandShakeAndRunAutoChat'))
  const js = (await transform('(async () => {' + body + '})()', { loader: 'ts' })).code
  let stopped = false, attempts = 0, clock = 0
  const snapshots = [], statuses = [], prepared = []
  const progress = { viewed: 24, sent: 14, collected: 24 }
  const ctx = vm.createContext({ Error, shutdown: { isStopping: () => stopped }, messageSendPending: false,
    prepareForAutomaticRetry: async () => prepared.push('close-and-preserve'),
    createAutomaticRetry: options => createAutomaticRetry({ ...options, now: () => clock, sleep: async ms => { clock += ms } }),
    taskProgress: { progress, setExtras: extras => Object.assign(progress, extras), update: (_kind, detail, state) => statuses.push({ detail, state }) },
    saveResume: () => snapshots.push({ viewed: progress.viewed, sent: progress.sent }), stopForStorage: async () => false, stopForBudget: async () => false,
    hooks: {}, mainLoop: async () => { if (++attempts === 1) throw taskBrowserError('network'); if (attempts === 2) throw Error('AUTO_CHAT_DETAIL_NOT_READY'); stopped = true; throw Error('fixture end') },
    console: { error() {} }, process: { exit: () => assert.fail('the recoverable task must not exit') },
  })
  await vm.runInContext(js, ctx)
  assert.equal(attempts, 3); assert.equal(prepared.length, 2)
  assert.equal(clock, 20000); assert(snapshots.every(s => s.viewed === 24 && s.sent === 14))
  assert(statuses.every(s => s.state === 'retrying'))
})

test('the actual CLI loop uses the same delayed recovery and stops a pending-send failure', async () => {
  const source = fs.readFileSync(new URL('../../run-core-of-geek-auto-start-chat-with-boss/main.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const body = source.slice(source.indexOf('  let sendPending ='), source.lastIndexOf('\n}\n\n(async'))
  const { EventEmitter } = await import('node:events')
  for (const pending of [false, true]) {
    const events = new EventEmitter(), exits = []
    let stopped = false, calls = 0, clock = 0
    const ctx = vm.createContext({ Error, autoStartChatEventBus: events, hooks: {}, shutdown: { isStopping: () => stopped },
      createAutomaticRetry: options => createAutomaticRetry({ ...options, now: () => clock, sleep: async ms => { clock += ms } }),
      prepareForAutomaticRetry: async () => {}, closeBrowserWindow: async () => {},
      mainLoop: async () => { if (++calls === 1) { if (pending) events.emit('CHAT_CONFIRMATION', true); throw taskBrowserError('network') } stopped = true; throw Error('fixture end') },
      AUTO_CHAT_ERROR_EXIT_CODE: { MESSAGE_SEND_UNCONFIRMED: 87 }, console: { log() {}, error() {} },
      process: { exit: code => exits.push(code) },
    })
    await vm.runInContext('(async () => {' + body + '})()', ctx)
    assert.equal(calls, pending ? 1 : 2); assert.equal(clock, pending ? 0 : 5000)
    assert.deepEqual(exits, pending ? [87] : [])
  }
})
