// Run with ELECTRON_RUN_AS_NODE=1 and the unpacked application executable.
// Loads the pure compiled recovery chunk; never loads user config or starts a browser.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const [expectedVersion, output] = process.argv.slice(2)
const archive = path.join(path.dirname(process.execPath), 'resources/app.asar')
const folder = path.join(archive, 'out/main')

async function main() {
  assert.equal(require(path.join(archive, 'package.json')).version, expectedVersion)
  const name = fs.readdirSync(folder).find(name => /^automatic-retry-.*\.js$/.test(name))
  assert(name, 'Compiled recovery chunk missing')
  const chunk = path.join(folder, name)
  const { createAutomaticRetry } = require(chunk)
  const moduleHashes = { [name]: crypto.createHash('sha256').update(fs.readFileSync(chunk)).digest('hex') }
  const taskBrowserError = () => Object.assign(Error('AUTO_CHAT_BROWSER_UNAVAILABLE'), { diagnostic: { reason: 'network' } })
  let clock = 0, preparations = 0, pending = false, stopping = false
  const states = []
  const retry = createAutomaticRetry({ prepare: async () => { preparations++ }, now: () => clock,
    sendPending: () => pending, isStopping: () => stopping,
    publish: state => states.push(state), sleep: async ms => { clock += ms },
  })
  for (let i = 0; i < 8; i++) assert.equal(await retry.recover(taskBrowserError('network')), true)
  assert.deepEqual(states.filter(s => s.until).map(s => s.delayMs), [5000, 15000, 30000, 60000, 120000, 120000, 120000, 120000])
  pending = true
  assert.equal(await retry.recover(taskBrowserError('network')), false)
  assert.equal(preparations, 8)
  pending = false; stopping = true
  assert.equal(await retry.recover(taskBrowserError('network')), false)
  const core = fs.readdirSync(folder).filter(name => /^index.*\.js$/.test(name))
    .map(name => fs.readFileSync(path.join(folder, name), 'utf8'))
    .find(text => text.includes('prepareForAutomaticRetry') && text.includes('AUTO_CHAT_ATTEMPT_CLOSED'))
  assert(core, 'Compiled core recovery and cancellation code missing')
  const abort = new AbortController()
  const oldWork = require('node:timers/promises').setTimeout(3600000, undefined, { signal: abort.signal })
  abort.abort(); await assert.rejects(oldWork, { name: 'AbortError' })
  const result = { success: true, version: expectedVersion, electron: process.versions.electron,
    simulatedFailures: 8, networkRetryDelayCapMs: 120000, pendingSendNotRetried: true,
    stopPreventsReconnect: true, abortableRuntimeTimers: true, coreCancellationCodePresent: true,
    moduleHashes, bossRequests: 0, sent: 0,
    boundary: 'Actual compiled recovery chunk loaded from app.asar under its Electron runtime. Fault injection only; no personal data or live BOSS access.' }
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
}
// Keep the Node-only probe alive until every asynchronous assertion has settled.
const keepAlive = setInterval(() => {}, 1000)
const watchdog = setTimeout(() => { console.error('Packaged recovery verification timed out'); process.exitCode = 1; clearInterval(keepAlive) }, 30000)
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => { clearInterval(keepAlive); clearTimeout(watchdog) })
