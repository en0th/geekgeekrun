const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { build } = require('esbuild')
const { AsyncSeriesHook, SyncHook } = require('tapable')
let Database
try { Database = require('better-sqlite3'); new Database(':memory:').close() } catch { Database = null }
const skip = !Database && 'Requires native SQLite'
const signature = 'v1:' + 'a'.repeat(64), other = 'v1:' + 'b'.repeat(64)
const job = id => ({ encryptJobId: id, jobName: 'Python', positionName: '', experienceName: '',
  description: 'Python SQL', encryptBossId: '', encryptCompanyId: '' })
async function fixture(t) {
  const plugin = require('../dist/index.js')
  const ds = await plugin.initDb(':memory:'); ds.setOptions({ logging: false })
  t.after(() => ds.destroy())
  const db = ds.driver.databaseConnection
  const { bindJobRunScope, getJobRunComparison } = require('../dist/job-run-comparison.js')
  const { saveCapturedJob } = require('../dist/job-discovery.js')
  const bind = (id, account = 'account', scope = signature) => bindJobRunScope(db, id, account, scope)
  const capture = (run, ...ids) => ids.forEach(id => saveCapturedJob(db, job(id), run))
  return { db, bind, capture, compare: (id, base) => getJobRunComparison(db, id, base) }
}

test('same-scope differences use observed IDs, survive resumes and ignore unrelated accounts/ranges', { skip }, async t => {
  const f = await fixture(t)
  f.bind(1); f.capture(1, 'same', 'previous')
  f.bind(2, 'another'); f.capture(2, 'added')
  f.bind(3, 'account', other); f.capture(3, 'added')
  f.bind(4); f.capture(4, 'same', 'added'); f.bind(4); f.capture(4, 'added')
  const result = f.compare(4)
  assert.deepEqual([result.baselineRunId, result.currentObserved, result.baselineObserved,
    result.added, result.retained, result.notObserved], [1, 2, 2, 1, 1, 1])
  f.db.prepare('DELETE FROM job_info WHERE encryptJobId = ?').run('previous')
  assert.equal(f.compare(4).notObserved, 1)
  f.bind(5); f.capture(5, 'same'); f.bind(6); f.capture(6, 'same', 'added')
  assert.equal(f.compare(6).baselineRunId, 5)
  assert.equal(f.compare(6, 1).baselineRunId, 1)
})

test('missing, empty or mixed historical scopes do not make every observed job new', { skip }, async t => {
  const f = await fixture(t)
  f.capture(1, 'old'); assert.equal(f.compare(1).added, null)
  f.bind(1); assert.match(f.compare(1).reason, /启用范围/)
  f.bind(2); f.bind(3); f.capture(3, 'new')
  assert.equal(f.compare(3).baselineRunId, null)
  assert.equal(f.compare(3).added, null)
  f.bind(4); f.capture(4, 'new'); f.bind(4, 'account', other); f.bind(4)
  assert.match(f.compare(4).reason, /范围发生变化/)
  assert.equal(f.compare(4).added, null)
  f.bind(5); f.capture(5, 'new'); f.bind(5, 'account', null); f.bind(5)
  assert.match(f.compare(5).reason, /范围发生变化/)
})

test('explicit comparison bases reject different accounts, ranges, later IDs and SQL-shaped IDs', { skip }, async t => {
  const f = await fixture(t)
  for (const id of [1, 2, 3]) { f.bind(id, id === 2 ? 'another' : 'account'); f.capture(id, 'same') }
  for (const base of [2, 3, 999, '1 OR 1=1', -1, true]) assert.throws(() => f.compare(3, base), /基准|编号/)
  assert.throws(() => f.compare('3 OR 1=1'), /编号/)
})

