const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { build } = require('esbuild')
const { AsyncSeriesHook, SyncHook } = require('tapable')

let Database
try {
  Database = require('better-sqlite3')
  new Database(':memory:').close()
} catch { Database = null }
const skip = !Database && 'Run with the project Electron runtime for native SQLite'

const hooks = () => Object.fromEntries(['pageGotten', 'userInfoResponse', 'mainFlowWillLaunch',
  'jobDetailIsGetFromRecommendList', 'jobMatchedForCollection', 'newChatWillStartup', 'newChatStartup', 'jobMarkedAsNotSuit']
  .map(name => [name, name === 'pageGotten' ? new SyncHook(['data']) : new AsyncSeriesHook(['data', 'options'])]))

test('real history queries and plugin startup isolate two accounts', { skip }, async () => {
  const Plugin = require('../dist/index.js').default
  const { JobInfo } = require('../dist/entity/JobInfo.js')
  const { ChatStartupLog } = require('../dist/entity/ChatStartupLog.js')
  const { MarkAsNotSuitLog } = require('../dist/entity/MarkAsNotSuitLog.js')
  const handlers = require('../dist/handlers.js')
  const { MarkAsNotSuitReason } = require('../dist/enums.js')
  const plugin = new Plugin(':memory:')
  const ds = await plugin.initPromise
  ds.setOptions({ logging: false })
  try {
    for (const account of ['a', 'b']) {
      await ds.getRepository(JobInfo).save({ encryptJobId: 'job-' + account, encryptBossId: 'boss-' + account,
        encryptCompanyId: 'company', jobName: '工程师', positionName: '软件开发', experienceName: '经验不限', description: '岗位说明' })
      await ds.getRepository(ChatStartupLog).save({ encryptJobId: 'job-' + account, encryptCurrentUserId: account, date: new Date() })
      await ds.getRepository(MarkAsNotSuitLog).save({ encryptJobId: 'blocked-' + account, encryptCurrentUserId: account,
        date: new Date(), markOp: 2, markReason: MarkAsNotSuitReason.JOB_NOT_SUIT })
    }
    assert.deepEqual(await handlers.getChatStartupRecordsInLastSomeDays(ds, 30), [])
    assert.deepEqual(await handlers.getNotSuitMarkRecordsInLastSomeDays(ds, 7, ''), [])
    assert.deepEqual((await handlers.getChatStartupRecordsInLastSomeDays(ds, 30, 'a')).map(row => row.encryptJobId), ['job-a'])
    assert.deepEqual((await handlers.getNotSuitMarkRecordsInLastSomeDays(ds, 7, 'b')).map(row => row.encryptJobId), ['blocked-b'])
    const events = hooks()
    plugin.apply(events)
    const blocked = new Set(), bosses = new Set()
    await events.mainFlowWillLaunch.promise({ jobNotMatchStrategy: 2, blockJobNotSuit: blocked,
      blockBossNotActive: new Set(), blockBossNotNewChat: bosses })
    assert.equal(blocked.size, 0)
    assert.equal(bosses.size, 0)
    await assert.rejects(events.newChatWillStartup.promise({}), /LOGIN_STATUS_UNKNOWN/)
    await events.userInfoResponse.promise({ userInfoResponse: { code: 0, zpData: { encryptUserId: 'b', name: 'B' } } })
    assert.deepEqual([...blocked], ['blocked-b'])
    assert.deepEqual([...bosses], ['boss-b'])
    await assert.doesNotReject(events.newChatWillStartup.promise({}))
  } finally { await ds.destroy() }
})

test('salary migration preserves old rows, monthly values, and wildcard views', { skip }, async () => {
  const { AddSalaryUnits1792454400000 } = require('../dist/migrations/1792454400000-AddSalaryUnits.js')
  const db = new Database(':memory:')
  try {
    db.exec("CREATE TABLE job_info (encryptJobId TEXT PRIMARY KEY, salaryLow REAL, salaryHigh REAL); INSERT INTO job_info VALUES ('old', 10, 20); CREATE VIEW v_job_library AS SELECT job_info.* FROM job_info")
    const migration = new AddSalaryUnits1792454400000()
    const runner = { query: async sql => db.exec(sql) }
    await migration.up(runner)
    const row = db.prepare('SELECT * FROM v_job_library').get()
    assert.deepEqual([row.encryptJobId, row.salaryLow, row.salaryHigh, row.salaryUnit], ['old', 10, 20, null])
    assert.ok(Object.hasOwn(row, 'salaryDesc'))
    await migration.down(runner)
    assert.deepEqual(db.prepare('SELECT * FROM v_job_library').get(), { encryptJobId: 'old', salaryLow: 10, salaryHigh: 20 })
  } finally { db.close() }
})

