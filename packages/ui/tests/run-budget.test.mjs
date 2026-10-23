import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { transform } from 'esbuild'
import { DEFAULT_RUN_BUDGET, MAX_RUN_BUDGET, normalizeRunBudget, readRunSettings } from '../../geek-auto-start-chat-with-boss/run-settings.mjs'
import { normalizeJobSources } from '../../geek-auto-start-chat-with-boss/search-source.mjs'
import { AUTO_CHAT_ERROR_EXIT_CODE } from '../../run-core-of-geek-auto-start-chat-with-boss/enums.mjs'
import { assertCheckpointCanResume } from '../src/common/task-recovery.mjs'

const source = fs.readFileSync(new URL('../src/renderer/src/page/Ux/index.js', import.meta.url), 'utf8')
const flat = node => !node ? [] : Array.isArray(node) ? node.flatMap(flat) : [node, ...flat(node.children)]
test('the real budget form binds all three independent limits to the persisted draft', () => {
  const draft = { value: { runBudget: { requests: 12, detailRequests: 5, activeMinutes: 30 } } }
  const context = vm.createContext({ draft, DEFAULT_RUN_BUDGET, MAX_RUN_BUDGET, normalizeRunBudget,
    runBudgetOpen: { value: true }, budgetFact: () => '', explain: text => ({ text }),
    field: (label, children) => ({ label, children }), inline: children => ({ children }),
    h: (tag, props, children) => ({ tag, props, children }),
    update: (object, key, value) => { object[key] = value },
    disclosure: (_title, _state, _id, children) => ({ children }) })
  const start = source.indexOf('    function budgetControls()')
  vm.runInContext(source.slice(start, source.indexOf('    function platformControls()', start)), context)
  const fields = flat(context.budgetControls()).filter(item => item.tag === 'input')
  assert.deepEqual(fields.map(f => f.props.value), [12, 5, 30])
  for (const f of fields) { assert.equal(f.props.type, 'number'); assert.equal(f.props.min, 0); assert.equal(f.props.step, 1) }
  const previous = draft.value.runBudget
  fields[0].props.onInput({ target: { value: '15', validity: { badInput: false } } })
  assert.notEqual(draft.value.runBudget, previous)
  assert.deepEqual(JSON.parse(JSON.stringify(draft.value.runBudget)), { requests: 15, detailRequests: 5, activeMinutes: 30 })
})

test('resume saves the latest budget before dispatching and stops when saving fails', async () => {
  const start = source.indexOf('    async function resumeTask()')
  const code = source.slice(start, source.indexOf('    // pause keeps', start))
  for (const saved of [true, false]) {
    const calls = []
    const context = vm.createContext({ pausedAutoRun: () => ({ runRecordId: 42, runMode: 'collect', messageSendPending: false, exitCode: 0 }),
      assertCheckpointCanResume, draft: { value: { runMode: 'collect' } }, taskStore: { taskHistory: [] }, R: { message() {} },
      preparing: { value: false }, starting: { value: false }, stopping: { value: false },
      ensureBossLogin: async () => true, recoveryGuide: () => ({ canContinue: true }),
      save: async (_loud, task) => { calls.push('save:' + task); return saved },
      startTask: async (_task, _resume, id) => { assert.equal(id, 42); calls.push('start') },
      refreshResume: async () => { calls.push('refresh'); return true } })
    context.taskStore.getRunningTasks = async () => {}
    vm.runInContext(code, context)
    await context.resumeTask()
    assert.deepEqual(calls, saved ? ['refresh', 'save:auto', 'start', 'refresh'] : ['refresh', 'save:auto'])
  }
})