test('difference filtering is shared by page, export, distinct, statistics and JD summary queries', { skip }, async t => {
  const f = await fixture(t)
  f.bind(1); f.capture(1, 'same')
  f.bind(2); f.capture(2, 'same', 'added')
  const compiled = await build({ entryPoints: [path.resolve(__dirname, '../../ui/src/main/flow/OPEN_SETTING_WINDOW/utils/db/worker/run-data.ts')],
    bundle: true, format: 'cjs', platform: 'node', packages: 'external', write: false, logLevel: 'silent' })
  const filename = path.join(__dirname, 'comparison-engine.cjs'), loaded = new Module(filename, module)
  loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.resolve(__dirname, '../../ui'))
  loaded._compile(compiled.outputFiles[0].text, filename)
  const e = loaded.exports, query = { dataset: 'jobLibrary', context: { jobRunId: 2, jobComparison: true } }
  assert.deepEqual(e.queryAllRunData(f.db, query).map(r => r.encryptJobId), ['added'])
  assert.equal(e.queryRunData(f.db, { ...query, pageNo: 1, pageSize: 10 }).totalItemCount, 1)
  assert.equal(e.getRunDataStats(f.db, { ...query, groups: [] }).total, 1)
  assert.equal(e.getJobSummary(f.db, query).totalJobs, 1)
  assert.equal(e.getRunDataDistinctValues(f.db, { ...query, field: 'encryptJobId' })[0].value, 'added')
  assert.throws(() => e.queryAllRunData(f.db, { ...query, context: { jobRunId: 1, jobComparison: true } }), /没有较早/)
  assert.throws(() => e.queryAllRunData(f.db, { dataset: 'bossLibrary', context: { jobComparison: true } }), /指定/)
})

test('the SQLite login hook binds the worker scope only after the account is confirmed', { skip }, async t => {
  const Plugin = require('../dist/index.js').default
  const plugin = new Plugin(':memory:', { comparisonScope: signature }), ds = await plugin.initPromise
  ds.setOptions({ logging: false }); t.after(() => ds.destroy())
  const hooks = Object.fromEntries(['pageGotten', 'userInfoResponse', 'mainFlowWillLaunch',
    'jobDetailIsGetFromRecommendList', 'newChatWillStartup', 'newChatStartup', 'jobMarkedAsNotSuit']
    .map(name => [name, name === 'pageGotten' ? new SyncHook(['data']) : new AsyncSeriesHook(['data'])]))
  plugin.runRecordId = 9; plugin.apply(hooks)
  const db = ds.driver.databaseConnection
  await hooks.userInfoResponse.promise({ userInfoResponse: { code: 31 } })
  assert.equal(db.prepare('SELECT COUNT(*) n FROM job_run_scope').get().n, 0)
  await hooks.userInfoResponse.promise({ userInfoResponse: { code: 0, zpData: { encryptUserId: 'confirmed', name: 'fixture' } } })
  assert.deepEqual(db.prepare('SELECT accountId, signature, comparable FROM job_run_scope').get(),
    { accountId: 'confirmed', signature, comparable: 1 })
})

test('pre-login observations from this launch are comparable while a prior unconfirmed attempt stays excluded', { skip }, async () => {
  for (const retry of [false, true]) {
    const Plugin = require('../dist/index.js').default
    const plugin = new Plugin(':memory:', { comparisonScope: signature }), ds = await plugin.initPromise
    ds.setOptions({ logging: false })
    try {
      const hooks = Object.fromEntries(['pageGotten', 'userInfoResponse', 'mainFlowWillLaunch',
        'jobDetailIsGetFromRecommendList', 'newChatWillStartup', 'newChatStartup', 'jobMarkedAsNotSuit']
        .map(name => [name, name === 'pageGotten' ? new SyncHook(['data']) : new AsyncSeriesHook(['data'])]))
      plugin.runRecordId = 10; plugin.apply(hooks)
      await hooks.mainFlowWillLaunch.promise()
      const db = ds.driver.databaseConnection
      require('../dist/job-discovery.js').saveCapturedJob(db, job('preloaded'), 10)
      if (retry) await hooks.mainFlowWillLaunch.promise()
      await hooks.userInfoResponse.promise({ userInfoResponse: { code: 0, zpData: { encryptUserId: 'confirmed', name: 'fixture' } } })
      assert.equal(db.prepare('SELECT comparable FROM job_run_scope').get().comparable, retry ? 0 : 1)
      assert.equal(db.prepare('SELECT COUNT(*) n FROM job_run_observation').get().n, 1)
    } finally { await ds.destroy() }
  }
})
