import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { installWorkerShutdown } from '../worker-shutdown.mjs'
import { installGuiShutdown } from '../gui-shutdown.mjs'
import { closeOwnedBrowser } from '../../geek-auto-start-chat-with-boss/browser-cleanup.mjs'

test('worker termination waits for browser cleanup and saves the final checkpoint exactly once', async () => {
  const calls = [], host = new EventEmitter(); host.exit = code => calls.push(['exit', code])
  let finish
  const shutdown = installWorkerShutdown({ host, save: () => calls.push('save'),
    close: () => new Promise(resolve => { calls.push('close'); finish = resolve }) })
  host.emit('disconnect'); host.emit('SIGTERM')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(shutdown.isStopping(), true)
  assert.deepEqual(calls, ['save', 'close'])
  finish(); await shutdown.stop()
  assert.deepEqual(calls, ['save', 'close', 'save', ['exit', 0]])
  shutdown.dispose()
  assert.equal(host.listenerCount('disconnect'), 0)
})

test('checkpoint errors still close the owned browser and exit', async () => {
  const calls = [], host = new EventEmitter(); host.exit = code => calls.push(code)
  const shutdown = installWorkerShutdown({ host, save: () => { throw Error('disk failed') },
    close: async () => calls.push('close'), report: () => calls.push('reported') })
  await shutdown.stop()
  assert.deepEqual(calls, ['reported', 'close', 'reported', 0])
  shutdown.dispose()
})

test('GUI quit waits for owned tasks before disconnecting, including repeated quit requests', async () => {
  const app = new EventEmitter(), calls = []; let finish
  app.quit = () => { calls.push('quit'); app.emit('before-quit', { preventDefault: () => calls.push('unexpected-prevent') }) }
  installGuiShutdown({ app, stopOwned: () => new Promise(resolve => { calls.push('stop'); finish = resolve }),
    disconnect: () => calls.push('disconnect') })
  const event = { preventDefault: () => calls.push('prevent') }
  app.emit('before-quit', event); app.emit('before-quit', event)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ['prevent', 'prevent', 'stop'])
  finish(); await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ['prevent', 'prevent', 'stop', 'disconnect', 'quit'])
})

test('browser cleanup waits for graceful close and only forces its owned process group on timeout', async () => {
  const calls = [], child = new EventEmitter(); child.pid = 12345; child.exitCode = null; child.signalCode = null
  child.kill = signal => { calls.push(signal); child.signalCode = signal; child.emit('exit') }
  await closeOwnedBrowser({ process: () => child, close: async () => calls.push('graceful') }, { kill: () => calls.push('unexpected') })
  assert.deepEqual(calls, ['graceful'])
  await closeOwnedBrowser({ process: () => child, close: () => new Promise(() => {}) }, { timeoutMs: 10,
    kill: (pid, signal) => { calls.push([pid, signal]); child.signalCode = signal; child.emit('exit') } })
  assert.deepEqual(calls[1], process.platform === 'win32' ? 'SIGKILL' : [-12345, 'SIGKILL'])
  await closeOwnedBrowser({ process: () => null, close: () => Promise.reject(Error('already disconnected')) }, { kill: () => { throw Error('must not kill an attached browser') } })
})