test('job nature backfill uses the latest valid captured type and preserves explicit saved labels', { skip }, async () => {
  const { BackfillJobNatures1792454600000 } = require('../dist/migrations/1792454600000-BackfillJobNatures.js')
  const db = new Database(':memory:')
  try {
    db.exec('CREATE TABLE job_info (encryptJobId TEXT PRIMARY KEY, jobNatureName TEXT, salaryLow REAL); CREATE TABLE job_info_change_log (id INTEGER PRIMARY KEY, encryptJobId TEXT, updateTime TEXT, dataAsJson TEXT)')
    const samples = [['full', { jobType: 0 }, '全职'], ['intern', { jobType: 4 }, '实习'],
      ['part', { jobType: '6' }, '兼职'], ['unknown', { jobType: 5 }, null], ['boolean', { jobType: false }, null],
      ['named', { jobNatureName: '实习', jobType: 0 }, '实习'], ['legacy', { jobType: 1902 }, '实习']]
    for (const [id, raw] of samples) {
      db.prepare('INSERT INTO job_info VALUES (?,NULL,10)').run(id)
      db.prepare('INSERT INTO job_info_change_log(encryptJobId,updateTime,dataAsJson) VALUES (?, ?, ?)').run(id, '2026-10-20', JSON.stringify(raw))
    }
    db.prepare('INSERT INTO job_info VALUES (?,NULL,10)').run('invalid')
    db.prepare('INSERT INTO job_info_change_log(encryptJobId,updateTime,dataAsJson) VALUES (?, ?, ?)').run('invalid', '2026-10-20', 'not JSON')
    db.prepare('UPDATE job_info SET jobNatureName=? WHERE encryptJobId=?').run('实习', 'full')
    db.prepare('INSERT INTO job_info_change_log(encryptJobId,updateTime,dataAsJson) VALUES (?, ?, ?)').run('intern', '2026-10-21', JSON.stringify({ jobType: 6 }))
    await new BackfillJobNatures1792454600000().up({ query: async sql => db.exec(sql) })
    for (const [id,, expected] of samples) {
      const row = db.prepare('SELECT * FROM job_info WHERE encryptJobId=?').get(id)
      assert.equal(row.jobNatureName, id === 'full' ? '实习' : id === 'intern' ? '兼职' : expected, id)
      assert.equal(row.salaryLow, 10)
    }
    assert.equal(db.prepare('SELECT jobNatureName FROM job_info WHERE encryptJobId=?').get('invalid').jobNatureName, null)
  } finally { db.close() }
})

test('network capture and the actual detail hook persist one consistent daily-salary version', { skip }, async () => {
  const Plugin = require('../dist/index.js').default
  const { JobInfo } = require('../dist/entity/JobInfo.js')
  const { JobInfoChangeLog } = require('../dist/entity/JobInfoChangeLog.js')
  const { BossActiveStatusRecord } = require('../dist/entity/BossActiveStatusRecord.js')
  const plugin = new Plugin(':memory:')
  const ds = await plugin.initPromise
  ds.setOptions({ logging: false })
  try {
    const events = hooks()
    plugin.apply(events)
    let onResponse
    events.pageGotten.call({ on: (_, callback) => { onResponse = callback } })
    const detail = {
      jobInfo: { encryptId: 'captured', encryptUserId: 'recruiter', jobName: '实习工程师', positionName: '软件开发',
        experienceName: '在校生', degreeName: '本科', postDescription: '岗位说明', salaryDesc: '150-250元/天', jobNatureName: '实习' },
      bossInfo: { name: '示例招聘者', title: 'HR', activeTimeDesc: '今日活跃' },
      brandComInfo: { encryptBrandId: 'company', brandName: '示例公司', customerBrandName: '示例公司',
        scaleName: '100-499人', industryName: '互联网', stageName: 'A轮', labels: [] }
    }
    await Promise.all([
      onResponse({ url: () => 'https://www.zhipin.com/wapi/zpgeek/job/detail.json', json: async () => ({ code: 0, zpData: structuredClone(detail) }) }),
      events.jobDetailIsGetFromRecommendList.promise(structuredClone(detail))
    ])
    const row = await ds.getRepository(JobInfo).findOneByOrFail({ encryptJobId: 'captured' })
    assert.deepEqual([row.salaryLow, row.salaryHigh, row.salaryUnit, row.salaryAmountLow, row.salaryAmountHigh, row.jobNatureName],
      [null, null, 'day', 150, 250, '实习'])
    assert.equal(await ds.getRepository(JobInfoChangeLog).count(), 1)
    assert.equal(await ds.getRepository(BossActiveStatusRecord).count(), 1)
  } finally { await ds.destroy() }
})

