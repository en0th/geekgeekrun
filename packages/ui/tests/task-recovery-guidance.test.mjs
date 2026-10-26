import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { transform } from 'esbuild'
import { reactive, ref as vueRef, watch } from 'vue'
import { taskRecoveryGuidance, runBudgetHasRoom } from '../src/common/task-recovery-guidance.mjs'

const AUTO = 'geekAutoStartWithBossMain'
const ref = value => ({ value })
const checkpoint = (extra = {}) => ({ runRecordId: 42, runMode: 'collect', exitCode: 0, messageSendPending: false,
  progress: { viewed: 3, collected: 2, sent: 0, log: [] }, ...extra })
const source = fs.readFileSync(new URL('../src/renderer/src/page/Ux/index.js', import.meta.url), 'utf8')
const shipped = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)))

test('a 150-person account-day ceiling offers results; a past day checks fresh usage before continuing', () => {
  const state = checkpoint({ runMode: 'chat', exitCode: 102, progress: { dailyQuota: { confirmed: 150, limit: 150, day: '2026-10-26' } } })
  const before = structuredClone(state)
  const atCap = taskRecoveryGuidance({ checkpoint: state, today: '2026-10-26' })
  assert.equal(atCap.primaryAction, 'results'); assert.equal(atCap.canContinue, false)
  assert.doesNotMatch(atCap.nextStep, /追加/)
  const tomorrow = taskRecoveryGuidance({ checkpoint: state, today: '2026-10-27' })
  assert.equal(tomorrow.primaryAction, 'daily-quota'); assert.match(tomorrow.primaryLabel, /检查今日/)
  assert.equal(tomorrow.canContinue, false); assert.deepEqual(state, before)
})

test('each known stop gives a concrete next action without changing the checkpoint or conditions', () => {
  const cases = [[0, 'continue'], [81, 'login'], [82, 'login'], [83, 'boss-site'], [84, 'boss-site'], [85, 'browser'],
    [88, 'preferences'], [89, 'boss-site'], [91, 'continue'], [93, 'boss-site'], [94, 'login'], [95, 'filters'],
    [97, 'data'], [98, 'data'], [99, 'browser'], [100, 'filters'], [101, 'browser'], [102, 'daily-quota'], [103, 'results'], [104, 'data']]
  for (const [exitCode, action] of cases) {
    const state = checkpoint({ exitCode }), before = structuredClone(state)
    const guide = taskRecoveryGuidance({ checkpoint: state, currentMode: 'collect' })
    assert.equal(guide.primaryAction, action, String(exitCode))
    assert.ok(guide.nextStep && guide.title)
    assert.doesNotMatch(guide.title, /退出码|JSON|IPC/)
    assert.deepEqual(state, before)
  }
})

test('verification waits for the same task window; unknown sends and safety stops never offer continuation', () => {
  const verification = taskRecoveryGuidance({ active: true, progress: { state: 'paused' } })
  assert.match(verification.nextStep, /任务|BOSS窗口/)
  assert.match(verification.nextStep, /自动继续/)
  assert.equal(verification.primaryAction, null)
  for (const state of [checkpoint({ exitCode: 87 }), checkpoint({ messageSendPending: true }), checkpoint({ recoveryReason: 'safety-guard' })]) {
    const guide = taskRecoveryGuidance({ checkpoint: state })
    assert.equal(guide.canContinue, false)
    assert.notEqual(guide.primaryAction, 'continue')
  }
  assert.equal(taskRecoveryGuidance({ task: 'follow', code: 87 }).canRestart, undefined)
  assert.equal(taskRecoveryGuidance({ task: 'follow', code: 91 }).primaryAction, 'restart')
  assert.equal(taskRecoveryGuidance({ task: 'follow', code: 96 }).primaryAction, 'feedback')
  assert.equal(taskRecoveryGuidance({ checkpoint: checkpoint({ recoveryReason: 'source-missing' }) }).primaryAction, 'sources')
})