test('budget stops save progress and use terminal exit codes rather than the worker restart path', async () => {
  const file = fs.readFileSync(new URL('../src/main/flow/GEEK_AUTO_START_CHAT_WITH_BOSS_MAIN/index.ts', import.meta.url), 'utf8')
  const start = file.indexOf('  async function stopForBudget(')
  const { code } = await transform(file.slice(start, file.indexOf('\n  while (true)', start)), { loader: 'ts' })
  for (const [message, expected] of [['AUTO_CHAT_RUN_BUDGET_EXCEEDED', 96], ['AUTO_CHAT_RUN_BUDGET_UNAVAILABLE', 97]]) {
    const calls = []
    const context = vm.createContext({ Error, AUTO_CHAT_ERROR_EXIT_CODE,
      taskProgress: { setBudget: () => calls.push('budget'), update: () => calls.push('progress') },
      runBudgetStatus: () => ({ usage: { requests: 12 } }), saveResume: () => calls.push('save'),
      closeBrowserWindow: async () => calls.push('close'), process: { exit: code => calls.push(code) },
      error: Object.assign(Error(message), { detail: '预算已暂停' }) })
    vm.runInContext(code, context)
    assert.equal(await vm.runInContext('stopForBudget(error)', context), true)
    assert.deepEqual(calls, ['budget', 'progress', 'save', 'close', expected])
  }
})

test('newly queued workers freeze budgets and declare both budget exits non-restartable', async () => {
  const file = fs.readFileSync(new URL('../src/main/features/run-common.ts', import.meta.url), 'utf8')
  const { code } = await transform(file.slice(file.indexOf('export async function runCommon(')).replace('export async', 'async'), { loader: 'ts' })
  let dispatched = null, frozen = null
  const initializations = [], checkpoints = []
  const config = { 'boss.json': { autoChatRunBudget: { requests: 7, detailRequests: 3, activeMinutes: 15 } }, 'common-job-condition-config.json': {}, 'target-company-list.json': [] }
  const context = vm.createContext({ AUTO_CHAT_ERROR_EXIT_CODE,
    sendToDaemon: async message => { if (message.type === 'get-status') return {}; if (message.type === 'start-worker') dispatched = message; return {} },
    saveAndGetCurrentRunRecord: async () => ({ data: { id: 42 } }),
    process: { env: {}, argv: ['electron'] }, app: { isPackaged: true }, daemonEE: { on() {} },
    readConfigFile: name => config[name], readRunSettings, normalizeJobSources,
    assertCheckpointCanResume, readAutoChatResume: () => ({ runRecordId: 42, runMode: 'chat', exitCode: 0, messageSendPending: false }),
    runtimeFolderPath: '/isolated-fixture', storageFilePath: '/isolated-fixture/storage', path: { join: (...parts) => parts.join('/') },
    createBudgetStore: (_folder, id) => ({ save: state => initializations.push({ id, state }) }),
    initializeAutoChatResume: (id, mode) => checkpoints.push({ id, mode }),
    writeTaskConfigSnapshot: (_folder, _id, captured) => { frozen = captured; return '/isolated-fixture/42.json' } })
  vm.runInContext(code, context)
  await vm.runInContext("runCommon({mode:'geekAutoStartWithBossMain'})", context)
  assert.deepEqual(frozen['boss.json'].autoChatRunBudget, config['boss.json'].autoChatRunBudget)
  const codes = dispatched.env.GEEKGEEKRUND_NO_AUTO_RESTART_EXIT_CODE.split(',').map(Number)
  assert.ok(codes.includes(96) && codes.includes(97))
  assert.ok(codes.includes(98))
  assert.ok(codes.includes(99), 'unconfirmed background windows must not trigger browser restart loops')
  assert.ok(codes.includes(100), 'unconfirmed filters must stop instead of restarting')
  assert.equal(initializations.length, 1)
  assert.equal(checkpoints.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(initializations[0].state.usage)), { requests: 0, detailRequests: 0, activeMs: 0 })
  await vm.runInContext("runCommon({mode:'geekAutoStartWithBossMain',resumeRunRecordId:42})", context)
  assert.equal(initializations.length, 1, 'resume never reinitializes the journal')
  assert.equal(checkpoints.length, 1, 'resume never overwrites the saved checkpoint')
})
