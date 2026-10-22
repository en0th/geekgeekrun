import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Module } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const compiled = await build({ entryPoints: [path.join(here, '../src/main/features/updater.ts')],
  bundle: true, format: 'cjs', platform: 'node', packages: 'external', write: false, logLevel: 'silent',
  plugins: [{ name: 'update-platform-fixture', setup(builder) {
    builder.onResolve({ filter: /^electron$|runtime-file-utils\.mjs$/ }, args => ({ path: args.path, namespace: 'update-fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'update-fixture' }, () => ({ contents: `
      const f=globalThis.__ggrUpdateMain;
      export const ipcMain=f.ipc,BrowserWindow={getAllWindows:()=>f.windows};
      export const readConfigFile=f.read,writeConfigFile=f.write;
    ` }))
  } }] })
const release = (version = '0.99.0') => ({ tag_name: 'ui-v' + version, draft: false, prerelease: false,
  html_url: 'https://github.com/example/app/releases/tag/ui-v' + version, body: 'Fixture release',
  assets: ['dmg', 'exe', 'deb'].map(ext => ({ name: 'fixture.' + ext, browser_download_url: 'https://example.com/fixture.' + ext })) })
function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-update-settings-')), file = path.join(folder, 'update.json')
  const handlers = new Map(), events = [], requests = []
  const f = { windows: [{ isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (channel, settings) => {
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), settings)
    events.push({ channel, settings })
  } } }], ipc: { handle: (name, fn) => handlers.set(name, fn) }, failWrite: false,
    read: name => { assert.equal(name, 'update.json'); return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null },
    write: async (name, value) => {
      assert.equal(name, 'update.json')
      if (f.failWrite) throw Error('disk full')
      fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 })
    },
    fetch: async (_url, options) => { requests.push(options); return { ok: true, json: async () => [release()] } },
  }
  globalThis.__ggrUpdateMain = f
  function reload() {
    const filename = path.join(here, 'update-main.generated.cjs'), loaded = new Module(filename)
    loaded.filename = filename; loaded.paths = Module._nodeModulePaths(here)
    loaded._compile('const fetch=(...args)=>globalThis.__ggrUpdateMain.fetch(...args);\n' + compiled.outputFiles[0].text, filename)
    loaded.exports.initUpdateIpc()
    return loaded.exports
  }
  const api = reload()
  t.after(() => { fs.rmSync(folder, { recursive: true, force: true }); delete globalThis.__ggrUpdateMain })
  return { f, api, file, events, requests, reload,
    invoke: (name, payload) => Promise.resolve().then(() => handlers.get(name)({}, payload)) }
}

test('automatic checking defaults on and manual checks use the same release result', async t => {
  const f = fixture(t)
  assert.deepEqual(await f.invoke('get-update-settings'), { autoCheck: true, ignoredVersions: [] })
  assert.equal((await f.invoke('check-update')).releaseVersion, '0.99.0')
  assert.equal(f.requests.length, 1)
})

test('disabled checks never request the network and the preference survives a fresh service instance', async t => {
  const f = fixture(t)
  await f.invoke('set-update-auto-check', false)
  assert.equal(await f.invoke('check-update'), null)
  assert.equal(f.requests.length, 0)
  const reloaded = f.reload()
  assert.equal(await reloaded.checkUpdateForUi(), null)
  assert.equal(f.requests.length, 0)
  assert.equal((await reloaded.checkUpdateForUi({ manual: true })).releaseVersion, '0.99.0')
  assert.equal((await f.invoke('get-update-settings')).autoCheck, false)
})

test('ignoring a version persists, hides only that release and can be restored or checked manually', async t => {
  const f = fixture(t)
  await f.invoke('ignore-update-version', '0.99.0')
  f.reload()
  assert.equal(await f.invoke('check-update'), null)
  assert.equal((await f.invoke('check-update', { manual: true })).releaseVersion, '0.99.0')
  f.f.fetch = async () => ({ ok: true, json: async () => [release('1.0.0')] })
  assert.equal((await f.invoke('check-update')).releaseVersion, '1.0.0')
  await f.invoke('restore-ignored-update-versions')
  assert.deepEqual((await f.invoke('get-update-settings')).ignoredVersions, [])
})

test('turning checks off aborts a running automatic request and prevents a late result', async t => {
  const f = fixture(t)
  let resolve, signal, started
  const beginning = new Promise(done => { started = done })
  f.f.fetch = (_url, options) => { signal = options.signal; started(); return new Promise(done => { resolve = done }) }
  const pending = f.api.checkUpdateForUi()
  await beginning
  await f.invoke('set-update-auto-check', false)
  assert.equal(signal.aborted, true)
  resolve({ ok: true, json: async () => [release()] })
  assert.equal(await pending, null)
})

test('ignoring while a response is pending filters its result at completion', async t => {
  const f = fixture(t)
  let resolve, started
  const beginning = new Promise(done => { started = done })
  f.f.fetch = () => { started(); return new Promise(done => { resolve = done }) }
  const pending = f.api.checkUpdateForUi()
  await beginning
  await f.invoke('ignore-update-version', '0.99.0')
  resolve({ ok: true, json: async () => [release()] })
  assert.equal(await pending, null)
})

test('concurrent preference edits merge, and failed saves neither publish nor change persisted values', async t => {
  const f = fixture(t)
  await Promise.all([f.invoke('set-update-auto-check', false), f.invoke('ignore-update-version', '0.99.0')])
  assert.deepEqual(await f.invoke('get-update-settings'), { autoCheck: false, ignoredVersions: ['0.99.0'] })
  const events = f.events.length, saved = fs.readFileSync(f.file, 'utf8')
  f.f.failWrite = true
  await assert.rejects(f.invoke('set-update-auto-check', true), /disk full/)
  assert.equal(fs.readFileSync(f.file, 'utf8'), saved)
  assert.equal(f.events.length, events)
  f.f.failWrite = false
  await f.invoke('set-update-auto-check', true)
  assert.equal((await f.invoke('get-update-settings')).autoCheck, true)
  await assert.rejects(f.invoke('ignore-update-version', 'not-a-version'), /版本号无效/)
  await assert.rejects(f.invoke('set-update-auto-check', 'false'), /设置无效/)
})

test('network failures and malformed stored preferences are reported without claiming the app is up to date', async t => {
  const f = fixture(t)
  f.f.fetch = async () => ({ ok: false, status: 429 })
  await assert.rejects(f.invoke('check-update', { manual: true }), /HTTP 429/)
  fs.writeFileSync(f.file, '{"autoCheck":"false"}')
  let requested = false
  f.f.fetch = async () => { requested = true }
  await assert.rejects(f.invoke('check-update'), /更新设置格式无效/)
  assert.equal(requested, false)
})

test('a cancelled automatic request remains cancelled after checks are enabled again', async t => {
  const f = fixture(t)
  let fail, started
  const beginning = new Promise(done => { started = done })
  f.f.fetch = () => { started(); return new Promise((_resolve, reject) => { fail = reject }) }
  const pending = f.api.checkUpdateForUi()
  await beginning
  await f.invoke('set-update-auto-check', false)
  await f.invoke('set-update-auto-check', true)
  fail(Error('The request was aborted'))
  assert.equal(await pending, null)
})

test('manual requests continue when automatic checks are disabled', async t => {
  const f = fixture(t)
  let resolve, signal, started
  const beginning = new Promise(done => { started = done })
  f.f.fetch = (_url, options) => { signal = options.signal; started(); return new Promise(done => { resolve = done }) }
  const pending = f.api.checkUpdateForUi({ manual: true })
  await beginning
  await f.invoke('set-update-auto-check', false)
  assert.equal(signal.aborted, false)
  resolve({ ok: true, json: async () => [release()] })
  assert.equal((await pending).releaseVersion, '0.99.0')
})

test('a window closing during a broadcast cannot turn a committed save into a failure', async t => {
  const f = fixture(t)
  f.f.windows.unshift({ isDestroyed: () => false, webContents: { isDestroyed: () => false,
    send() { throw Error('Object has been destroyed') } } })
  const next = await f.invoke('set-update-auto-check', false)
  assert.equal(next.autoCheck, false)
  assert.equal(f.events.length, 1)
  assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).autoCheck, false)
})

test('a timed out request reports failure instead of claiming no update is available', async t => {
  const f = fixture(t)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let started
  const beginning = new Promise(done => { started = done })
  f.f.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true }); started()
  })
  const pending = f.api.checkUpdateForUi({ manual: true })
  await beginning
  t.mock.timers.tick(15000)
  await assert.rejects(pending, /检测更新超时/)
})

test('the real atomic config API persists across processes and preserves files on failed writes or corrupt JSON', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-update-runtime-'))
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }))
  const real = await build({ entryPoints: [path.join(here, '../src/main/features/update-settings.ts')],
    bundle: true, format: 'cjs', platform: 'node', packages: 'external', write: false, logLevel: 'silent' })
  function execute(body) {
    const child = spawnSync(process.execPath, ['-e', `
      const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
      const {Module}=require('node:module'),filename=${JSON.stringify(path.join(here, 'update-runtime.generated.cjs'))};
      const loaded=new Module(filename);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));
      loaded._compile(${JSON.stringify(real.outputFiles[0].text)},filename);
      const api=loaded.exports,file=path.join(process.env.GEEKGEEKRUN_RUNTIME_DIR,'config','update.json');
      (async()=>{${body}})().catch(error=>{console.error(error);process.exitCode=1});
    `], { encoding: 'utf8', timeout: 15000,
      env: { ...process.env, GEEKGEEKRUN_RUNTIME_DIR: folder, GEEKGEEKRUN_TASK_CONFIG_FILE: '' } })
    assert.equal(child.status, 0, child.stderr || String(child.error))
  }
  execute(`
    assert.deepEqual(await api.getUpdateSettings(),{autoCheck:true,ignoredVersions:[]});
    await api.setUpdateAutoCheck(false);await api.ignoreUpdateVersion('ui-v0.99.0');
    assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),{autoCheck:false,ignoredVersions:['0.99.0']});
    if(process.platform!=='win32')assert.equal(fs.statSync(file).mode&0o077,0);
  `)
  execute(`
    assert.deepEqual(await api.getUpdateSettings(),{autoCheck:false,ignoredVersions:['0.99.0']});
    const before=fs.readFileSync(file,'utf8'),rename=fs.renameSync;
    fs.renameSync=(source,target)=>{if(target===file)throw Object.assign(Error('fixture disk full'),{code:'ENOSPC'});return rename(source,target)};
    await assert.rejects(api.setUpdateAutoCheck(true),/ENOSPC/);fs.renameSync=rename;
    assert.equal(fs.readFileSync(file,'utf8'),before);
    assert.deepEqual(fs.readdirSync(path.dirname(file)),['update.json']);
    await api.setUpdateAutoCheck(true);assert.equal((await api.getUpdateSettings()).autoCheck,true);
    const broken='{"autoCheck":false,';fs.writeFileSync(file,broken);
    await assert.rejects(api.getUpdateSettings(),/JSON/);
    await assert.rejects(api.setUpdateAutoCheck(true),/JSON/);
    assert.equal(fs.readFileSync(file,'utf8'),broken);
  `)
})
