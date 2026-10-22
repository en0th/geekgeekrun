import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Module } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { build } from 'esbuild'
import { createPinia } from 'pinia'

const here = path.dirname(fileURLToPath(import.meta.url))
const compiled = await build({ entryPoints: [path.join(here, '../src/renderer/src/store/index.ts')],
  bundle: true, format: 'cjs', platform: 'node', packages: 'external', write: false, logLevel: 'silent' })
const settle = () => new Promise(resolve => setImmediate(resolve))
const release = { releaseVersion: '0.99.0', releasePageUrl: 'https://example.com/release', assetUrl: 'https://example.com/app', assetName: 'fixture', releaseNote: '' }
function fixture(t, initial = { autoCheck: true, ignoredVersions: [] }, options = {}) {
  const events = new EventEmitter(), timers = new Map(), calls = []
  let id = 0, saved = structuredClone(initial)
  const f = { failWrite: false, check: async () => release, load: async () => structuredClone(saved),
    electron: { ipcRenderer: {
      on: (name, fn) => { events.on(name, fn); return () => events.off(name, fn) },
      invoke: async (name, payload) => {
        calls.push({ name, payload })
        if (name === 'get-update-settings') return f.load()
        if (name === 'check-update') return f.check(payload)
        if (f.failWrite) throw Error('disk full')
        if (name === 'set-update-auto-check') saved.autoCheck = payload
        if (name === 'ignore-update-version') saved.ignoredVersions = [...saved.ignoredVersions, payload]
        if (name === 'restore-ignored-update-versions') saved.ignoredVersions = []
        const next = structuredClone(saved)
        events.emit('update-settings-changed', {}, next)
        return f.reply(name, next)
      },
    } },
    reply: async (_name, next) => next,
    setInterval: (fn, delay) => { assert.equal(delay, 30 * 60 * 1000); const key = ++id; timers.set(key, fn); return key },
    clearInterval: key => timers.delete(key),
  }
  Object.assign(f, options)
  globalThis.__ggrUpdateStore = f
  const filename = path.join(here, 'update-store.generated.cjs'), loaded = new Module(filename)
  loaded.filename = filename; loaded.paths = Module._nodeModulePaths(here)
  loaded._compile('const {electron,setInterval,clearInterval}=globalThis.__ggrUpdateStore;\n' + compiled.outputFiles[0].text, filename)
  const store = loaded.exports.useUpdateStore(createPinia())
  t.after(() => { store.$dispose(); delete globalThis.__ggrUpdateStore })
  return { f, store, timers, calls, events, checks: () => calls.filter(call => call.name === 'check-update') }
}

test('switching off removes polling and the current notification immediately after persistence', async t => {
  const f = fixture(t)
  await settle()
  assert.equal(f.checks().length, 1)
  assert.equal(f.timers.size, 1)
  const staleTick = [...f.timers.values()][0]
  await f.store.setAutoCheck(false)
  assert.equal(f.timers.size, 0)
  assert.equal(f.store.availableNewRelease, null)
  staleTick(); await settle()
  assert.equal(f.checks().length, 1)
  f.store.$dispose()
  assert.equal(f.events.listenerCount('update-settings-changed'), 0)
})

test('a saved off preference starts no automatic request, but manual checks remain available', async t => {
  const f = fixture(t, { autoCheck: false, ignoredVersions: ['0.99.0'] })
  await settle()
  assert.equal(f.checks().length, 0)
  assert.equal(f.timers.size, 0)
  assert.equal((await f.store.checkUpdate(true)).releaseVersion, '0.99.0')
  assert.equal(f.checks()[0].payload.manual, true)
  await f.store.ignoreVersion('0.99.0')
  assert.equal(f.store.availableNewRelease, null)
})

test('ignoring during an in-flight check and future automatic polls cannot restore the ignored notification', async t => {
  let resolve
  const f = fixture(t, undefined, { check: () => new Promise(done => { resolve = done }) })
  await settle()
  await f.store.ignoreVersion('0.99.0')
  resolve(release); await settle()
  assert.equal(f.store.availableNewRelease, null)
  f.f.check = async () => release
  await f.store.checkUpdate()
  assert.equal(f.store.availableNewRelease, null)
  f.f.check = async () => ({ ...release, releaseVersion: '1.0.0' })
  await f.store.checkUpdate()
  assert.equal(f.store.availableNewRelease.releaseVersion, '1.0.0')
})

