import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { Module } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build, transform } from 'esbuild'
import { checkpointRecovery, assertCheckpointCanResume } from '../src/common/task-recovery.mjs'
import { readRunSettings } from '../../geek-auto-start-chat-with-boss/run-settings.mjs'
import { normalizeJobSources } from '../../geek-auto-start-chat-with-boss/search-source.mjs'
import { isJsonStorageError } from '../../utils/atomic-json.mjs'
import { AUTO_CHAT_ERROR_EXIT_CODE } from '../../run-core-of-geek-auto-start-chat-with-boss/enums.mjs'

const AUTO = 'geekAutoStartWithBossMain'
const checkpoint = (extra = {}) => ({ runRecordId: 42, runMode: 'collect', savedAt: 10,
  messageSendPending: false, exitCode: 0, runState: {}, progress: { log: [], viewed: 3, collected: 2, sent: 0 }, ...extra })
const here = path.dirname(fileURLToPath(import.meta.url))
const ui = fs.readFileSync(new URL('../src/renderer/src/page/Ux/index.js', import.meta.url), 'utf8')

test('pending sends block normal continuation even after a manual pause or browser restart', () => {
  for (const state of [checkpoint({ messageSendPending: true }), checkpoint({ exitCode: 87 })]) {
    const recovery = checkpointRecovery(state)
    assert.equal(recovery.canResume, false)
    assert.equal(recovery.reason, 'send-unconfirmed')
    assert.throws(() => assertCheckpointCanResume(state, { runRecordId: 42, runMode: 'collect' }), /不能直接继续/)
  }
})

test('matching history protects old checkpoints; unrelated runs and workers do not change the outcome', () => {
  const old = { runRecordId: 42, runMode: 'chat' }
  const entry = { workerId: AUTO, runRecordId: 42, code: 87 }
  assert.equal(checkpointRecovery(old, { history: [entry] }).reason, 'send-unconfirmed')
  assert.equal(checkpointRecovery(old).canResume, false)
  assert.equal(checkpointRecovery({ ...old, runMode: 'collect' }).canResume, true)
  assert.equal(checkpointRecovery(old, { history: [{ ...entry, code: 0 }] }).canResume, true)
  assert.equal(checkpointRecovery(checkpoint(), { history: [{ ...entry, runRecordId: 43 }, { ...entry, workerId: 'other' }] }).canResume, true)
  assert.equal(checkpointRecovery(checkpoint({ exitCode: 0, savedAt: 30 }), { history: [{ ...entry, endedAt: 20 }] }).canResume, true)
  assert.equal(checkpointRecovery(checkpoint({ exitCode: undefined, progress: { startedAt: 30 } }),
    { history: [{ ...entry, startedAt: 1, endedAt: 20 }] }).canResume, true)
})

test('malformed confirmation metadata cannot become permission to continue', () => {
  for (const extra of [{ messageSendPending: 'false' }, { messageSendPending: null }, { exitCode: '87' }, { exitCode: -1 }])
    assert.equal(checkpointRecovery(checkpoint(extra)).canResume, false)
})

test('continuation keeps the original mode and supports known pauses without reopening a completed run', () => {
  for (const code of [0, 81, 82, 83, 84, 85, 88, 89, 90, 91, 93, 94, 95, 96, 97, 98, 99, 100, 101]) {
    const state = checkpoint({ exitCode: code })
    assert.equal(assertCheckpointCanResume(state, { runRecordId: 42, runMode: 'collect' }).canResume, true)
  }
  assert.equal(checkpointRecovery(checkpoint({ exitCode: 92 })).canResume, false)
  assert.throws(() => assertCheckpointCanResume(checkpoint(), { runRecordId: 42, runMode: 'chat' }), /保持原来/)
  assert.throws(() => assertCheckpointCanResume(checkpoint(), { runRecordId: 43 }), /没有可以继续/)
})