test('a depleted budget stays paused until the current limits exceed every recorded usage value', () => {
  const usage = { requests: 500, detailRequests: 40, activeMs: 60000 }
  const limits = { requests: 500, detailRequests: 200, activeMinutes: 120 }
  assert.equal(runBudgetHasRoom(limits, usage), false)
  assert.equal(runBudgetHasRoom({ ...limits, requests: 501 }, usage), true)
  assert.equal(runBudgetHasRoom({ requests: 0, detailRequests: 0, activeMinutes: 0 }, usage), true)
  assert.equal(runBudgetHasRoom(limits, { ...usage, requests: '0' }), false)
  assert.equal(runBudgetHasRoom(limits, null), false)
  const state = checkpoint({ exitCode: 96, progress: { budget: { usage } } })
  assert.equal(taskRecoveryGuidance({ checkpoint: state, runBudget: limits }).primaryAction, 'limits')
  const ready = taskRecoveryGuidance({ checkpoint: state, runBudget: { ...limits, requests: 600 } })
  assert.equal(ready.primaryAction, 'continue')
  assert.equal(ready.canContinue, true)
  assert.equal(state.progress.budget.usage.requests, 500)
})

test('mode changes and unreadable task state have their own actions instead of a misleading continue button', () => {
  const mode = taskRecoveryGuidance({ checkpoint: checkpoint(), currentMode: 'chat' })
  assert.equal(mode.primaryAction, 'restore-mode')
  assert.equal(mode.canContinue, false)
  assert.equal(taskRecoveryGuidance({ checkpoint: checkpoint(), readError: true }).primaryAction, 'reload')
  assert.equal(taskRecoveryGuidance({ checkpoint: checkpoint(), readError: true }).secondaryAction, 'data')
  const service = taskRecoveryGuidance({ checkpoint: checkpoint(), readError: 'service', active: true })
  assert.equal(service.primaryLabel, '重新读取状态')
  assert.equal(service.secondaryAction, 'feedback')
  assert.equal(service.canContinue, false)
  assert.equal(taskRecoveryGuidance({ checkpoint: checkpoint({ runMode: 'chat', messageSendPending: true }), readError: true }).primaryAction, 'boss-chat')
})

test('running status uses the worker mode even when the next-run draft has changed', () => {
  const manager = { runningTasks: [{ workerId: AUTO, args: ['--run-record-id=42', '--run-mode=collect'] }], taskQueue: [], taskHistory: [] }
  const ctx = vm.createContext({ taskStore: manager, workerIds: { auto: AUTO }, taskProgress: ref({ auto: { runRecordId: 42 } }),
    autoResume: ref(checkpoint()), draft: ref({ runMode: 'chat' }) })
  vm.runInContext(shipped('    function runningMode(', '    async function resumeTask('), ctx)
  assert.equal(ctx.runningMode('auto'), 'collect')
  manager.runningTasks[0].args[1] = '--run-mode=chat'; ctx.draft.value.runMode = 'collect'
  assert.equal(ctx.runningMode('auto'), 'chat')
  assert.equal(ctx.runningMode('follow'), null)
})

