import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSalaryDetails, matchesSalaryDetails, parseCompanySize, explicitJobNature } from '../job-values.cjs'

test('pay parsing retains the stated period and yuan amount', () => {
  for (const [raw, low, high, unit, month] of [
    ['15-20K·13薪', 15000, 20000, 'month', 13],
    ['150-250元/天', 150, 250, 'day', null],
    ['300元/天', 300, 300, 'day', null],
    ['25-40元/小时', 25, 40, 'hour', null],
    ['5000-8000元/月', 5000, 8000, 'month', null],
    ['1.5-2万元/月', 15000, 20000, 'month', null],
    ['20-30万/年', 200000, 300000, 'year', null],
    ['15K-20K', 15000, 20000, 'month', null]
  ]) assert.deepEqual(parseSalaryDetails(raw), { raw, low, high, unit, month, status: 'parsed' }, raw)
})

test('ambiguous or malformed salaries remain unknown', () => {
  assert.equal(parseSalaryDetails('薪资面议').status, 'negotiable')
  for (const raw of ['', '保密', '5000', '20-30万', '30-10K', '-10K', '15K美元', '15-20K·0薪'])
    assert.notEqual(parseSalaryDetails(raw).status, 'parsed', raw)
})

test('daily and hourly pay match only the same period, without implicit conversion', () => {
  const day = parseSalaryDetails('150-250元/天')
  assert.equal(matchesSalaryDetails(day, { low: 200, high: 300, unit: 3 }), true)
  assert.equal(matchesSalaryDetails(day, { low: 250, high: 250, unit: 3 }), true)
  assert.equal(matchesSalaryDetails(day, { low: 251, unit: 3 }), false)
  assert.equal(matchesSalaryDetails(day, { low: 0, unit: 1 }), false)
  assert.equal(matchesSalaryDetails(day, { low: 0, unit: 2 }), false)
  assert.equal(matchesSalaryDetails(day, { low: 0, unit: 4 }), false)
  assert.equal(matchesSalaryDetails(parseSalaryDetails('30元/小时'), { low: 25, high: 35, unit: 4 }), true)
})

test('monthly and annual comparison preserves the legacy K and 万 conventions', () => {
  assert.equal(matchesSalaryDetails(parseSalaryDetails('8-10K·14薪'), { low: 10, high: 15, unit: 2 }), true)
  assert.equal(matchesSalaryDetails(parseSalaryDetails('20万/年'), { low: 15, high: 20, unit: 1 }), true)
  assert.equal(matchesSalaryDetails(parseSalaryDetails('20万/年·13薪'), { low: 16, high: 18, unit: 1 }), false)
  assert.equal(matchesSalaryDetails(parseSalaryDetails('5K'), { low: 0, high: 0, unit: 1 }), false)
  assert.equal(matchesSalaryDetails(parseSalaryDetails('面议'), { low: 1, unit: 3 }), false)
})

test('company size handles bounds and rejects malformed ranges', () => {
  assert.deepEqual(parseCompanySize('20人以下'), [0, 20])
  assert.deepEqual(parseCompanySize('10000人以上'), [10000, null])
  assert.deepEqual(parseCompanySize('100–499 人'), [100, 499])
  assert.deepEqual(parseCompanySize('499-100人'), [null, null])
})

test('job type requires explicit evidence; a daily salary or title is insufficient', () => {
  assert.equal(explicitJobNature({ jobNatureName: '实习' }), '实习')
  assert.equal(explicitJobNature({ jobType: 1901 }), '全职')
  assert.equal(explicitJobNature({ jobType: 1903 }), '兼职')
  assert.equal(explicitJobNature({ jobName: '实习工程师', salaryDesc: '200元/天', jobType: 9999 }), null)
  for (const [jobType, expected] of [[0, '全职'], [4, '实习'], [6, '兼职'], ['4', '实习'], ['6', '兼职'], [1902, '实习']])
    assert.equal(explicitJobNature({ jobType }), expected)
  for (const jobType of [undefined, null, false, true, '', 5, 9999]) assert.equal(explicitJobNature({ jobType }), null)
  assert.equal(explicitJobNature({ jobType: 0, jobNatureName: '实习' }), '实习')
})
