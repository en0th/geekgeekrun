import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Module } from 'node:module'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import atomic from '../../utils/atomic-file.cjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const compiled = await build({ entryPoints: [path.join(here, '../src/main/features/ux-config.ts')],
  bundle: true, format: 'cjs', platform: 'node', packages: 'external', write: false, logLevel: 'silent',
  plugins: [{ name: 'isolated-platform-services', setup(builder) {
    builder.onResolve({ filter: /^electron$|runtime-file-utils\.mjs$|atomic-json\.mjs$|browser-history$|puppeteer-executable$|open-browser-download-window$|boss-operation$/ },
      args => ({ path: args.path, namespace: 'json-platform-fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'json-platform-fixture' }, () => ({ contents: `
      const f=globalThis.__ggrJsonPersistence;
      export const ipcMain=f.ipc, BrowserWindow={fromWebContents:()=>null}, safeStorage=f.safeStorage;
      export const configFolderPath=f.config,storageFilePath=f.storage;
      export const readConfigFile=f.readConfig,readStorageFile=f.readStorage;
      export const ensureConfigFileExist=()=>{},ensureStorageFileExist=()=>{};
      export const writeFileAtomicSync=f.atomic.writeFileAtomicSync,writeJsonAtomicSync=f.atomic.writeJsonAtomicSync,writeFilesAtomicSync=f.atomic.writeFilesAtomicSync;
      export const getLastUsedAndAvailableBrowser=async()=>null,getAnyAvailablePuppeteerExecutable=async()=>null,openBrowserDownloadWindow=()=>{};
      export const defaultPromptMap={open:{fileName:'open.txt',content:''},rechat:{fileName:'rechat.txt',content:''}};
    ` }))
  } }] })
const draft = () => ({ overrides: {}, scopes: {}, sourceList: [{ type: 'search', enabled: true, children: [{ keyword: 'Python', enabled: true }] }],
  ...Object.fromEntries(['titles', 'cities', 'companies', 'excluded', 'experience', 'categories', 'description', 'inheritedFields', 'moreSources', 'sourceWords'].map(k => [k, []])) })
const model = (id, secret = 'fixture-key') => ({ id, model: 'local-fixture', providerCompleteApiUrl: 'https://fixture.invalid/v1', providerApiSecret: secret, enabled: true })

function fixture(t, options = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-ux-json-'))
  t.after(() => { fs.rmSync(folder, { recursive: true, force: true }); delete globalThis.__ggrJsonPersistence })
  const config = path.join(folder, 'config'), storage = path.join(folder, 'storage')
  fs.mkdirSync(config); fs.mkdirSync(storage)
  const write = (name, value) => fs.writeFileSync(path.join(config, name), JSON.stringify(value))
  write('boss.json', { autoReminder: { geminiApiKey: 'fixture-legacy-key' } })
  write('common-job-condition-config.json', {})
  write('target-company-list.json', ['old-company'])
  write('llm.json', [model('primary')])
  write('dingtalk.json', {})
  fs.writeFileSync(path.join(storage, 'ux-workspace.json'), JSON.stringify({ revision: 0, state: null }))
  const handlers = new Map(), listeners = new Map()
  const fixtureState = { config, storage,
    ipc: { handle: (name, fn) => handlers.set(name, fn), on: (name, fn) => listeners.set(name, fn) },
    atomic: atomic.createAtomicFileIO({ pause() {}, io: { ...fs, ...options.io } }),
    safeStorage: { isEncryptionAvailable: () => false, encryptString: text => Buffer.from('ENC' + text), decryptString: bytes => bytes.toString().slice(3), ...options.safeStorage },
    readConfig: name => JSON.parse(fs.readFileSync(path.join(config, name), 'utf8')),
    readStorage: (name, { isJson = true } = {}) => {
      const file = path.join(storage, name)
      if (!fs.existsSync(file)) return null
      const text = fs.readFileSync(file, 'utf8'); return isJson ? JSON.parse(text) : text
    }
  }
  globalThis.__ggrJsonPersistence = fixtureState
  const filename = path.join(here, 'isolated-json-platform.cjs')
  const loaded = new Module(filename)
  loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.join(here, '..'))
  loaded._compile(compiled.outputFiles[0].text, filename)
  loaded.exports.initUxIpc()
  return { ...fixtureState, folder, handlers, listeners, write,
    invoke: (name, payload) => handlers.get(name)({}, payload),
    payload: patch => ({ expectedRevision: 0, state: { draft: draft() }, configPatch: patch }) }
}

test('actual settings IPC rolls back a failed multi-file save and can retry the same revision', async t => {
  let fail = true
  const f = fixture(t, { io: { renameSync(from, to) {
    if (fail && path.basename(to) === 'target-company-list.json') throw Object.assign(Error('busy'), { code: 'EPERM' })
    fs.renameSync(from, to)
  } } })
  const originalBoss = fs.readFileSync(path.join(f.config, 'boss.json'), 'utf8')
  const payload = f.payload({ expectCompanies: ['new-company'], autoChatRunBudget: { requests: 30, detailRequests: 10, activeMinutes: 20 } })
  await assert.rejects(f.invoke('ux-save-state', payload), { code: 'EPERM' })
  assert.equal(fs.readFileSync(path.join(f.config, 'boss.json'), 'utf8'), originalBoss)
  assert.deepEqual(f.readConfig('target-company-list.json'), ['old-company'])
  assert.equal(f.readStorage('ux-workspace.json').revision, 0)
  fail = false
  assert.equal((await f.invoke('ux-save-state', payload)).revision, 1)
  assert.equal(f.readConfig('boss.json').autoReminder.geminiApiKey, 'fixture-legacy-key')
  assert.deepEqual(f.readConfig('target-company-list.json'), ['new-company'])
  assert.equal(f.readStorage('ux-workspace.json').revision, 1)
  assert.equal([...fs.readdirSync(f.config), ...fs.readdirSync(f.storage)].some(name => name.endsWith('.tmp')), false)
})

test('concurrent settings submissions retain revision checks and never partially save the rejected draft', async t => {
  const f = fixture(t)
  const results = await Promise.allSettled([
    f.invoke('ux-save-state', f.payload({ expectJobNameRegExpStr: 'first' })),
    f.invoke('ux-save-state', f.payload({ expectJobNameRegExpStr: 'second' }))
  ])
  assert.equal(results[0].status, 'fulfilled')
  assert.equal(results[1].status, 'rejected')
  assert.equal(f.readConfig('boss.json').expectJobNameRegExpStr, 'first')
  assert.equal(f.readStorage('ux-workspace.json').revision, 1)
})

test('a corrupt workspace is kept without resetting its revision or leaking parse fragments', async t => {
  const f = fixture(t), file = path.join(f.storage, 'ux-workspace.json'), broken = '{"fixture":"DO_NOT_ECHO",'
  fs.writeFileSync(file, broken)
  await assert.rejects(f.invoke('ux-load-state'), error => /原文件已保留/.test(error.message) && !error.message.includes('DO_NOT_ECHO'))
  assert.equal(fs.readFileSync(file, 'utf8'), broken)
  assert.deepEqual(fs.readdirSync(f.storage), ['ux-workspace.json'])
})

test('exit-draft IPC strips unsaved keys and retains the previous draft if replacement fails', t => {
  let fail = false
  const f = fixture(t, { io: { renameSync(from, to) {
    if (fail && path.basename(to) === 'ux-close-draft.json') throw Object.assign(Error('busy'), { code: 'EBUSY' })
    fs.renameSync(from, to)
  } } })
  const send = state => {
    const event = { sender: { getURL: () => 'file:///fixture/#/ux/auto' } }
    f.listeners.get('ux-store-close-draft')(event, { state: { draft: state }, models: [model('primary', 'UNSAVED_FIXTURE_SECRET')], autoDirty: true })
    return event.returnValue
  }
  assert.equal(send(draft()).ok, true)
  const file = path.join(f.storage, 'ux-close-draft.json'), before = fs.readFileSync(file, 'utf8')
  assert.equal(before.includes('UNSAVED_FIXTURE_SECRET'), false)
  fail = true
  assert.equal(send({ ...draft(), titles: ['new'] }).ok, false)
  assert.equal(fs.readFileSync(file, 'utf8'), before)
})

test('legacy model backup must be durable before replacing models and remains encrypted', async t => {
  let fail = true
  const f = fixture(t, { safeStorage: { isEncryptionAvailable: () => true }, io: { openSync(file, ...args) {
    if (fail && String(file).includes('llm-legacy-backup-')) throw Object.assign(Error('full'), { code: 'ENOSPC' })
    return fs.openSync(file, ...args)
  } } })
  const old = [model('one'), model('two'), model('three')]
  f.write('llm.json', old)
  await assert.rejects(f.invoke('ux-save-models', [model('primary')]), { code: 'ENOSPC' })
  assert.deepEqual(f.readConfig('llm.json'), old)
  fail = false
  const result = await f.invoke('ux-save-models', [model('primary')])
  assert.equal(result.legacyBackedUp, true)
  assert.equal(result.models[0].providerApiSecret, '')
  const backups = fs.readdirSync(f.storage).filter(name => name.endsWith('.encrypted'))
  assert.equal(backups.length, 1)
  assert.ok(fs.readFileSync(path.join(f.storage, backups[0]), 'utf8').startsWith('ENC'))
})

test('malformed manual-cookie IPC is rejected before writing and its errors omit cookie text', async () => {
  const source = fs.readFileSync(path.join(here, '../src/main/utils/initPublicIpc.ts'), 'utf8')
  const start = source.indexOf("  ipcMain.handle('write-storage-file'")
  let handler
  const writes = []
  const context = vm.createContext({ ensureStorageFileExist() {}, writeStorageFile: async (...args) => writes.push(args),
    ipcMain: { handle: (_name, fn) => { handler = fn } } })
  vm.runInContext(source.slice(start, source.indexOf("  ipcMain.handle('get-os-platform'", start)), context)
  await assert.rejects(handler({}, { fileName: 'boss-cookies.json', data: '{"cookie":"FIXTURE_PRIVATE_VALUE",' }),
    error => /有效 JSON/.test(error.message) && !error.message.includes('FIXTURE_PRIVATE_VALUE'))
  assert.equal(writes.length, 0)
  await handler({}, { fileName: 'boss-cookies.json', data: '[]' })
  assert.equal(writes.length, 1)
})

test('automatic login publishes its cookie notification only after both session files save', async () => {
  const source = fs.readFileSync(path.join(here, '../../launch-bosszhipin-login-page-with-preload-extension/index.mjs'), 'utf8')
  const start = source.indexOf('    const [cookies, localStorage] =')
  const code = source.slice(start, source.indexOf('    // let the message', start))
  for (const failing of [false, true]) {
    const events = []
    let release, captured
    const writing = new Promise((resolve, reject) => { release = () => failing ? reject(Error('disk full')) : resolve() })
    const context = vm.createContext({ page: { cookies: async () => [{ name: 'n', value: 'v' }], evaluate: async () => ({ storageKey: 'captured' }) },
      writeBossSession: payload => { captured = payload; return writing }, loginEventBus: { emit: (...args) => events.push(args) } })
    const saving = vm.runInContext('(async()=>{' + code + '})()', context)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(events.length, 0)
    assert.deepEqual(JSON.parse(JSON.stringify(captured.localStorage)), { storageKey: 'captured' })
    if (failing) { const rejected = assert.rejects(saving, /disk full/); release(); await rejected }
    else { release(); await saving }
    assert.equal(events.length, failing ? 0 : 1)
  }
})