const resumeBuild = await build({ entryPoints: [path.join(here, '../src/main/features/task-resume.ts')],
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false, logLevel: 'silent', plugins: [{
    name: 'private-recovery-directory', setup(builder) {
      builder.onResolve({ filter: /runtime-file-utils\.mjs$/ }, () => ({ path: 'runtime', namespace: 'recovery-fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'recovery-fixture' }, () => ({ contents: 'export const storageFilePath=globalThis.__ggrRecoveryDirectory;' }))
    }
  }] })
function resumeStorage(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-recovery-'))
  globalThis.__ggrRecoveryDirectory = folder
  t.after(() => { delete globalThis.__ggrRecoveryDirectory; fs.rmSync(folder, { recursive: true, force: true }) })
  const load = () => {
    const module = new Module(path.join(here, 'recovery-fixture.generated.cjs'))
    module.filename = path.join(here, 'recovery-fixture.generated.cjs'); module.paths = Module._nodeModulePaths(here)
    module._compile(resumeBuild.outputFiles[0].text, module.filename)
    return module.exports
  }
  return { folder, load }
}

test('confirmation metadata remains blocked after loading the real checkpoint in a fresh module', t => {
  const { folder, load } = resumeStorage(t), storage = load()
  storage.writeAutoChatResume(checkpoint({ messageSendPending: true }), { required: true })
  assert.equal(load().readAutoChatResume().messageSendPending, true)
  assert.equal(checkpointRecovery(load().readAutoChatResume()).canResume, false)
  const json = JSON.parse(fs.readFileSync(path.join(folder, 'auto-chat-resume.json'), 'utf8'))
  assert.equal(json.progress.sent, 0)
  storage.writeAutoChatResume(checkpoint({ messageSendPending: false }), { required: true })
  assert.equal(checkpointRecovery(load().readAutoChatResume()).canResume, true)
})

test('unreadable or malformed progress remains intact and cannot be treated as an empty task', t => {
  const { folder, load } = resumeStorage(t), storage = load(), file = path.join(folder, 'auto-chat-resume.json')
  assert.equal(storage.readAutoChatResume({ strict: true }), null)
  for (const text of ['{"private":"fixture-private-text', JSON.stringify(checkpoint({ progress: 'invalid' }))]) {
    fs.writeFileSync(file, text)
    assert.throws(() => storage.readAutoChatResume({ strict: true }), error => {
      assert.equal(error.code, 'GGR_JSON_INVALID')
      assert.doesNotMatch(error.message, /fixture-private-text/)
      return true
    })
    assert.equal(fs.readFileSync(file, 'utf8'), text)
  }
  fs.rmSync(file); fs.mkdirSync(file)
  assert.throws(() => storage.readAutoChatResume({ strict: true }), error => error.code === 'GGR_FILE_READ_FAILED')
  assert.equal(fs.statSync(file).isDirectory(), true)
})

test('a stopped safety guard cannot be bypassed by ordinary continuation', () => {
  const state = checkpoint({ exitCode: 89, recoveryReason: 'safety-guard' })
  assert.equal(checkpointRecovery(state).canResume, false)
  assert.throws(() => assertCheckpointCanResume(state, { runRecordId: 42, runMode: 'collect' }), /不能直接继续/)
})

const worker = fs.readFileSync(new URL('../src/main/flow/GEEK_AUTO_START_CHAT_WITH_BOSS_MAIN/index.ts', import.meta.url), 'utf8')
const workerSave = await transform(worker.slice(worker.indexOf('  let messageSendPending ='), worker.indexOf('  const resumeSaver =')), { loader: 'ts' })
function checkpointRecorder(storage) {
  const events = new EventEmitter()
  const ctx = vm.createContext({ autoStartChatEventBus: events, runRecordId: 42, resumed: false, saved: null, runCompleted: false,
    runMode: 'chat', skipCurrentFilterNextTime: false, taskProgress: { progress: checkpoint().progress },
    exportRunState: () => ({ position: { jobIndex: 3 } }), writeAutoChatResume: storage.writeAutoChatResume, discardAutoChatResume() {} })
  vm.runInContext(workerSave.code, ctx)
  return events
}
const core = fs.readFileSync(new URL('../../geek-auto-start-chat-with-boss/index.mjs', import.meta.url), 'utf8')
const beforeClick = core.slice(core.indexOf("          autoStartChatEventBus.emit('CHAT_CONFIRMATION', true)"), core.indexOf('          const waitAddFriendResponse ='))

test('the shipped click path records pending first and refuses to click if the record cannot be saved', async t => {
  const { folder, load } = resumeStorage(t), storage = load(), events = checkpointRecorder(storage)
  let clicks = 0
  const ctx = vm.createContext({ autoStartChatEventBus: events, page: {}, startChatButtonProxy: {}, beginChatConfirmation() {},
    clickTaskElement: async () => { clicks++; assert.equal(storage.readAutoChatResume().messageSendPending, true) } })
  await vm.runInContext('(async()=>{' + beforeClick + '})()', ctx)
  assert.equal(clicks, 1)
  fs.rmSync(path.join(folder, 'auto-chat-resume.json'))
  fs.mkdirSync(path.join(folder, 'auto-chat-resume.json'))
  await assert.rejects(vm.runInContext('(async()=>{' + beforeClick + '})()', ctx), error => error.code === 'GGR_FILE_WRITE_FAILED' && isJsonStorageError(error))
  assert.equal(clicks, 1)
  fs.rmSync(path.join(folder, 'auto-chat-resume.json'), { recursive: true })
  const marker = path.join(folder, 'auto-chat-terminated.json'), text = '{"private":"fixture-marker-text'
  fs.writeFileSync(marker, text)
  await assert.rejects(vm.runInContext('(async()=>{' + beforeClick + '})()', ctx), error => error.code === 'GGR_JSON_INVALID' && isJsonStorageError(error))
  assert.equal(clicks, 1)
  assert.equal(fs.readFileSync(marker, 'utf8'), text)
})

test('pending clears only after the shipped confirmed-storage hook succeeds', async t => {
  const { load } = resumeStorage(t), storage = load(), events = checkpointRecorder(storage)
  const start = core.indexOf('            await hooks.newChatStartup?.promise(')
  const body = core.slice(start, core.indexOf('            const rotateSource =', start))
  let failStorage = true
  const calls = []
  const ctx = vm.createContext({ autoStartChatEventBus: events, targetJobData: { jobInfo: { encryptUserId: 'fixture' } },
    hooks: { newChatStartup: { promise: async () => { calls.push('store'); if (failStorage) throw Error('fixture DB failure') } } },
    ChatStartupFrom: { AutoFromRecommendList: 1 }, JobSource: { search: 1 }, computedSourceList: [{ type: 'search' }],
    currentSourceIndex: 0, blockBossNotNewChat: new Set(), page: {}, finishChatConfirmation: () => calls.push('confirmed') })
  events.emit('CHAT_CONFIRMATION', true)
  await assert.rejects(vm.runInContext('(async()=>{' + body + '})()', ctx), /fixture DB failure/)
  assert.equal(storage.readAutoChatResume().messageSendPending, true)
  failStorage = false
  await vm.runInContext('(async()=>{' + body + '})()', ctx)
  assert.equal(storage.readAutoChatResume().messageSendPending, false)
  assert.deepEqual(calls, ['store', 'store', 'confirmed'])
})

test('the actual renderer refuses blocked or changed-mode continuation before saving or dispatching', async () => {
  const start = ui.indexOf('    async function resumeTask()')
  const code = ui.slice(start, ui.indexOf('    // pause keeps', start))
  for (const [state, mode] of [[checkpoint({ messageSendPending: true }), 'collect'], [checkpoint(), 'chat']]) {
    const calls = []
    const ctx = vm.createContext({ pausedAutoRun: () => state, assertCheckpointCanResume,
      draft: { value: { runMode: mode } }, taskStore: { taskHistory: [], getRunningTasks: async () => {} },
      preparing: { value: false }, starting: { value: false }, stopping: { value: false }, refreshResume: async () => true,
      R: { message: info => calls.push(info.message) },
      save: () => assert.fail('blocked continuation cannot save'), startTask: () => assert.fail('blocked continuation cannot dispatch') })
    vm.runInContext(code, ctx); await ctx.resumeTask()
    assert.equal(calls.length, 1)
  }
})

test('the real task runner blocks pending sends and changed modes even with no config snapshot file', async () => {
  const file = fs.readFileSync(new URL('../src/main/features/run-common.ts', import.meta.url), 'utf8')
  const body = (await transform(file.slice(file.indexOf('export async function runCommon(')).replace('export async', 'async'), { loader: 'ts' })).code
  for (const [saved, mode, blocked] of [[checkpoint({ messageSendPending: true }), 'collect', true], [checkpoint(), 'chat', true], [checkpoint(), 'collect', false]]) {
    const calls = []
    const ctx = vm.createContext({ assertCheckpointCanResume, readAutoChatResume: () => saved, AUTO_CHAT_ERROR_EXIT_CODE,
      readConfigFile: () => ({ autoChatRunMode: mode }), readRunSettings, normalizeJobSources, process: { env: {}, argv: ['electron'] },
      app: { isPackaged: true }, daemonEE: { on() {} }, runtimeFolderPath: '/fixture-no-snapshot', path,
      sendToDaemon: async message => { calls.push(message.type); return {} },
      writeTaskConfigSnapshot: () => { calls.push('snapshot'); return '/fixture-snapshot' },
      createBudgetStore: () => assert.fail('continuation cannot reset budget'), initializeAutoChatResume: () => assert.fail('continuation cannot reset progress') })
    vm.runInContext(body, ctx)
    const action = vm.runInContext("runCommon({mode:'geekAutoStartWithBossMain',resumeRunRecordId:42})", ctx)
    if (blocked) await assert.rejects(action, /不能直接继续|保持原来/)
    else await action
    assert.equal(calls.includes('start-worker'), !blocked)
    assert.equal(calls.includes('snapshot'), !blocked)
  }
})
