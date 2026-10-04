// Runs the real daemon with fake task processes to check the serial BOSS task queue.
const test = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('child_process')
const net = require('net')
const path = require('path')
const { tmpdir } = require('os')
const { randomUUID } = require('crypto')

const AUTO = 'geekAutoStartWithBossMain', FOLLOW = 'readNoReplyAutoReminderMain', POLL = 'jobStatusPollMain'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function startDaemon(sliceMs = 60000) {
  const pipeName = `ggr-test-${randomUUID()}`
  const child = spawn(process.execPath, [path.join(__dirname, '../daemon.js')], {
    stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
    env: { ...process.env, GEEKGEEKRUND_PIPE_NAME: pipeName, GEEKGEEKRUND_TIME_SLICE_MS: String(sliceMs) }
  })
  await new Promise((resolve) => child.stdio[3].once('data', resolve)) // DAEMON_READY
  const socket = net.connect(path.join(tmpdir(), `${pipeName}.sock`))
  const pending = new Map()
  const events = []
  let buffer = ''
  socket.on('data', (d) => {
    buffer += d
    let i
    while ((i = buffer.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1)
      if (msg._callbackUuid && pending.has(msg._callbackUuid)) { pending.get(msg._callbackUuid)(msg); pending.delete(msg._callbackUuid) }
      else if (msg.type !== 'status') events.push(msg)
    }
  })
  const send = (m) => new Promise((r) => { const id = randomUUID(); pending.set(id, r); socket.write(JSON.stringify({ ...m, _callbackUuid: id }) + '\n') })
  await send({ type: 'user-process-register' })
  const start = (workerId, env = {}) =>
    send({ type: 'start-worker', workerId, command: process.execPath, args: [path.join(__dirname, 'fake-worker.cjs')], env: { FAKE_KIND: 'long', ...env } })
  const status = () => send({ type: 'get-status' })
  const running = async () => (await status()).workers.map((w) => w.workerId)
  const queued = async () => (await status()).queue.map((q) => `${q.workerId}:${q.reason}`)
  const close = () => { socket.destroy(); child.kill() }
  return { send, start, status, running, queued, events, close }
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
    await sleep(900)
    assert.deepEqual(await d.running(), [FOLLOW])
    assert.deepEqual(await d.queued(), [`${AUTO}:yielded`])
    await sleep(700)
    assert.deepEqual(await d.running(), [AUTO])
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
    assert.equal((await d.send({ type: 'check-should-exit', workerId: FOLLOW })).shouldExit, false)
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
