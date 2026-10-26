import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { transform } from 'esbuild'
import { normalizeRunPolicy, ACCOUNT_DAILY_CHAT_LIMIT } from '../../geek-auto-start-chat-with-boss/run-policy.mjs'

const mainSource = fs.readFileSync(new URL('../src/main/features/run-policy.ts', import.meta.url), 'utf8')
const mainBody = (await transform(mainSource.slice(mainSource.indexOf('export function readGlobalRunPolicy')).replace(/^export /gm, ''), { loader: 'ts' })).code
function mainFixture({ midnight = false, loginAccount = 'a', saved = { dailyLimit: 130 } } = {}) {
  let day = '2026-10-26', mutations = []
  const ctx = vm.createContext({ normalizeRunPolicy, RUN_POLICY_FILE: 'run-policy.json', storageFilePath: '/offline',
    readConfigFile: () => saved, writeConfigFile: async (name, value) => mutations.push(['save', name, value.dailyLimit]),
    dayKey: () => day, checkBossLoginStatus: async () => { if (midnight) day = '2026-10-27'; return { status: 'valid', accountId: loginAccount } },
    sendToDaemon: async () => ({ workers: [], queue: [] }),
    createDailyQuotaStore: () => ({ addToday: (...args) => mutations.push(['add', ...args]), acknowledgePending: (...args) => mutations.push(['ack', ...args]), status: () => ({}) }),
  })
  vm.runInContext(mainBody, ctx)
  return { ctx, mutations }
}

test('main process accepts legacy policy without rewriting it and validates new saves at 150', async () => {
  const { ctx, mutations } = mainFixture({ saved: { profile: 'deep', dailyLimit: 900 } })
  assert.equal(ctx.readGlobalRunPolicy().dailyLimit, 150)
  assert.equal(ctx.readGlobalRunPolicy().profile, 'deep')
  assert.equal(mutations.length, 0)
  await assert.rejects(ctx.saveGlobalRunPolicy({ dailyLimit: 151 }), /1—150/)
  assert.equal(mutations.length, 0)
})

test('direct saves of zero or over-limit targets explain the reason and cannot change the saved configuration', async () => {
  const { ctx, mutations } = mainFixture()
  for (const dailyLimit of [0, 151, 300]) {
    await assert.rejects(ctx.saveGlobalRunPolicy({ dailyLimit }), dailyLimit === 0 ? /没有可用的自动打招呼数量/ : /单个账号.*150/)
    assert.equal(mutations.length, 0)
    assert.equal(ctx.readGlobalRunPolicy().dailyLimit, 130)
  }
})

test('a login check crossing midnight cannot apply yesterday additions or acknowledgements to today', async () => {
  for (const action of ['add', 'ack']) {
    const { ctx, mutations } = mainFixture({ midnight: true })
    const call = action === 'add' ? ctx.addDailyQuota(10, 'a', '2026-10-26') : ctx.acknowledgeDailyPending('a', '2026-10-26', 1)
    await assert.rejects(call, /日期已变化/); assert.equal(mutations.length, 0)
  }
})

test('additions verify the account and use the current global target rather than a task snapshot', async () => {
  const wrong = mainFixture({ loginAccount: 'b' })
  await assert.rejects(wrong.ctx.addDailyQuota(10, 'a', '2026-10-26'), /账号已变化/)
  assert.equal(wrong.mutations.length, 0)
  const valid = mainFixture()
  await valid.ctx.addDailyQuota(20, 'a', '2026-10-26')
  assert.deepEqual(valid.mutations, [['add', 'a', 20, 130]])
})

const renderer = fs.readFileSync(new URL('../src/renderer/src/page/Ux/index.js', import.meta.url), 'utf8')
const start = renderer.indexOf('    async function addTodayQuota(')
const actionBody = renderer.slice(start, renderer.indexOf('    async function acknowledgeDaily(', start))
function uiFixture(info) {
  const messages = [], prompts = [], calls = []
  const ctx = vm.createContext({ ACCOUNT_DAILY_CHAT_LIMIT, loadDailyQuota: async () => info,
    pausedAutoRun: () => ({ runState: { accountId: 'a' } }), R: { message: x => messages.push(x) },
    dailyInfo: { value: null }, ipc: async (name, value) => { calls.push([name, value]); return info }, resumeTask: async () => calls.push(['resume']),
    ElMessageBox: { prompt: async (text, title, options) => { prompts.push({ text, title, options }); return { value: options.inputValue } } },
  })
  vm.runInContext(actionBody, ctx)
  return { run: () => ctx.addTodayQuota(true), messages, prompts, calls }
}

test('goal recovery prompts only within the 150 ceiling and validates exact remaining software headroom', async () => {
  const fixture = uiFixture({ available: true, accountId: 'a', day: '2026-10-26', confirmed: 145, limit: 145, remaining: 0 })
  await fixture.run()
  assert.equal(fixture.prompts[0].options.inputValue, '5')
  const validate = fixture.prompts[0].options.inputValidator
  assert.equal(validate('5'), true)
  for (const value of ['6', '', '-1', '2.5', 'NaN']) assert.notEqual(validate(value), true)
  assert.equal(fixture.calls[0][0], 'daily-quota-add'); assert.equal(fixture.calls[0][1].amount, 5)
  assert.equal(fixture.calls[1][0], 'resume')
})

test('platform exhaustion, ceiling, pending sends and account changes never offer an addition or resume', async () => {
  for (const override of [{ platformExhausted: true }, { confirmed: 150, limit: 150 }, { pendingCount: 1 }, { accountId: 'b' }]) {
    const f = uiFixture({ available: true, accountId: 'a', confirmed: 100, limit: 100, remaining: 0, ...override })
    await f.run(); assert.equal(f.prompts.length, 0); assert.equal(f.calls.length, 0); assert.equal(f.messages.length, 1)
  }
})

test('a fresh day with available allowance resumes through the checked path without adding anything', async () => {
  const f = uiFixture({ available: true, accountId: 'a', confirmed: 0, limit: 130, remaining: 130 })
  await f.run(); assert.equal(f.prompts.length, 0); assert.deepEqual(f.calls, [['resume']])
})