test('matched-only collection does not persist preloaded or rejected details before the acceptance hook', { skip }, async () => {
  const { EventEmitter } = require('node:events')
  const Plugin = require('../dist/index.js').default
  const { JobInfo } = require('../dist/entity/JobInfo.js')
  const plugin = new Plugin(':memory:', { collectOnlyMatched: true })
  plugin.runRecordId = 42
  const ds = await plugin.initPromise
  ds.setOptions({ logging: false })
  try {
    const events = hooks(), page = new EventEmitter()
    plugin.apply(events); events.pageGotten.call(page)
    const detail = { jobInfo: { encryptId: 'matched', encryptUserId: 'boss', jobName: '工程实习', positionName: '软件开发',
      degreeName: '本科', experienceName: '在校生', postDescription: '岗位说明', salaryDesc: '200-250元/天', jobType: 4 },
      bossInfo: { name: '示例招聘者', title: 'HR', activeTimeDesc: '今日活跃' },
      brandComInfo: { encryptBrandId: 'company', brandName: '示例公司', customerBrandName: '示例公司',
        scaleName: '100-499人', industryName: '互联网', stageName: 'A轮', labels: [] } }
    page.emit('response', { url: () => 'https://www.zhipin.com/wapi/zpgeek/job/detail.json', json: async () => ({ code: 0, zpData: detail }) })
    await events.jobDetailIsGetFromRecommendList.promise(detail)
    assert.equal(await ds.getRepository(JobInfo).count(), 0)
    assert.equal(ds.driver.databaseConnection.prepare('SELECT COUNT(*) AS n FROM job_run_observation').get().n, 0)
    await events.jobMatchedForCollection.promise(detail)
    const row = await ds.getRepository(JobInfo).findOneByOrFail({ encryptJobId: 'matched' })
    assert.equal(row.jobNatureName, '实习')
    assert.equal(row.salaryUnit, 'day')
    assert.equal(ds.driver.databaseConnection.prepare('SELECT COUNT(*) AS n FROM job_run_observation WHERE runRecordId=42').get().n, 1)
    assert.equal(ds.driver.databaseConnection.prepare('SELECT COUNT(*) AS n FROM chat_startup_log').get().n, 0)
  } finally { await ds.destroy() }
})

