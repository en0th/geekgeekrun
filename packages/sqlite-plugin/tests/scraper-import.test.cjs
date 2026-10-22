const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { build } = require('esbuild')
let Database
try { Database = require('better-sqlite3'); new Database(':memory:').close() } catch { Database = null }
const skip = !Database && 'Requires native SQLite'
async function fixture(t) {
  const ds = await require('../dist/index.js').initDb(':memory:'); ds.setOptions({ logging: false })
  t.after(() => ds.destroy())
  const compiled = await build({ stdin: { contents: `export * from '../../ui/src/main/flow/OPEN_SETTING_WINDOW/utils/db/worker/run-data.ts';
    export * from '../../ui/src/common/scraper-import.mjs';`, resolveDir: __dirname },
    bundle: true, format: 'cjs', platform: 'node', packages: 'external', write: false, logLevel: 'silent' })
  const filename = path.join(__dirname, 'scraper-engine.cjs'), loaded = new Module(filename, module)
  loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.resolve(__dirname, '../../ui'))
  loaded._compile(compiled.outputFiles[0].text, filename)
  const e = loaded.exports, db = ds.driver.databaseConnection
  const submit = (rows, metadata = {}, file = 'scraper.json') => e.importRunData(db, { dataset: 'jobLibrary',
    rows: e.adaptScraperRecords(rows, metadata).rows, sourceFormat: 'boss-zhipin-scraper', sourceFileName: file })
  return { db, e, submit }
}

test('offline scraper imports retain stable identity, brands, salary units, provenance and missing relationships', { skip }, async t => {
  const { db, e, submit } = await fixture(t)
  const result = submit([
    { encrypt_job_id: 'direct', title: '工程师', boss_name: '品牌', encrypt_brand_id: 'brand', encrypt_boss_id: 'hr',
      boss_title: '招聘经理', salary: '25-35K·14薪', jd: 'Python SQL', company_scale: '20-99人', company_industry: '互联网', company_stage: '未融资' },
    { job_link: 'https://www.zhipin.com/job_detail/00123.html', title: '实习生', company: '仅有品牌', salary: '200-300元/天' },
    { job_id: 'md5-only', title: '不导入' }
  ], { scraped_at: '2026-10-20T10:30:00' })
  assert.deepEqual([result.inserted, result.skipped, result.errors.length], [2, 1, 1])
  const rows = e.queryAllRunData(db, { dataset: 'jobLibrary' })
  const monthly = rows.find(r => r.encryptJobId === 'direct'), daily = rows.find(r => r.encryptJobId === '00123')
  assert.deepEqual([monthly.companyName, monthly.bossName, monthly.bossTitle], ['品牌', '', '招聘经理'])
  assert.deepEqual([monthly.companyScaleLow, monthly.companyScaleHigh, monthly.companyIndustryName, monthly.companyStageName], [20, 99, '互联网', '未融资'])
  assert.equal(daily.companyName, '仅有品牌')
  assert.equal(daily.salaryUnit, 'day'); assert.equal(daily.salaryLow, null)
  assert.equal(daily.salaryAmountLow, 200)
  assert.equal(daily.sourceCapturedAt, '2026-10-20T10:30:00')
  assert.equal(daily.firstSeenRunId, null); assert.equal(daily.discoveryOrigin, 'import')
  assert.equal(db.prepare('SELECT companyName FROM v_job_library WHERE encryptJobId = ?').get('00123').companyName, '仅有品牌')
  assert.equal(db.prepare('SELECT COUNT(*) n FROM boss_info').get().n, 1)
  for (const table of ['chat_startup_log', 'mark_as_not_suit_log', 'job_run_observation', 'job_run_scope'])
    assert.equal(db.prepare('SELECT COUNT(*) n FROM '+table).get().n, 0)
})

test('repeated list imports keep an existing JD and first discovery, and do not carry old source times into CSV', { skip }, async t => {
  const { db, e, submit } = await fixture(t)
  submit([{ encrypt_job_id: 'same', title: '工程师', jd: 'Python SQL' }], { scraped_at: '2026-10-20T10:30:00' })
  const before = db.prepare('SELECT * FROM job_discovery').get()
  submit([{ job_link: 'https://www.zhipin.com/job_detail/same.html', title: '工程师' }], {}, 'list.csv')
  assert.equal(db.prepare('SELECT COUNT(*) n FROM job_info').get().n, 1)
  assert.equal(db.prepare('SELECT description FROM job_info').get().description, 'Python SQL')
  assert.deepEqual(db.prepare('SELECT * FROM job_discovery').get(), before)
  assert.deepEqual(db.prepare('SELECT sourceCapturedAt, fileName, missingDescription FROM job_import_record').get(),
    { sourceCapturedAt: null, fileName: 'list.csv', missingDescription: 1 })
  assert.equal(e.getJobSummary(db, { dataset: 'jobLibrary' }).withDescription, 1)
})

test('a provenance write failure rolls back its job, relations and discovery while other rows still import', { skip }, async t => {
  const { db, submit } = await fixture(t)
  db.exec("CREATE TRIGGER reject_fixture BEFORE INSERT ON job_import_record WHEN NEW.encryptJobId='fail' BEGIN SELECT RAISE(ABORT,'fixture failure'); END")
  const result = submit([{ encrypt_job_id: 'fail', boss_name: '失败品牌', encrypt_brand_id: 'failed-brand' }, { encrypt_job_id: 'ok', title: '工程师' }])
  assert.deepEqual([result.inserted, result.skipped, result.errors.length], [1, 1, 1])
  for (const table of ['job_info', 'job_discovery', 'job_import_record'])
    assert.equal(db.prepare('SELECT COUNT(*) n FROM '+table+" WHERE encryptJobId='fail'").get().n, 0)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM company_info WHERE encryptCompanyId='failed-brand'").get().n, 0)
})
