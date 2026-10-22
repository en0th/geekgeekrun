// Runs the real daemon with fake task processes to check the serial BOSS task queue.
const test = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('child_process')
const net = require('net')
const path = require('path')
const { tmpdir } = require('os')
const { randomUUID } = require('crypto')
const { requestGracefulStop } = require('../../utils/worker-shutdown-protocol.cjs')

const AUTO = 'geekAutoStartWithBossMain', FOLLOW = 'readNoReplyAutoReminderMain', POLL = 'jobStatusPollMain'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('an unreadable persisted task history is preserved when a later task finishes', async t => {
  const fs = require('node:fs')
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'ggr-history-invalid-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'history.json')
  fs.writeFileSync(file, '{invalid history')
  const d = await startDaemon(60000, { GEEKGEEKRUND_TASK_HISTORY_FILE: file })
  try {
    await d.start(POLL, { FAKE_KIND: 'finite', FAKE_MS: '100' })
    await sleep(400)
    assert.equal((await d.status()).history[0].outcome, 'finished')
    assert.equal(fs.readFileSync(file, 'utf8'), '{invalid history')
    assert.deepEqual(fs.readdirSync(dir), ['history.json'])
  } finally { d.close() }
})

test('the real supervisor never retries browser pauses or unknown sends, including without a launcher exit-code list', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), { transformSync } = require('esbuild')
  const { requiresManualTaskRestart, isResumableTaskExit } = require('../task-exit.cjs')
  const enumFile = path.join(__dirname, '../../ui/src/common/enums/auto-start-chat.ts')
  const compiled = transformSync(fs.readFileSync(enumFile, 'utf8'), { loader: 'ts', format: 'cjs' }).code
  const module = { exports: {} }; vm.runInNewContext(compiled, { module })
  const enums = module.exports.AUTO_CHAT_ERROR_EXIT_CODE
  const source = fs.readFileSync(path.join(__dirname, '../../ui/src/main/features/run-common.ts'), 'utf8')
  const start = source.indexOf('GEEKGEEKRUND_NO_AUTO_RESTART_EXIT_CODE: [')
  const end = source.indexOf("].join(',')", start) + "].join(',')".length
  assert.ok(start > 0 && end > start)
  const expression = source.slice(source.indexOf('[', start), end)
  const list = vm.runInNewContext(expression, { AUTO_CHAT_ERROR_EXIT_CODE: enums, extraNoAutoRestartExitCodes: [] }).split(',').map(Number)
  assert.ok(list.includes(101), 'new GUI workers must also be safe with an older daemon')
  assert.ok(list.includes(87))
  assert.equal(isResumableTaskExit(AUTO, 101), true)
  assert.equal(isResumableTaskExit(AUTO, 87), false)
  assert.equal(requiresManualTaskRestart(FOLLOW, 101), false)
  assert.equal(requiresManualTaskRestart(AUTO, 1), false)
  const d = await startDaemon()
  try {
    for (const code of [101, 87]) {
      // Deliberately omit the caller's list: the daemon must enforce pause policy.
      await d.start(AUTO, { FAKE_KIND: 'finite', FAKE_MS: '50', FAKE_EXIT: String(code) }, [`--run-record-id=${code}`, '--run-mode=collect'])
      const state = await d.waitForStatus(value => !value.workers.length && value.history.some(h => h.workerId === AUTO && h.code === code && h.outcome === 'failed'))
      const history = state.history.find(h => h.workerId === AUTO && h.code === code)
      assert.equal(history.runMode, 'collect'); assert.equal(history.runRecordId, code)
      assert.ok(d.events.some(event => event.type === 'worker-exited' && event.code === code && !event.restarting))
    }
    await sleep(2200)
    assert.deepEqual(await d.running(), []); assert.deepEqual(await d.queued(), [])
    assert.equal((await d.status()).history.filter(h => h.workerId === AUTO).length, 2)
  } finally { d.close() }
})

