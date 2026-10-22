import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Module } from 'node:module'
import { build } from 'esbuild'
import { adaptScraperRecords, scraperCapturedAt } from '../src/common/scraper-import.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const built = await build({ entryPoints: [path.join(here, '../src/renderer/src/features/RunDataTable/io.ts')],
  bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' })
const filename = path.join(here, 'scraper-io.generated.cjs'), loaded = new Module(filename)
loaded.filename = filename; loaded.paths = Module._nodeModulePaths(here)
loaded._compile(built.outputFiles[0].text, filename)
const { parseImportFile } = loaded.exports

test('scraper brands, stable IDs and missing JD are mapped without inventing recruiter names or task history', () => {
  const { rows, warnings, ignoredHeaders } = adaptScraperRecords([{ job_id: 'md5-from-scraper', encrypt_job_id: 'job001',
    encrypt_brand_id: 'brand', encrypt_boss_id: 'hr', title: 'Python', boss_name: '品牌', boss_title: '招聘经理',
    company_scale: '20-99人', salary: '200-300元/天', is_new: true }], { scraped_at: '2026-10-20T10:30:00' })
  assert.deepEqual([rows[0].encryptJobId, rows[0].companyName, rows[0].bossTitle], ['job001', '品牌', '招聘经理'])
  assert.deepEqual([rows[0].companyScaleLow, rows[0].companyScaleHigh], [20, 99])
  for (const field of ['bossName', 'job_id', 'firstSeenAt', 'firstSeenRunId', 'publishDate', 'is_new']) assert.equal(rows[0][field], undefined)
  assert.equal(rows[0].description, null)
  assert.equal(rows[0].sourceCapturedAt, '2026-10-20T10:30:00')
  assert.ok(warnings.some(w => w.includes('没有 JD')))
  assert.deepEqual(ignoredHeaders, ['is_new', 'job_id'])
})

test('CSV-only identifiers come from validated BOSS job links and ambiguous or untrusted IDs are skipped', () => {
  const rows = adaptScraperRecords([
    { job_id: 'md5-only' },
    { job_link: 'https://evil.example/job_detail/x.html' },
    { encrypt_job_id: 'direct', job_link: 'https://www.zhipin.com/job_detail/other.html' },
    { job_link: 'https://www.zhipin.com/job_detail/%2Fescape.html' },
    { encrypt_job_id: 123 },
    { job_link: 'https://www.zhipin.com/job_detail/00123~.html?securityId=ignored' }
  ]).rows
  assert.deepEqual(rows.map(r => r.encryptJobId), [null, null, null, null, null, '00123~'])
  assert.equal(scraperCapturedAt('not a date'), null)
  assert.equal(scraperCapturedAt('2026-10-20T10:30:00+08:00'), '2026-10-20T10:30:00+08:00')
})

test('real JSON file parsing recognizes the jobs container and provides a reviewable preview before any write', async () => {
  const file = new File([JSON.stringify({ scraped_at: '2026-10-20T10:30:00', keyword: 'Python', jobs: [
    { encrypt_job_id: 'job', title: 'Python 工程师', boss_name: '品牌', jd: 'Python\nSQL' }
  ] })], 'scraper.json')
  const parsed = await parseImportFile('jobLibrary', file, 'boss-zhipin-scraper')
  assert.equal(parsed.sourceFormat, 'boss-zhipin-scraper')
  assert.equal(parsed.rows[0].description, 'Python\nSQL')
  assert.equal(parsed.rows[0].sourceCapturedAt, '2026-10-20T10:30:00')
  assert.ok(parsed.mappedFields.some(field => field.key === 'encryptJobId'))
  assert.ok(parsed.warnings.length)
  await assert.rejects(parseImportFile('bossLibrary', file, 'boss-zhipin-scraper'), /仅支持/)
  await assert.rejects(parseImportFile('jobLibrary', file), /scraper/)
})

test('the real CSV parser accepts list/detail exports, preserves ID zeros and quoted multiline JD', async () => {
  const file = new File(['\ufeffjob_id,title,company,salary,job_link,jd\r\nmd5,实习生,品牌,200元/天,https://www.zhipin.com/job_detail/00123.html,"Python\nSQL"\r\n'], 'details.csv')
  const parsed = await parseImportFile('jobLibrary', file, 'boss-zhipin-scraper')
  assert.equal(parsed.rows[0].encryptJobId, '00123')
  assert.equal(parsed.rows[0].companyName, '品牌')
  assert.equal(parsed.rows[0].description, 'Python\nSQL')
  assert.equal(parsed.rows[0].sourceCapturedAt, null)
  assert.equal(parsed.rows[0].encryptBossId, null)
})
