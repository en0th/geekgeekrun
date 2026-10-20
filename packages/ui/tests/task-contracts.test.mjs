import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { Module } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { build } from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
async function compile(file, filter, contents) {
  const result = await build({ entryPoints: [path.join(here, file)], bundle: true, format: 'cjs',
    platform: 'node', packages: 'external', write: false, logLevel: 'silent', plugins: [{
      name: 'isolated-task-boundary', setup(builder) {
        builder.onResolve({ filter }, args => ({ path: args.path, namespace: 'task-contract-fixture' }))
        builder.onLoad({ filter: /.*/, namespace: 'task-contract-fixture' }, () => ({ contents }))
      }
    }] })
  return () => {
    const filename = path.join(here, 'task-contract.generated.cjs')
    const loaded = new Module(filename)
    loaded.filename = filename
    loaded.paths = Module._nodeModulePaths(here)
    loaded._compile(result.outputFiles[0].text, filename)
    return loaded.exports
  }
}

const daemonModule = await compile('../src/main/flow/OPEN_SETTING_WINDOW/connect-to-daemon.ts', /^node:net$/,
  'export default { Socket: globalThis.__ggrTaskContract.Socket };')

test('actual daemon requests settle errors and timeouts without detached rejected promises', async t => {
  const previous = process.env.GEEKGEEKRUND_PIPE_NAME
  process.env.GEEKGEEKRUND_PIPE_NAME = 'fixture-only-no-real-socket'
  const sockets = []
  class Socket extends EventEmitter {
    destroyed = false
    input = new PassThrough()
    requests = []
    constructor() { super(); sockets.push(this) }
    connect(_path, callback) { queueMicrotask(callback) }
    pipe(stream) { return this.input.pipe(stream) }
    write(line) { this.requests.push(JSON.parse(line)) }
    reply(index, data) {
      this.input.write(JSON.stringify({ _callbackUuid: this.requests[index]._callbackUuid, ...data }) + '\n')
    }
    destroy() { this.destroyed = true; this.input.end(); this.emit('close') }
  }
  globalThis.__ggrTaskContract = { Socket }
  const daemon = daemonModule()
  t.after(() => {
    daemon.closeDaemonClient()
    delete globalThis.__ggrTaskContract
    if (previous === undefined) delete process.env.GEEKGEEKRUND_PIPE_NAME
    else process.env.GEEKGEEKRUND_PIPE_NAME = previous
  })
  await daemon.connectToDaemon()
  const [socket] = sockets
  const failed = daemon.sendToDaemon({ type: 'fixture-error' }, { needCallback: true })
  const failure = assert.rejects(failed, error => error._isError === true)
  socket.reply(0, { _isError: true, message: 'fixture rejection' })
  await failure
  await assert.rejects(daemon.sendToDaemon({ type: 'fixture-timeout' }, { needCallback: true, timeout: 5 }), /Callback timeout/)
  socket.reply(1, { late: true })
  const success = daemon.sendToDaemon({ type: 'fixture-success' }, { needCallback: true })
  socket.reply(2, { ok: true })
  assert.equal((await success).ok, true)
  const interrupted = daemon.sendToDaemon({ type: 'fixture-disconnect' }, { needCallback: true })
  const rejection = assert.rejects(interrupted, /连接已关闭/)
  daemon.closeDaemonClient()
  await rejection
  await new Promise(resolve => setImmediate(resolve))
})

const dbModule = await compile('../src/main/flow/OPEN_SETTING_WINDOW/utils/db/index.ts', /worker\/index\?nodeWorker&url$/,
  'export default () => globalThis.__ggrTaskContract.createWorker();')
const runnerModule = await compile('../src/main/features/run-common.ts',
  /connect-to-daemon$|utils\/db$|task-resume$|runtime-file-utils\.mjs$|run-budget-store\.mjs$|task-config-snapshot\.mjs$|run-settings\.mjs$|search-source\.mjs$|^electron$/,
  `const f=globalThis.__ggrTaskContract;
   export const sendToDaemon=f.send,daemonEE=f.events,saveAndGetCurrentRunRecord=f.saveRecord;
   export const app={isPackaged:true},runtimeFolderPath='/fixture',storageFilePath='/fixture';
   export const readConfigFile=()=>({}),createBudgetStore=()=>({save(){}}),writeTaskConfigSnapshot=()=>'/fixture/snapshot';
   export const readRunSettings=()=>({runMode:'collect'}),normalizeJobSources=()=>[],initializeAutoChatResume=()=>{};`)

function taskFixture(t, reply) {
  const requests = [], commands = []
  class Worker extends EventEmitter {
    constructor() { super(); queueMicrotask(() => this.emit('message', { type: 'DB_INIT_SUCCESS' })) }
    postMessage(request) {
      requests.push(request)
      queueMicrotask(() => this.emit('message', { _uuid: request._uuid, ...reply }))
    }
  }
  globalThis.__ggrTaskContract = {
    createWorker: () => new Worker(), events: new EventEmitter(),
    send: async message => { commands.push(message); return message.type === 'get-status' ? { workers: [], queue: [] } : {} }
  }
  const db = dbModule()
  globalThis.__ggrTaskContract.saveRecord = db.saveAndGetCurrentRunRecord
  const runner = runnerModule()
  t.after(() => { delete globalThis.__ggrTaskContract })
  return { requests, commands, run: options => runner.runCommon({ mode: 'readNoReplyAutoReminderMain', ...options }) }
}

test('task startup rejects database errors and invalid run IDs before starting a worker', async t => {
  for (const reply of [{ error: 'fixture database full' }, {}, { data: { id: 0 } }, { data: { id: '7' } }]) {
    const f = taskFixture(t, reply)
    await assert.rejects(f.run(), /fixture database full|未能创建有效的任务记录/)
    assert.equal(f.commands.some(message => message.type === 'start-worker'), false)
  }
})

test('task startup keeps a confirmed run ID and poll tasks bypass run-record creation', async t => {
  const f = taskFixture(t, { data: { id: 42 } })
  assert.equal((await f.run()).runRecordId, 42)
  assert.ok(f.commands.find(message => message.type === 'start-worker').args.includes('--run-record-id=42'))
  assert.equal(f.requests.length, 1)
  await f.run({ mode: 'jobStatusPollMain', withRunRecord: false })
  assert.equal(f.requests.length, 1)
  assert.ok(f.commands.filter(message => message.type === 'start-worker').at(-1).args.includes('--run-record-id=0'))
})
