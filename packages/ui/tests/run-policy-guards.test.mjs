import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { transform } from 'esbuild'
import { policyRunConfig, normalizeRunPolicy } from '../../geek-auto-start-chat-with-boss/run-policy.mjs'
import { readRunSettings } from '../../geek-auto-start-chat-with-boss/run-settings.mjs'
import { jobConfigSnapshot } from '../../geek-auto-start-chat-with-boss/task-config-snapshot.mjs'
import { actualRunFacts } from '../src/common/run-config-facts.mjs'
import { AUTO_CHAT_ERROR_EXIT_CODE } from '../../run-core-of-geek-auto-start-chat-with-boss/enums.mjs'
const file = fs.readFileSync(new URL('../src/main/features/run-common.ts', import.meta.url), 'utf8')
const body = (await transform(file.slice(file.indexOf('let startLock:')).replace('export function', 'function'), { loader: 'ts' })).code
function fixture({ login = { status: 'valid', accountId: 'a' }, quotaError, runMode = 'chat', modeAfterSnapshot } = {}) {
  let worker = null, created = 0, dispatched = 0, snapshots = [], checkpointWrites = 0
  const ctx = vm.createContext({ AUTO_CHAT_ERROR_EXIT_CODE, readRunSettings, jobConfigSnapshot,
    readConfigFile: name => name === 'boss.json' ? { autoChatRunMode: runMode, autoChatRunInBackground: false } : {},
    checkBossLoginStatus: async () => login, readGlobalRunPolicy: () => normalizeRunPolicy({}),
    withGlobalRunPolicy: c => ({ ...c, 'boss.json': { ...c['boss.json'], ...policyRunConfig({}) } }),
    createDailyQuotaStore: () => ({ assert() { if (quotaError) throw quotaError } }),
    readAutoChatResume: () => null,
    saveAndGetCurrentRunRecord: async () => ({ data: { id: ++created } }),
    saveRunConfigSnapshot: async data => { snapshots.push(data); if (modeAfterSnapshot) runMode = modeAfterSnapshot },
    sendToDaemon: async m => { if (m.type === 'get-status') return { workers: worker ? [worker] : [] }; if (m.type === 'start-worker') { dispatched++; worker = { workerId: m.workerId, args: m.args } }; return {} },
    minimist: args => ({ 'run-record-id': args.find(a => a.startsWith('--run-record-id='))?.split('=')[1] }),
    process: { env: {}, argv: ['electron'] }, app: { isPackaged: true }, daemonEE: { on() {} },
    path: { join: (...a) => a.join('/') }, storageFilePath: '/isolated', runtimeFolderPath: '/isolated',
    normalizeJobSources() {}, writeTaskConfigSnapshot: () => '/isolated/1.json',
    createBudgetStore: () => ({ save() {} }), initializeAutoChatResume() { checkpointWrites++ } })
  vm.runInContext(body, ctx)
  return { workerArgs: () => worker?.args || [], start: options => ctx.runCommon({ mode: 'geekAutoStartWithBossMain', ...options }), inspect: () => ({ created, dispatched, snapshots, checkpointWrites }) }
}
test('login, account and daily-target failures preserve the old checkpoint and create no task', async () => {
  for (const [options, args, expected] of [
    [{ login: { status: 'unknown' } }, {}, /登录/],
    [{}, { expectedAccountId: 'b' }, /账号/],
    [{ quotaError: { detail: '已达到今日目标' } }, {}, /今日目标/],
  ]) {
    const f = fixture(options); await assert.rejects(f.start(args), expected)
    assert.deepEqual(f.inspect(), { created: 0, dispatched: 0, snapshots: [], checkpointWrites: 0 })
  }
})
test('two concurrent starts dispatch once and persist the authoritative account and global mode', async () => {
  const f = fixture(); const results = await Promise.all([f.start(), f.start()])
  assert.equal(f.inspect().dispatched, 1); assert.equal(f.inspect().created, 1)
  assert.equal(results[1].isAlreadyRunning, true)
  const config = f.inspect().snapshots[0].config.actualConfig['boss.json']
  assert.equal(config.autoChatExpectedAccountId, 'a'); assert.equal(config.autoChatRunInBackground, true)
  assert.equal(config.autoChatRunPolicy.profile, 'safe')
})
test('collect-only work ignores the greeting target and scheduled work retains its captured policy', async () => {
  const f = fixture({ runMode: 'collect', quotaError: Error('no more greetings') })
  await f.start({ expectedAccountId: 'a', capturedConfig: { 'boss.json': { autoChatRunMode: 'collect', ...policyRunConfig({ profile: 'deep' }) } } })
  const snap = f.inspect().snapshots[0].config.actualConfig
  assert.equal(snap['boss.json'].autoChatRunPolicy.profile, 'deep')
  assert.equal(Object.fromEntries(actualRunFacts(snap))['运行模式'], '深度模式')
})

for (const mode of ['collect', 'chat']) test(`dispatch keeps the frozen ${mode} mode after another window changes saved settings`, async () => {
  const changed = mode === 'collect' ? 'chat' : 'collect'
  const f = fixture({ runMode: mode, modeAfterSnapshot: changed })
  await f.start()
  const frozen = f.inspect().snapshots[0].config.actualConfig['boss.json']
  assert.equal(frozen.autoChatRunMode, mode)
  assert.ok(f.workerArgs().includes('--run-mode=' + mode), 'history and worker mode must match the persisted task snapshot')
  assert.equal(f.inspect().created, 1)
  assert.equal(f.inspect().checkpointWrites, 1)
})
