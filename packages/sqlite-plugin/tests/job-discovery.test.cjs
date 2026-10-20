const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { build } = require('esbuild')
const { AsyncSeriesHook, SyncHook } = require('tapable')
let Database
try { Database = require('better-sqlite3'); new Database(':memory:').close() } catch { Database = null }
const skip = !Database && 'Run with the project Electron runtime for native SQLite'
const job = (id, text = 'Python SQL 数据分析') => ({ encryptJobId: id, jobName: '分析师', positionName: '数据分析',
  experienceName: '经验不限', description: text, encryptBossId: '', encryptCompanyId: '' })
async function fresh() {
  const ds = await require('../dist/index.js').initDb(':memory:')
  ds.setOptions({ logging: false })
  return ds
}
async function engine() {
  const result = await build({ entryPoints: [path.resolve(__dirname, '../../ui/src/main/flow/OPEN_SETTING_WINDOW/utils/db/worker/run-data.ts')],
    bundle: true, format: 'cjs', platform: 'node', packages: 'external', write: false, logLevel: 'silent' })
  const filename = path.join(__dirname, 'discovery-query-fixture.cjs'), compiled = new Module(filename, module)
  compiled.filename = filename; compiled.paths = Module._nodeModulePaths(path.resolve(__dirname, '../../ui'))
  compiled._compile(result.outputFiles[0].text, filename)
  return compiled.exports
}

test('discovery migration preserves old jobs and gives them no invented date or run', { skip }, async () => {
  const Migration = require('../dist/migrations/1792454500000-AddJobDiscovery.js').AddJobDiscovery1792454500000
  const db = new Database(':memory:')
  try {
    db.exec("CREATE TABLE job_info (encryptJobId TEXT PRIMARY KEY); INSERT INTO job_info VALUES ('old')")
    const runner = { query: async sql => db.exec(sql) }
    await new Migration().up(runner)
    assert.deepEqual(db.prepare('SELECT * FROM job_discovery').get(), {
      encryptJobId: 'old', firstSeenAt: null, firstSeenRunId: null, origin: 'legacy', lastSeenAt: null })
    await new Migration().down(runner)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM job_info').get().n, 1)
  } finally { db.close() }
})

test('capture is atomic, repeatable across runs and resumes, and survives detail deletion', { skip }, async () => {
  const { saveCapturedJob } = require('../dist/job-discovery.js')
  const ds = await fresh(), db = ds.driver.databaseConnection
  try {
    saveCapturedJob(db, { ...job('same'), address: '上海', publishDate: new Date('2026-10-19T00:00:00Z') }, 10)
    const initial = db.prepare('SELECT * FROM job_discovery').get()
    saveCapturedJob(db, { ...job('same', '新版 SQL'), address: undefined }, 10)
    assert.deepEqual(db.prepare('SELECT address, publishDate FROM job_info').get(), { address: '上海', publishDate: '2026-10-19 00:00:00.000' })
    saveCapturedJob(db, job('same'), 11)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM job_run_observation').get().n, 2)
    const revisited = db.prepare('SELECT * FROM job_discovery').get()
    assert.deepEqual([revisited.firstSeenAt, revisited.firstSeenRunId, revisited.origin], [initial.firstSeenAt, 10, 'capture'])
    db.prepare('DELETE FROM job_info WHERE encryptJobId = ?').run('same')
    saveCapturedJob(db, job('same'), 12)
    assert.equal(db.prepare('SELECT firstSeenRunId FROM job_discovery').get().firstSeenRunId, 10)
    assert.throws(() => saveCapturedJob(db, { ...job('failed'), jobName: null }, 12), /NOT NULL/)
    assert.equal(db.prepare('SELECT * FROM job_discovery WHERE encryptJobId = ?').get('failed'), undefined)
    saveCapturedJob(db, job('manual'), 0)
    assert.equal(db.prepare('SELECT firstSeenRunId FROM job_discovery WHERE encryptJobId = ?').get('manual').firstSeenRunId, null)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM job_run_observation WHERE runRecordId = 0').get().n, 0)
  } finally { await ds.destroy() }
})