async function startDaemon(sliceMs = 60000, extraEnv = {}) {
  const pipeName = `ggr-test-${randomUUID()}`
  const child = spawn(process.execPath, [path.join(__dirname, '../daemon.js')], {
    stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'ipc'],
    env: { ...process.env, GEEKGEEKRUND_PIPE_NAME: pipeName, GEEKGEEKRUND_TIME_SLICE_MS: String(sliceMs), ...extraEnv }
  })
  await new Promise((resolve) => child.stdio[3].once('data', resolve)) // DAEMON_READY
  const socket = net.connect(process.platform === 'win32' ? `\\\\.\\pipe\\${pipeName}` : path.join(tmpdir(), `${pipeName}.sock`))
  const pending = new Map()
  const events = []
  // Retain transitions: a fast task can yield again before the test runner reads
  // its next status. Assertions must observe the intended turn, not a wall clock.
  const states = []
  const stateWaiters = new Set()
  let buffer = ''
  socket.on('data', (d) => {
    buffer += d
    let i
    while ((i = buffer.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1)
      if (msg._callbackUuid && pending.has(msg._callbackUuid)) { pending.get(msg._callbackUuid)(msg); pending.delete(msg._callbackUuid) }
      else if (msg.type === 'status') {
        states.push(msg)
        for (const waiter of stateWaiters) waiter(msg)
      } else events.push(msg)
    }
  })
  const send = (m) => new Promise((r) => { const id = randomUUID(); pending.set(id, r); socket.write(JSON.stringify({ ...m, _callbackUuid: id }) + '\n') })
  await send({ type: 'user-process-register' })
  const start = (workerId, env = {}, extraArgs = []) =>
    send({ type: 'start-worker', workerId, command: process.execPath, args: [path.join(__dirname, 'fake-worker.cjs'), ...extraArgs], env: { FAKE_KIND: 'long', ...env } })
  const status = () => send({ type: 'get-status' })
  const running = async () => (await status()).workers.map((w) => w.workerId)
  const queued = async () => (await status()).queue.map((q) => `${q.workerId}:${q.reason}`)
  const waitForState = (predicate, timeoutMs = 5000) => {
    const previous = states.find(predicate)
    if (previous) return Promise.resolve(previous)
    return new Promise((resolve, reject) => {
      const observed = state => {
        if (!predicate(state)) return
        clearTimeout(timer)
        stateWaiters.delete(observed)
        resolve(state)
      }
      const timer = setTimeout(() => {
        stateWaiters.delete(observed)
        reject(new Error('Timed out waiting for the daemon queue transition'))
      }, timeoutMs)
      stateWaiters.add(observed)
    })
  }
  const close = () => { socket.destroy(); requestGracefulStop(child) }
  const waitForStatus = async (predicate, timeoutMs = 5000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const state = await status()
      if (predicate(state)) return state
      await sleep(20)
    }
    throw Error('Timed out waiting for the daemon worker state')
  }
  const ready = workerId => waitForStatus(state => state.workers.some(worker => worker.workerId === workerId &&
    worker.runtimeStorage?.taskProgress?.progress?.ready))
  return { send, start, status, running, queued, waitForState, ready, waitForStatus, events, close, socket, child, pipeName }
}

test('one BOSS task runs at a time; others wait in order', async () => {
  const d = await startDaemon()
  try {
    assert.equal((await d.start(AUTO)).queued, undefined)
    const r = await d.start(FOLLOW)
    assert.equal(r.queued, true)
    assert.equal(r.position, 1)
    await sleep(300)
    assert.deepEqual(await d.running(), [AUTO])
    assert.deepEqual(await d.queued(), [`${FOLLOW}:waiting`])
  } finally { d.close() }
})

test('a stopping worker holds its slot until it exits, including an immediate restart of the same task', async () => {
  const d = await startDaemon()
  try {
    await d.start(AUTO, { FAKE_STOP_DELAY_MS: '500' })
    await d.ready(AUTO)
    const oldPid = (await d.status()).workers[0].pid
    const stopping = d.send({ type: 'stop-worker', workerId: AUTO })
    await sleep(30)
    const next = await d.start(AUTO)
    assert.equal(next.queued, true)
    const state = await d.status()
    assert.equal(state.workers[0].pid, oldPid)
    assert.equal(state.workers[0].status, 'stopping')
    await stopping
    await d.ready(AUTO)
    const [current] = (await d.status()).workers
    assert.equal(current.workerId, AUTO)
    assert.notEqual(current.pid, oldPid)
    await sleep(300)
    assert.equal((await d.status()).workers[0].pid, current.pid)
  } finally { d.close() }
})

test('GUI shutdown awaits owned workers and cancels its queued and restarting tasks', async () => {
  const d = await startDaemon()
  try {
    await d.start(AUTO, { FAKE_STOP_DELAY_MS: '300' })
    await d.start(FOLLOW)
    await d.ready(AUTO)
    const started = Date.now()
    await d.send({ type: 'stop-owned-workers' })
    assert.ok(Date.now() - started >= 200)
    assert.deepEqual(await d.running(), [])
    assert.deepEqual(await d.queued(), [])
    await d.start(POLL, { FAKE_KIND: 'finite', FAKE_MS: '80', FAKE_EXIT: '1' })
    await d.waitForStatus(state => !state.workers.length && state.history.some(h => h.workerId === POLL && h.outcome === 'restarting'))
    await d.send({ type: 'stop-owned-workers' })
    await sleep(2100)
    assert.deepEqual(await d.running(), [])
  } finally { d.close() }
})

