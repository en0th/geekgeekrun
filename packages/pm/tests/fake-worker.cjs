// Stand-in for a task process: connects to the daemon like the real workers do.
// FAKE_KIND=long: loops, asking at each checkpoint whether to yield (exits 90 when told to)
// FAKE_KIND=finite: works for FAKE_MS then exits with FAKE_EXIT (default 0)
const net = require('net')
const path = require('path')
const { tmpdir } = require('os')
const { randomUUID } = require('crypto')
const sockPath = path.join(tmpdir(), `${process.env.GEEKGEEKRUND_PIPE_NAME}.sock`)
const socket = net.connect(sockPath)
const pending = new Map()
let buffer = ''
socket.on('data', (d) => {
  buffer += d
  let i
  while ((i = buffer.indexOf('\n')) >= 0) {
    const msg = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1)
    pending.get(msg._callbackUuid)?.(msg); pending.delete(msg._callbackUuid)
  }
})
const ask = (m) => new Promise((r) => { const id = randomUUID(); pending.set(id, r); socket.write(JSON.stringify({ ...m, _callbackUuid: id }) + '\n') })
const workerId = process.env.GEEKGEEKRUND_WORKER_ID
;(async () => {
  if (process.env.FAKE_KIND === 'finite') {
    await new Promise((r) => setTimeout(r, Number(process.env.FAKE_MS || 300)))
    process.exit(Number(process.env.FAKE_EXIT || 0))
  }
  for (;;) {
    await new Promise((r) => setTimeout(r, 100))
    const res = await ask({ type: 'check-should-yield', workerId })
    if (res.shouldYield) process.exit(90)
  }
})()