test('identical network and detail callbacks keep observations when the content writer deduplicates', { skip }, async () => {
  const Plugin = require('../dist/index.js').default
  const plugin = new Plugin(':memory:'), ds = await plugin.initPromise
  ds.setOptions({ logging: false })
  const hooks = Object.fromEntries(['pageGotten', 'userInfoResponse', 'mainFlowWillLaunch',
    'jobDetailIsGetFromRecommendList', 'newChatWillStartup', 'newChatStartup', 'jobMarkedAsNotSuit']
    .map(name => [name, name === 'pageGotten' ? new SyncHook(['data']) : new AsyncSeriesHook(['data', 'options'])]))
  try {
    plugin.runRecordId = 21
    plugin.apply(hooks)
    let onResponse
    hooks.pageGotten.call({ on: (_, fn) => { onResponse = fn } })
    const detail = { jobInfo: { encryptId: 'same', encryptUserId: 'hr', jobName: '分析师', positionName: '数据分析',
      experienceName: '不限', postDescription: 'Python', salaryDesc: '10-20K' },
      bossInfo: { name: 'HR', title: '招聘', activeTimeDesc: '今日活跃' },
      brandComInfo: { encryptBrandId: 'co', brandName: '公司', customerBrandName: '公司', labels: [], scaleName: '20-99人' } }
    await Promise.all([
      onResponse({ url: () => 'https://www.zhipin.com/wapi/zpgeek/job/detail.json', json: async () => ({ code: 0, zpData: structuredClone(detail) }) }),
      hooks.jobDetailIsGetFromRecommendList.promise(structuredClone(detail))
    ])
    plugin.runRecordId = 22
    await hooks.jobDetailIsGetFromRecommendList.promise(structuredClone(detail))
    const db = ds.driver.databaseConnection
    assert.equal(db.prepare('SELECT COUNT(*) n FROM job_info_change_log').get().n, 1)
    assert.deepEqual(db.prepare('SELECT runRecordId FROM job_run_observation ORDER BY runRecordId').all(), [{ runRecordId: 21 }, { runRecordId: 22 }])
    assert.equal(db.prepare('SELECT firstSeenRunId FROM job_discovery').get().firstSeenRunId, 21)
  } finally { await ds.destroy() }
})

test('imports and historical rows stay outside newly discovered capture counts', { skip }, async () => {
  const e = await engine(), { saveCapturedJob } = require('../dist/job-discovery.js')
  const ds = await fresh(), db = ds.driver.databaseConnection
  try {
    assert.equal(e.importRunData(db, { dataset: 'jobLibrary', rows: [{ ...job('imported'), firstSeenRunId: 88, firstSeenAt: '2001-01-01' }] }).errors.length, 0)
    saveCapturedJob(db, job('imported'), 88)
    const imported = db.prepare('SELECT * FROM job_discovery WHERE encryptJobId = ?').get('imported')
    assert.equal(imported.origin, 'import')
    assert.equal(imported.firstSeenRunId, null)
    assert.notEqual(imported.firstSeenAt, '2001-01-01')
    // A legacy caller can still write job_info directly; its next capture must be old.
    await ds.getRepository(require('../dist/entity/JobInfo.js').JobInfo).save(job('legacy'))
    saveCapturedJob(db, job('legacy'), 88)
    assert.equal(db.prepare('SELECT origin FROM job_discovery WHERE encryptJobId = ?').get('legacy').origin, 'legacy')
    assert.equal(e.queryAllRunData(db, { dataset: 'jobLibrary', filters: [{ field: 'firstSeenRunId', op: 'eq', value: 88 }] }).length, 0)
  } finally { await ds.destroy() }
})