test('daemon termination closes sockets and waits for workers instead of leaving an invisible server', async () => {
  const d = await startDaemon()
  await d.start(AUTO, { FAKE_STOP_DELAY_MS: '250' })
  await d.ready(AUTO)
  const exited = new Promise(resolve => d.child.once('exit', resolve))
  requestGracefulStop(d.child)
  await Promise.race([exited, sleep(2500).then(() => { throw Error('daemon did not exit') })])
  assert.equal(d.socket.destroyed, true)
})

test('losing the last GUI connection reaps its task and the now-idle daemon', async () => {
  const d = await startDaemon()
  await d.start(AUTO, { FAKE_STOP_DELAY_MS: '200' })
  await d.ready(AUTO)
  const workerPid = (await d.status()).workers[0].pid
  const exited = new Promise(resolve => d.child.once('exit', resolve))
  d.socket.destroy()
  await Promise.race([exited, sleep(3500).then(() => { throw Error('idle daemon remained after GUI disconnected') })])
  assert.throws(() => process.kill(workerPid, 0))
})

test('stale worker messages cannot overwrite the active instance progress', async () => {
  const d = await startDaemon()
  try {
    await d.start(AUTO, { FAKE_PROGRESS: '5' })
    await d.ready(AUTO)
    await d.send({ type: 'worker-to-gui-message', workerId: AUTO, workerInstance: 'previous-instance',
      data: { type: 'task-progress', progress: { collected: 99 } } })
    assert.equal((await d.status()).workers[0].runtimeStorage.taskProgress.progress.collected, 5)
  } finally { d.close() }
})

test('a worker that ignores termination cannot leave its independent child browser group behind', async () => {
  const d = await startDaemon(60000, { GEEKGEEKRUND_STOP_TIMEOUT_MS: '150' })
  try {
    await d.start(AUTO, { FAKE_CHILD: '1', FAKE_STOP_DELAY_MS: '10000' })
    await d.ready(AUTO)
    const childPid = (await d.status()).workers[0].runtimeStorage.taskProgress.progress.childPid
    assert.ok(Number.isSafeInteger(childPid) && childPid > 0)
    await d.send({ type: 'stop-owned-workers' })
    let alive = true
    for (let i = 0; i < 20 && alive; i++) {
      try { process.kill(childPid, 0); await sleep(50) } catch { alive = false }
    }
    assert.equal(alive, false)
    assert.deepEqual(await d.running(), [])
  } finally { d.close() }
})

test('a poll jumps ahead, the long task yields at its checkpoint and resumes afterwards', async () => {
  const d = await startDaemon()
  try {
    await d.start(AUTO)
    await d.start(FOLLOW)
    await d.start(POLL, { FAKE_KIND: 'finite', FAKE_MS: '400' })
    assert.deepEqual(await d.queued(), [`${POLL}:waiting`, `${FOLLOW}:waiting`])
    await sleep(500)
    // AUTO yielded at its checkpoint and went to the back; the poll is running
    assert.deepEqual(await d.running(), [POLL])
    assert.deepEqual(await d.queued(), [`${FOLLOW}:waiting`, `${AUTO}:yielded`])
    assert.ok(d.events.some((e) => e.type === 'worker-yielded' && e.workerId === AUTO))
    assert.ok(!d.events.some((e) => e.type === 'worker-exited' && e.workerId === AUTO), 'a yield is not an exit')
    await sleep(700)
    // the poll finished; follow-up runs next, AUTO waits for its turn again
    assert.deepEqual(await d.running(), [FOLLOW])
    assert.deepEqual(await d.queued(), [`${AUTO}:yielded`])
    const history = (await d.status()).history.map((h) => `${h.workerId}:${h.outcome}`)
    assert.deepEqual(history.slice(0, 2), [`${POLL}:finished`, `${AUTO}:yielded`])
  } finally { d.close() }
})