test('task progress refreshes serialize, retain the last known counters on errors and recover on retry', async () => {
  const pending = []
  const ctx = vm.createContext({ ref, taskStore: { getRunningTasks: async () => {} }, workerIds: { auto: AUTO }, liveTasks: ref({}), pausedAutoRun: () => null,
    window: { electron: { ipcRenderer: { invoke: name => { assert.equal(name, 'get-auto-chat-resume'); return new Promise((resolve, reject) => pending.push({ resolve, reject })) } } } } })
  vm.runInContext(shipped('    const autoResume = ref(', '    R.watch('), ctx)
  const first = ctx.refreshResume(), second = ctx.refreshResume()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(pending.length, 1)
  pending[0].resolve(checkpoint()); await first; await new Promise(resolve => setImmediate(resolve))
  assert.equal(pending.length, 2)
  pending[1].reject(Error('fixture read error')); assert.equal(await second, false)
  assert.equal(vm.runInContext('autoResume.value.progress.collected', ctx), 2)
  assert.ok(vm.runInContext('resumeReadError.value', ctx))
  const retry = ctx.refreshResume(); await new Promise(resolve => setImmediate(resolve)); pending[2].resolve(checkpoint({ progress: { collected: 5 } })); await retry
  assert.equal(vm.runInContext('autoResume.value.progress.collected', ctx), 5)
  assert.equal(vm.runInContext('resumeReadError.value', ctx), '')
  ctx.taskStore.getRunningTasks = async () => { throw Error('fixture service failure') }
  assert.equal(await ctx.refreshResume(), false)
  assert.equal(vm.runInContext('resumeReadIssue.value', ctx), 'service')
  assert.equal(vm.runInContext('autoResume.value.progress.collected', ctx), 5)
})

test('real Vue watchers do not turn fresh status arrays into a refresh feedback loop', async t => {
  let calls = 0, currentId = 'part-42'
  const stops = [], manager = reactive({ ready: false, taskHistory: [] })
  manager.getRunningTasks = async () => {
    if (++calls > 4) throw Error('fixture feedback loop guard')
    manager.taskHistory = [{ workerId: AUTO, id: currentId }]
    manager.ready = true
  }
  const ctx = vm.createContext({ ref: vueRef, taskStore: manager, route: vueRef('auto'), running: vueRef({ auto: false }),
    queued: vueRef({ auto: false }), workerIds: { auto: AUTO }, liveTasks: vueRef({}), pausedAutoRun: () => null,
    window: { electron: { ipcRenderer: { invoke: async () => checkpoint() } } },
    R: { watch: (...args) => { stops.push(watch(...args)) } } })
  t.after(() => stops.forEach(stop => stop()))
  const start = source.indexOf('    const autoResume = ref(')
  const end = source.indexOf('    /** the paused 找岗位 run', start)
  vm.runInContext(source.slice(start, end), ctx)
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(calls <= 2, 'replacing history with equal values must not call refresh again')
  const before = calls
  currentId = 'part-43'; manager.taskHistory = [{ workerId: AUTO, id: currentId }]
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, before + 1, 'a new run part still refreshes even when history length is unchanged')
})

test('recovery actions open the right controls and restore only the task mode', async () => {
  const calls = [], state = checkpoint(), draft = { value: { runMode: 'chat', cities: ['深圳'], runBudget: { requests: 500 } } }
  const ctx = vm.createContext({ draft, pausedAutoRun: () => state, closeTaskDetail: () => calls.push('close'),
    navigate: async route => calls.push(route), goStep: step => calls.push(step), R: { nextTick() {} }, loadGlobalPace: async () => {},
    platformFiltersOpen: ref(false), runBudgetOpen: ref(false), browserOptionsOpen: ref(false), settingTab: ref(''),
    switchRunMode: async (value, mode) => { value.runMode = mode },
    resumeTask: () => assert.fail('a follow action cannot resume the finding task'), restartTask: task => calls.push('restart:' + task) })
  vm.runInContext(shipped('    async function recoveryAction(', '    function recoveryCard('), ctx)
  await ctx.recoveryAction('filters')
  assert.equal(ctx.platformFiltersOpen.value, true)
  assert.ok(calls.includes('job-preferences'))
  await ctx.recoveryAction('limits'); assert.equal(ctx.settingTab.value, 'pace'); assert.ok(calls.includes('settings'))
  await ctx.recoveryAction('browser'); assert.equal(ctx.settingTab.value, 'browser')
  await ctx.recoveryAction('data'); assert.equal(ctx.settingTab.value, 'data')
  await ctx.recoveryAction('restore-mode')
  assert.deepEqual(draft.value, { runMode: 'collect', cities: ['深圳'], runBudget: { requests: 500 } })
  await ctx.recoveryAction('continue', 'follow')
  assert.ok(calls.includes('restart:follow'))
})