test('run queries, statistics and JD summaries use the same saved observation scope', { skip }, async () => {
  const e = await engine(), { saveCapturedJob } = require('../dist/job-discovery.js')
  const ds = await fresh(), db = ds.driver.databaseConnection
  try {
    saveCapturedJob(db, job('previous', 'Java JavaScript'), 1)
    saveCapturedJob(db, job('previous', 'Java JavaScript'), 2)
    saveCapturedJob(db, job('new', 'Python Python SQL'), 2)
    saveCapturedJob(db, job('outside', 'Rust'), 3)
    const query = { dataset: 'jobLibrary', context: { jobRunId: 2 } }
    assert.deepEqual(e.queryAllRunData(db, query).map(r => r.encryptJobId).sort(), ['new', 'previous'])
    assert.equal(e.getRunDataStats(db, { ...query, groups: [] }).total, 2)
    assert.equal(e.getJobSummary(db, query).totalJobs, 2)
    assert.equal(e.getJobSummary(db, { ...query, keyword: 'Python' }).totalJobs, 1)
    const onlyNew = { ...query, filters: [{ field: 'firstSeenRunId', op: 'eq', value: 2 }] }
    assert.deepEqual(e.queryAllRunData(db, onlyNew).map(r => r.encryptJobId), ['new'])
    assert.deepEqual(e.getJobSummary(db, onlyNew).skills.map(s => s.term).sort(), ['Python', 'SQL'])
    // Revisit on a later run does not move jobs out of run 2.
    saveCapturedJob(db, job('new'), 4)
    assert.equal(e.queryAllRunData(db, query).length, 2)
    assert.throws(() => e.getJobSummary(db, { ...query, filters: [{ field: 'untrusted', op: 'eq', value: 2 }] }), /Unknown field/)
    assert.throws(() => e.queryAllRunData(db, { ...query, context: { jobRunId: '2 OR 1=1' } }), /无效/)
    assert.equal(e.getJobSummary(db, { ...query, keyword: 'no-matches' }).sampledJobs, 0)
  } finally { await ds.destroy() }
})

test('summary deduplicates favourites after filtering and discloses bounded samples and JD lengths', { skip }, async () => {
  const e = await engine(), { saveCapturedJob } = require('../dist/job-discovery.js')
  const ds = await fresh(), db = ds.driver.databaseConnection
  try {
    saveCapturedJob(db, job('same', 'Python '.repeat(8000)), 1)
    db.exec("INSERT INTO favorite_folder (id,name,createdAt) VALUES (1,'一','2026-01-01'),(2,'二','2026-01-01'); INSERT INTO favorite_job (folderId,encryptJobId,createdAt) VALUES (1,'same','2026-01-01'),(2,'same','2026-01-01')")
    const favoriteSummary = e.getJobSummary(db, { dataset: 'favoriteJobs', filters: [{ field: 'folderId', op: 'eq', value: 2 }] })
    assert.equal(favoriteSummary.totalJobs, 1)
    assert.equal(favoriteSummary.truncatedDescriptions, 1)
    assert.deepEqual(favoriteSummary.skills, [{ term: 'Python', jobs: 1, percent: 100 }])
    assert.equal(e.getJobSummary(db, { dataset: 'favoriteJobs' }).sampledJobs, 1)
    db.transaction(() => { for (let i = 0; i < 5001; i++) saveCapturedJob(db, job(`job-${i}`, ''), 2) })()
    const summary = e.getJobSummary(db, { dataset: 'jobLibrary' })
    assert.deepEqual([summary.totalJobs, summary.sampledJobs, summary.sampleLimit], [5002, 5000, 5000])
    assert.equal(summary.withDescription + summary.missingDescription, 5000)
    assert.throws(() => e.getJobSummary(db, { dataset: 'companyLibrary' }), /不支持/)
  } finally { await ds.destroy() }
})