test('long tasks take turns once their time slice is used up', async () => {
  const d = await startDaemon(500)
  try {
    await d.start(AUTO)
    await d.start(FOLLOW)
    const followTurn = await d.waitForState(state => state.workers.some(w => w.workerId === FOLLOW))
    assert.deepEqual(followTurn.workers.map(w => w.workerId), [FOLLOW])
    assert.deepEqual(followTurn.queue.map(q => `${q.workerId}:${q.reason}`), [`${AUTO}:yielded`])
    const autoTurn = await d.waitForState(state => state.workers.some(w => w.workerId === AUTO) &&
      state.history.some(h => h.workerId === FOLLOW && h.outcome === 'yielded'))
    assert.deepEqual(autoTurn.workers.map(w => w.workerId), [AUTO])
    assert.deepEqual(autoTurn.queue.map(q => `${q.workerId}:${q.reason}`), [`${FOLLOW}:yielded`])
    assert.deepEqual(autoTurn.history.slice(0, 2).map(h => `${h.workerId}:${h.outcome}`),
      [`${FOLLOW}:yielded`, `${AUTO}:yielded`])
  } finally { d.close() }
})

test('a long task alone keeps running past its slice', async () => {
  const d = await startDaemon(200)
  try {
    await d.start(AUTO)
    await sleep(700)
    assert.deepEqual(await d.running(), [AUTO])
  } finally { d.close() }
})

test('stopping a queued task removes it, and it can be started again later', async () => {
  const d = await startDaemon()
  try {
    await d.start(AUTO)
    await d.start(FOLLOW)
    await d.send({ type: 'stop-worker', workerId: FOLLOW })
    assert.deepEqual(await d.queued(), [])
    await d.send({ type: 'stop-worker', workerId: AUTO })
    await sleep(400)
    assert.deepEqual(await d.running(), [])
    await d.start(FOLLOW)
    await sleep(300)
    assert.deepEqual(await d.running(), [FOLLOW])
    // an earlier stop request doesn't make the new run exit
    assert.equal((await d.send({ type: 'check-should-exit', workerId: FOLLOW,
      workerInstance: (await d.status()).workers[0].instance })).shouldExit, false)
  } finally { d.close() }
})

test('a crashed task keeps its turn while it is restarted', async () => {
  const d = await startDaemon()
  try {
    await d.start(POLL, { FAKE_KIND: 'finite', FAKE_MS: '200', FAKE_EXIT: '1' })
    await d.start(FOLLOW)
    await sleep(600)
    // POLL crashed (exit 1) and waits 2s to restart; FOLLOW must not take its turn meanwhile
    assert.deepEqual(await d.running(), [])
    assert.deepEqual(await d.queued(), [`${FOLLOW}:waiting`])
    await sleep(1800)
    assert.deepEqual(await d.running(), [POLL])
  } finally { d.close() }
})

test('finished runs are kept in the history file across daemon restarts', async () => {
  const fs = require('fs')
  const file = path.join(fs.mkdtempSync(path.join(tmpdir(), 'ggr-hist-')), 'task-history.json')
  const d = await startDaemon(60000, { GEEKGEEKRUND_TASK_HISTORY_FILE: file })
  try {
    await d.start(POLL, { FAKE_KIND: 'finite', FAKE_MS: '200' }, ['--run-record-id=7', '--run-mode=collect'])
    await sleep(600)
  } finally { d.close() }
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(saved[0].workerId, POLL)
  assert.equal(saved[0].outcome, 'finished')
  assert.equal(saved[0].runRecordId, 7)
  assert.equal(saved[0].runMode, 'collect')
  const again = await startDaemon(60000, { GEEKGEEKRUND_TASK_HISTORY_FILE: file })
  try {
    assert.equal((await again.status()).history[0].id, saved[0].id)
  } finally { again.close() }
})

test('normal source exhaustion (92) finishes without restarting and remains finished after reload', async () => {
  const fs = require('fs')
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'ggr-rotated-'))
  const file = path.join(dir, 'history.json')
  const d = await startDaemon(60000, { GEEKGEEKRUND_TASK_HISTORY_FILE: file })
  try {
    await d.start(AUTO, { FAKE_KIND: 'finite', FAKE_MS: '100', FAKE_EXIT: '92' }, ['--run-record-id=12', '--run-mode=collect'])
    await sleep(400)
    assert.deepEqual(await d.running(), [])
    const [row] = (await d.status()).history
    assert.equal(row.code, 92)
    assert.equal(row.outcome, 'finished')
    assert.ok(d.events.some(e => e.type === 'worker-exited' && e.code === 92 && !e.restarting))
  } finally { d.close() }
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  saved[0].outcome = 'failed' // an existing history written before this fix
  fs.writeFileSync(file, JSON.stringify(saved))
  const again = await startDaemon(60000, { GEEKGEEKRUND_TASK_HISTORY_FILE: file })
  try { assert.equal((await again.status()).history[0].outcome, 'finished') }
  finally { again.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})
