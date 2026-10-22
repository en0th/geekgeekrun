// Runs with the installed application's Electron binary and its packaged dependencies.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const [phase, runtime, expectedVersion, output] = process.argv.slice(2)
assert.ok(['fresh', 'seed', 'upgrade', 'reopen'].includes(phase))
assert.ok(path.isAbsolute(runtime))
const resources = process.platform === 'darwin'
  ? path.resolve(path.dirname(process.execPath), '../Resources')
  : path.join(path.dirname(process.execPath), 'resources')
const archive = path.join(resources, 'app.asar')
const pkg = require(path.join(archive, 'package.json'))
assert.equal(pkg.version, expectedVersion)
assert.equal(process.versions.electron, '39.2.7')
const plugin = path.join(archive, 'node_modules/@geekgeekrun/sqlite-plugin/dist')
const storage = path.join(runtime, 'storage')
const databaseFile = path.join(storage, 'public.db')
const snapshotFile = path.join(runtime, 'fixture-snapshot.json')
const tables = ['job_info', 'job_info_change_log', 'chat_startup_log', 'favorite_job', 'auto_start_chat_run_record']
const snapshot = async db => Object.fromEntries(await Promise.all(tables.map(async table =>
  [table, await db.query('SELECT * FROM ' + table + ' ORDER BY 1')])))
let db

async function main() {
  fs.mkdirSync(storage, { recursive: true })
  if (phase === 'fresh' || phase === 'seed') assert.equal(fs.existsSync(databaseFile), false)
  db = await require(path.join(plugin, 'index.js')).initDb(databaseFile)
  db.setOptions({ logging: false })
  const entity = name => require(path.join(plugin, 'entity', name + '.js'))[name]
  if (phase === 'seed') {
    for (const [id, type] of [['monthly', 0], ['intern', 4], ['invalid', null]]) {
      await db.getRepository(entity('JobInfo')).save({ encryptJobId: id,
        jobName: 'Offline upgrade fixture', positionName: 'Software', experienceName: '经验不限', degreeName: '本科',
        salaryLow: id === 'monthly' ? 12 : null, salaryHigh: id === 'monthly' ? 20 : null,
        salaryMonth: id === 'monthly' ? 13 : null, description: 'Synthetic fixture without a live account',
        encryptBossId: 'fixture-boss', encryptCompanyId: 'fixture-company' })
      await db.getRepository(entity('JobInfoChangeLog')).save({ encryptJobId: id,
        updateTime: new Date('2026-10-19T00:00:00Z'),
        dataAsJson: type === null ? 'invalid historical JSON' : JSON.stringify({ jobType: type }) })
    }
    // Synthetic history only: this script never loads browser or messaging hooks.
    await db.getRepository(entity('ChatStartupLog')).save({ encryptJobId: 'monthly',
      encryptCurrentUserId: 'fixture-account', date: new Date('2026-10-19T00:00:00Z') })
    await db.getRepository(entity('FavoriteJob')).save({ folderId: 17, encryptJobId: 'monthly',
      createdAt: new Date('2026-10-19T00:00:00Z') })
    await db.getRepository(entity('AutoStartChatRunRecord')).save({ date: new Date('2026-10-19T00:00:00Z'),
      configSnapshot: JSON.stringify({ fixture: true, collectOnly: true, city: '100010000' }) })
    const migrations = await db.query('SELECT timestamp, name FROM migrations ORDER BY timestamp')
    assert.equal(migrations.length, 9)
    fs.writeFileSync(snapshotFile, JSON.stringify({ rows: await snapshot(db), migrations }))
  }
  const rows = await snapshot(db)
  const migrations = await db.query('SELECT timestamp, name FROM migrations ORDER BY timestamp')
  if (phase === 'fresh') {
    assert.equal(migrations.length, 15)
    assert.ok(Object.values(rows).every(items => items.length === 0))
  } else if (phase !== 'seed') {
    const before = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'))
    assert.equal(migrations.length, 15)
    assert.deepEqual(migrations.slice(0, before.migrations.length), before.migrations)
    for (const table of tables) {
      assert.equal(rows[table].length, before.rows[table].length, table)
      before.rows[table].forEach((row, i) => {
        for (const [key, value] of Object.entries(row)) assert.deepEqual(rows[table][i][key], value, table + '.' + key)
      })
    }
    assert.deepEqual(await db.query('SELECT encryptJobId, jobNatureName FROM job_info ORDER BY encryptJobId'), [
      { encryptJobId: 'intern', jobNatureName: '实习' }, { encryptJobId: 'invalid', jobNatureName: null },
      { encryptJobId: 'monthly', jobNatureName: '全职' }])
    const discovery = await db.query('SELECT origin, firstSeenAt, firstSeenRunId FROM job_discovery')
    assert.equal(discovery.length, 3)
    assert.ok(discovery.every(row => row.origin === 'legacy' && row.firstSeenAt === null && row.firstSeenRunId === null))
    for (const table of ['job_run_observation', 'job_run_scope', 'job_import_record', 'mark_as_not_suit_log'])
      assert.equal((await db.query('SELECT COUNT(*) n FROM ' + table))[0].n, 0, table)
    const view = await db.query('SELECT * FROM v_job_library')
    assert.equal(view.length, 3)
    for (const key of ['salaryUnit', 'salaryAmountLow', 'jobNatureName', 'companyBrandName']) assert.ok(Object.hasOwn(view[0], key))
  }
  assert.deepEqual(await db.query('PRAGMA integrity_check'), [{ integrity_check: 'ok' }])
  assert.deepEqual(await db.query('PRAGMA foreign_key_check'), [])
  await db.destroy(); db = null
  const result = { success: true, phase, version: pkg.version, platform: process.platform, arch: process.arch,
    electron: process.versions.electron, abi: process.versions.modules, migrations: migrations.length,
    jobs: rows.job_info.length, historicalChats: rows.chat_startup_log.length, sent: 0, marked: 0, bossRequests: 0 }
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
}

main().catch(async error => {
  console.error(error)
  if (db?.isInitialized) await db.destroy()
  process.exitCode = 1
})
