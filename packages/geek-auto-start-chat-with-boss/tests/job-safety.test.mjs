import test from 'node:test'
import assert from 'node:assert/strict'
import { missingJobFields, ExpiringBlockSet } from '../job-safety.mjs'

test('a missing 薪数 does not block a job, even in annual salary mode', () => {
  const row = { salaryLow: 20, salaryHigh: 30, salaryMonth: null }
  assert.deepEqual(missingJobFields(row, { salary: true, annual: true }), [])
})

test('an unparseable salary is still reported when the salary filter is on', () => {
  assert.deepEqual(missingJobFields({ salaryLow: null, salaryHigh: null }, { salary: true }), ['薪资信息不足'])
})

test('an unknown or unrecognised active status does not block a job', () => {
  for (const active of [undefined, null, '', '在线']) {
    assert.deepEqual(missingJobFields({ active }, { activity: true, activeLabels: ['', '刚刚活跃'] }), [], String(active))
  }
})

test('required text fields are still reported when their filter is on', () => {
  assert.deepEqual(missingJobFields({ bossTitle: '  ' }, { hr: true }), ['招聘者身份信息不足'])
})

test('timed blocks expire while session blocks stay', () => {
  let now = 1000
  const blocks = new ExpiringBlockSet(() => now)
  blocks.add('session')
  blocks.setExpiry('timed', 2000)
  assert.deepEqual([...blocks], ['session', 'timed'])
  now = 2000
  assert.equal(blocks.has('timed'), false)
  assert.deepEqual([...blocks], ['session'])
})