test('rapid off/on changes recheck after a stale response instead of waiting for the next timer', async t => {
  let resolve
  const f = fixture(t, undefined, { check: () => new Promise(done => { resolve = done }) })
  await settle()
  await f.store.setAutoCheck(false)
  await f.store.setAutoCheck(true)
  f.f.check = async () => ({ ...release, releaseVersion: '1.0.0' })
  resolve(release); await settle()
  assert.equal(f.checks().length, 2)
  assert.equal(f.store.availableNewRelease.releaseVersion, '1.0.0')
  assert.equal(f.timers.size, 1)
})

test('failed saves retain existing preferences and notifications and allow retry', async t => {
  const f = fixture(t)
  await settle()
  f.f.failWrite = true
  await assert.rejects(f.store.setAutoCheck(false), /disk full/)
  assert.equal(f.store.settings.autoCheck, true)
  assert.equal(f.store.availableNewRelease.releaseVersion, '0.99.0')
  assert.equal(f.timers.size, 1)
  f.f.failWrite = false
  await f.store.setAutoCheck(false)
  assert.equal(f.store.error, '')
  assert.equal(f.store.settings.autoCheck, false)
})

test('a newer preference notification wins over a late initial settings response', async t => {
  let resolve
  const f = fixture(t, undefined, { load: () => new Promise(done => { resolve = done }) })
  f.events.emit('update-settings-changed', {}, { autoCheck: false, ignoredVersions: [] })
  resolve({ autoCheck: true, ignoredVersions: [] }); await settle()
  assert.equal(f.store.settings.autoCheck, false)
  assert.equal(f.checks().length, 0)
  assert.equal(f.timers.size, 0)
})

test('late save replies cannot undo newer settings from another window', async t => {
  const f = fixture(t)
  await settle()
  let finish
  f.f.reply = (_name, next) => new Promise(resolve => { finish = () => resolve(next) })
  const pending = f.store.setAutoCheck(false)
  await settle()
  f.events.emit('update-settings-changed', {}, { autoCheck: true, ignoredVersions: [] })
  finish(); await pending; await settle()
  assert.equal(f.store.settings.autoCheck, true)
  assert.equal(f.timers.size, 1)
  assert.equal(f.store.availableNewRelease.releaseVersion, '0.99.0')
})

test('saving stays busy until all outstanding replies finish', async t => {
  const f = fixture(t)
  await settle()
  const replies = []
  f.f.reply = (_name, next) => new Promise(resolve => replies.push(() => resolve(next)))
  const first = f.store.setAutoCheck(false)
  const second = f.store.ignoreVersion('0.99.0')
  await settle()
  replies[0](); await first
  assert.equal(f.store.saving, true)
  replies[1](); await second
  assert.equal(f.store.saving, false)
  assert.deepEqual(f.store.settings, { autoCheck: false, ignoredVersions: ['0.99.0'] })
})

test('retrying a failed settings load clears its error and restores polling', async t => {
  const f = fixture(t, undefined, { load: async () => { throw Error('配置暂不可读') } })
  await settle()
  assert.equal(f.store.ready, false)
  assert.equal(f.timers.size, 0)
  assert.match(f.store.error, /配置暂不可读/)
  f.f.load = async () => ({ autoCheck: false, ignoredVersions: [] })
  await f.store.loadSettings(); await settle()
  assert.equal(f.store.ready, true)
  assert.equal(f.store.error, '')
  assert.equal(f.checks().length, 0)
})

test('restoring ignored versions checks immediately and disposal discards pending results', async t => {
  const f = fixture(t, { autoCheck: true, ignoredVersions: ['0.99.0'] })
  await settle()
  assert.equal(f.store.availableNewRelease, null)
  await f.store.restoreIgnoredVersions(); await settle()
  assert.equal(f.store.availableNewRelease.releaseVersion, '0.99.0')
  let resolve
  f.f.check = () => new Promise(done => { resolve = done })
  const pending = f.store.checkUpdate()
  f.store.$dispose()
  resolve({ ...release, releaseVersion: '1.0.0' }); await pending
  assert.equal(f.store.availableNewRelease.releaseVersion, '0.99.0')
  assert.equal(f.timers.size, 0)
})