test('daily salaries round trip through the production import and query engine', { skip }, async () => {
  const Plugin = require('../dist/index.js').default
  const result = await build({ entryPoints: [path.resolve(__dirname, '../../ui/src/main/flow/OPEN_SETTING_WINDOW/utils/db/worker/run-data.ts')],
    bundle: true, format: 'cjs', platform: 'node', packages: 'external', write: false, logLevel: 'silent' })
  const filename = path.join(__dirname, 'run-data-fixture.cjs')
  const compiled = new Module(filename, module)
  compiled.filename = filename
  compiled.paths = Module._nodeModulePaths(path.resolve(__dirname, '../../ui'))
  compiled._compile(result.outputFiles[0].text, filename)
  const engine = compiled.exports
  const plugin = new Plugin(':memory:')
  const ds = await plugin.initPromise
  ds.setOptions({ logging: false })
  try {
    const db = ds.driver.databaseConnection
    const input = { encryptJobId: 'daily', jobName: '工程实习', positionName: '软件开发', description: '岗位说明',
      experienceName: '在校生', salaryDesc: '150-250元/天', salaryLow: 150, salaryHigh: 250, jobNatureName: '实习' }
    const first = engine.importRunData(db, { dataset: 'jobLibrary', rows: [input] })
    assert.equal(first.errors.length, 0)
    const rows = engine.queryAllRunData(db, { dataset: 'jobLibrary' })
    assert.equal(rows.length, 1)
    assert.deepEqual([rows[0].salaryLow, rows[0].salaryHigh, rows[0].salaryUnit,
      rows[0].salaryAmountLow, rows[0].salaryAmountHigh, rows[0].jobNatureName], [null, null, 'day', 150, 250, '实习'])
    assert.equal(engine.importRunData(db, { dataset: 'jobLibrary', rows }).errors.length, 0)
    assert.equal(engine.queryAllRunData(db, { dataset: 'jobLibrary' })[0].salaryDesc, '150-250元/天')
    engine.importRunData(db, { dataset: 'jobLibrary', rows: [{ encryptJobId: 'legacy', salaryDesc: null, salaryLow: 10, salaryHigh: 20, salaryMonth: 13 }] })
    const exported = engine.queryAllRunData(db, { dataset: 'jobLibrary' })
    engine.importRunData(db, { dataset: 'jobLibrary', rows: exported })
    const legacy = engine.queryAllRunData(db, { dataset: 'jobLibrary' }).find(row => row.encryptJobId === 'legacy')
    assert.deepEqual([legacy.salaryLow, legacy.salaryHigh, legacy.salaryMonth, legacy.salaryUnit], [10, 20, 13, 'month'])
  } finally { await ds.destroy() }
})

test('company-scoped storage ignores unrelated preloads and saves only explicit reviewed or accepted details', { skip }, async () => {
  const { EventEmitter } = require('node:events')
  const Plugin = require('../dist/index.js').default
  const { JobInfo } = require('../dist/entity/JobInfo.js')
  for (const collectOnlyMatched of [false, true]) {
    const plugin = new Plugin(':memory:', { captureNetworkDetails: false, collectOnlyMatched })
    plugin.runRecordId = 99
    const ds = await plugin.initPromise; ds.setOptions({ logging: false })
    try {
      const events = hooks(), page = new EventEmitter()
      plugin.apply(events); events.pageGotten.call(page)
      const detail = { jobInfo: { encryptId: 'company-job', encryptUserId: 'boss', jobName: '工程师',
        positionName: '软件开发', degreeName: '本科', experienceName: '1-3年', postDescription: '岗位说明', salaryDesc: '10-20K' },
        bossInfo: { name: '示例招聘者', title: 'HR', activeTimeDesc: '今日活跃' },
        brandComInfo: { encryptBrandId: 'company-brand', brandName: '示例公司', customerBrandName: '示例公司',
          scaleName: '100-499人', industryName: '互联网', stageName: 'A轮', labels: [] } }
      assert.equal(page.listenerCount('response'), 0)
      page.emit('response', { url: () => 'https://www.zhipin.com/wapi/zpgeek/job/detail.json', json: async () => ({ code: 0,
        zpData: { ...detail, jobInfo: { ...detail.jobInfo, encryptId: 'unrelated-preload' } } }) })
      assert.equal(await ds.getRepository(JobInfo).count(), 0)
      await events.jobDetailIsGetFromRecommendList.promise(structuredClone(detail))
      assert.equal(await ds.getRepository(JobInfo).count(), collectOnlyMatched ? 0 : 1)
      if (collectOnlyMatched) await events.jobMatchedForCollection.promise(structuredClone(detail))
      assert.equal(await ds.getRepository(JobInfo).count(), 1)
      assert.equal(ds.driver.databaseConnection.prepare('SELECT count(*) AS n FROM job_run_observation WHERE runRecordId=99').get().n, 1)
      assert.equal(ds.driver.databaseConnection.prepare('SELECT count(*) AS n FROM chat_startup_log').get().n, 0)
      assert.equal(ds.driver.databaseConnection.prepare('SELECT count(*) AS n FROM mark_as_not_suit_log').get().n, 0)
    } finally { await ds.destroy() }
  }
})
