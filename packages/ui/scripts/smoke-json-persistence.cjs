// Execute with the packaged Electron in node mode; every write stays in a throwaway folder.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const assert = require('node:assert/strict'), { createRequire } = require('node:module')
if (!process.env.GGR_QA_ARCHIVE || !path.isAbsolute(process.env.GGR_QA_ARCHIVE))
  throw Error('请用 GGR_QA_ARCHIVE 指定 app.asar 的绝对路径，并用打包后的 Electron 执行此脚本')
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-packaged-json-'))
process.env.GEEKGEEKRUN_RUNTIME_DIR = folder
delete process.env.GEEKGEEKRUN_TASK_CONFIG_FILE
const fromApp = createRequire(process.env.GGR_QA_ARCHIVE + '/package.json')

;(async () => {
  const rename = fs.renameSync
  try {
    const fromLauncher = createRequire(fromApp.resolve('@geekgeekrun/launch-bosszhipin-login-page-with-preload-extension/package.json'))
    const runtime = fromLauncher('@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs')
    runtime.ensureConfigFileExist(); runtime.ensureStorageFileExist()
    const cookies = [{ name: 'fixture', value: 'sample', domain: '.zhipin.com' }]
    await runtime.writeBossSession({ cookies, localStorage: { session: 'sample' } })
    const cookieFile = path.join(runtime.storageFilePath, 'boss-cookies.json')
    const storageFile = path.join(runtime.storageFilePath, 'boss-local-storage.json')
    const previousCookie = fs.readFileSync(cookieFile), previousStorage = fs.readFileSync(storageFile)
    fs.renameSync = (from, to) => {
      if (to === storageFile) throw Object.assign(Error('simulated sharing violation'), { code: 'EBUSY' })
      return rename(from, to)
    }
    await assert.rejects(runtime.writeBossSession({ cookies: [{ name: 'fixture', value: 'new' }], localStorage: { session: 'new' } }),
      error => error.code === 'GGR_FILE_WRITE_FAILED')
    fs.renameSync = rename
    assert.deepEqual(fs.readFileSync(cookieFile), previousCookie)
    assert.deepEqual(fs.readFileSync(storageFile), previousStorage)
    await assert.rejects(runtime.writeBossSession({ cookies: [], localStorage: {} }))
    fs.writeFileSync(cookieFile, '{')
    assert.throws(() => runtime.readStorageFile('boss-cookies.json'), error => error.code === 'GGR_JSON_INVALID')
    assert.equal(fs.readFileSync(cookieFile, 'utf8'), '{')
    await runtime.writeBossSession({ cookies, localStorage: { session: 'sample' } })
    await runtime.writeConfigFile('boss.json', { fixture: true })
    assert.deepEqual(runtime.readConfigFile('boss.json'), { fixture: true })
    const fromPm = createRequire(fromApp.resolve('@geekgeekrun/pm/package.json'))
    const { writeJsonAtomicSync } = fromPm('@geekgeekrun/utils/atomic-file.cjs')
    const history = path.join(folder, 'fixture-history.json')
    writeJsonAtomicSync(history, [{ fixture: true }])
    assert.deepEqual(JSON.parse(fs.readFileSync(history)), [{ fixture: true }])
    assert.equal(fs.readdirSync(runtime.storageFilePath).some(name => name.endsWith('.tmp')), false)
    console.log('PACKAGED_JSON_PERSISTENCE_OK: session rollback; corrupt file retained; runtime config round trip; daemon helper packaged.')
  } finally {
    fs.renameSync = rename
    fs.rmSync(folder, { recursive: true, force: true })
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