test('a double-click during continuation prepares and dispatches the selected run only once', async () => {
  let finishLogin
  const calls = [], state = checkpoint()
  const ctx = vm.createContext({ preparing: ref(false), starting: ref(false), stopping: ref(false),
    taskStore: { taskHistory: [], getRunningTasks: async () => {} }, refreshResume: async () => true,
    pausedAutoRun: () => state, assertCheckpointCanResume() {}, draft: ref({ runMode: 'collect' }),
    recoveryGuide: () => ({ canContinue: true }), R: { message() {} },
    ensureBossLogin: () => new Promise(resolve => { finishLogin = resolve }),
    save: async () => { calls.push('save'); return true }, startTask: async (_task, _resume, id) => calls.push(id) })
  vm.runInContext(shipped('    async function resumeTask(', '    // pause keeps'), ctx)
  const first = ctx.resumeTask(); await new Promise(resolve => setImmediate(resolve)); await ctx.resumeTask()
  assert.equal(ctx.preparing.value, true)
  finishLogin(true); await first
  assert.deepEqual(calls, ['save', 42])
  assert.equal(ctx.preparing.value, false)
})

test('continuation does not switch to a different run discovered by the fresh read', async () => {
  let state = checkpoint()
  const messages = []
  const ctx = vm.createContext({ preparing: ref(false), starting: ref(false), stopping: ref(false),
    pausedAutoRun: () => state, taskStore: { getRunningTasks: async () => {} },
    refreshResume: async () => { state = checkpoint({ runRecordId: 43 }); return true }, R: { message: info => messages.push(info) },
    save: () => assert.fail('a different run cannot be saved'), startTask: () => assert.fail('a different run cannot be dispatched') })
  vm.runInContext(shipped('    async function resumeTask(', '    // pause keeps'), ctx)
  await ctx.resumeTask()
  assert.match(messages[0].message, /任务信息已更新/)
  assert.equal(ctx.preparing.value, false)
})

const ipc = fs.readFileSync(new URL('../src/main/flow/OPEN_SETTING_WINDOW/ipc/index.ts', import.meta.url), 'utf8')
async function recoveryHandler(text) {
  const normalized = text.replace(/\r\n/g, '\n')
  const begin = normalized.indexOf("  ipcMain.handle(\n    'run-geek-auto-start-chat-with-boss',")
  const end = normalized.indexOf('\n  // 任务详情', begin)
  assert.ok(begin >= 0 && end > begin, 'the shipped recovery IPC handler must be present')
  return (await transform(normalized.slice(begin, end), { loader: 'ts' })).code
}
const handlers = await Promise.all([ipc, ipc.replace(/\r?\n/g, '\r\n')].map(recoveryHandler))

test('the real IPC handler rejects stale task IDs and preserves unreadable checkpoints before creating a task', async () => {
  for (const handler of handlers) {
    let run, unreadable = false
    const calls = []
    const ctx = vm.createContext({ ipcMain: { handle: (_name, fn) => { run = fn } },
      readAutoChatResume: options => { assert.equal(options.strict, true); if (unreadable) throw Error('fixture corrupt checkpoint'); return checkpoint() },
      discardAutoChatResume: () => calls.push('discard'), runCommon: async () => { calls.push('dispatch'); return { runRecordId: 42 } },
      sendToDaemon: async () => ({ workers: [], queue: [] }), daemonEE: { on() {} } })
    vm.runInContext(handler, ctx)
    assert.equal(typeof run, 'function')
    await assert.rejects(run(null, { resume: true, runRecordId: 43 }), /任务信息已更新/)
    assert.deepEqual(calls, [])
    await run(null, { resume: true, runRecordId: 42 }); assert.deepEqual(calls, ['dispatch'])
    calls.length = 0; unreadable = true
    await assert.rejects(run(null), /fixture corrupt checkpoint/)
    assert.deepEqual(calls, [])
  }
})
