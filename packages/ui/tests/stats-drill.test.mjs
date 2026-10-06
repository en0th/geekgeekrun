import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import { build } from 'esbuild'

// filters.ts uses extensionless TS imports, so bundle it for node first
const here = path.dirname(fileURLToPath(import.meta.url))
const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-drill-')), 'filters.mjs')
await build({
  entryPoints: [path.join(here, '../src/renderer/src/features/RunDataTable/filters.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent'
})
const { drillToFilter, bucketRange } = await import(pathToFileURL(outfile).href)
const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

test('a plain value becomes a 过滤条件 row, never a header filter', () => {
  assert.deepEqual(drillToFilter({ field: 'companyName' }, '腾讯'), {
    kind: 'rows',
    rows: [{ field: 'companyName', op: 'eq', value: '腾讯' }]
  })
  // enum values use option keys, as the filter builder does
  assert.deepEqual(drillToFilter({ field: 'markReason' }, 6, 'enum'), {
    kind: 'rows',
    rows: [{ field: 'markReason', op: 'in', value: ['6'] }]
  })
  assert.deepEqual(drillToFilter({ field: 'chatStartupFrom' }, null, 'enum'), {
    kind: 'rows',
    rows: [{ field: 'chatStartupFrom', op: 'in', value: ['null'] }]
  })
  assert.deepEqual(drillToFilter({ field: 'jobCount' }, '3', 'number').rows, [{ field: 'jobCount', op: 'eq', value: 3 }])
  assert.deepEqual(drillToFilter({ field: 'address' }, null).rows, [{ field: 'address', op: 'isEmpty' }])
})

test('day and month buckets become local date ranges', () => {
  const [ds, de] = bucketRange('day', '2026-03-05')
  assert.deepEqual([fmt(ds), fmt(de)], ['2026-03-05 00:00', '2026-03-05 23:59'])
  const [ms, me] = bucketRange('month', '2026-02')
  assert.deepEqual([fmt(ms), fmt(me)], ['2026-02-01 00:00', '2026-02-28 23:59'])
  const f = drillToFilter({ field: 'date', bucket: 'day' }, '2026-03-05')
  assert.equal(f.kind, 'rows')
  assert.equal(f.rows[0].op, 'between')
})

test('week buckets follow SQLite %W (Monday weeks, week 00 before the first Monday)', () => {
  // 2026-01-01 is a Thursday; the first Monday is 2026-01-05
  assert.deepEqual(bucketRange('week', '2026-W00').map(fmt), ['2026-01-01 00:00', '2026-01-04 23:59'])
  assert.deepEqual(bucketRange('week', '2026-W01').map(fmt), ['2026-01-05 00:00', '2026-01-11 23:59'])
  assert.deepEqual(bucketRange('week', '2026-W10').map(fmt), ['2026-03-09 00:00', '2026-03-15 23:59'])
})

test('number ranges become comparisons matching the stats buckets', () => {
  assert.deepEqual(drillToFilter({ field: 'salaryLow', bucket: 'numberRange' }, '<5').rows, [{ field: 'salaryLow', op: 'lt', value: 5 }])
  assert.deepEqual(drillToFilter({ field: 'salaryLow', bucket: 'numberRange' }, '50+').rows, [{ field: 'salaryLow', op: 'gte', value: 50 }])
  assert.deepEqual(drillToFilter({ field: 'salaryLow', bucket: 'numberRange' }, '10-15').rows, [
    { field: 'salaryLow', op: 'gte', value: 10 },
    { field: 'salaryLow', op: 'lt', value: 15 }
  ])
})

test('hour and weekday buckets are reported as unsupported', () => {
  assert.equal(drillToFilter({ field: 'date', bucket: 'hour' }, '09').kind, 'unsupported')
  assert.equal(drillToFilter({ field: 'date', bucket: 'weekday' }, '1').kind, 'unsupported')
})
