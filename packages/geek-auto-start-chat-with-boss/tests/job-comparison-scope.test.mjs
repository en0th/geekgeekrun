import test from 'node:test'
import assert from 'node:assert/strict'
import { jobComparisonScope } from '../job-comparison-scope.mjs'

const config = () => ({ 'boss.json': { autoChatRunMode: 'collect', expectCityList: ['上海', '北京'],
  jobSourceList: [{ type: 'search', enabled: true, children: [{ enabled: true, keyword: ' Java ', positionCodes: ['100109', '100101'] }] }] },
  'common-job-condition-config.json': { expectSalaryLow: 10 }, 'target-company-list.json': ['乙公司', '甲公司'] })

test('comparison normalizes source keywords, multi-select sets and object property order', () => {
  const a = config(), b = config()
  b['boss.json'].expectCityList.reverse(); b['target-company-list.json'].reverse()
  b['boss.json'].jobSourceList[0].children[0] = { keyword: 'Java', enabled: true, positionCodes: ['100101', '100109', '100101'] }
  assert.equal(jobComparisonScope(a), jobComparisonScope(b))
  assert.match(jobComparisonScope(a), /^v1:[a-f0-9]{64}$/)
})

test('every filter, source, collection mode and inherited config affects comparison identity', () => {
  const a = config()
  for (const mutate of [
    b => { b['boss.json'].jobSourceList[0].children[0].positionCodes = ['100101'] },
    b => { b['boss.json'].expectCityList = ['上海'] },
    b => { b['boss.json'].autoChatRunMode = 'chat' },
    b => { b['boss.json'].collectOnlyMatchingJobs = false },
    b => { b['boss.json'].requiredJobConditions = { degreeNames: ['本科'] } },
    b => { b['common-job-condition-config.json'].expectSalaryLow = 20 },
    b => { b['target-company-list.json'] = ['其他公司'] },
    b => { b['boss.json'].customRange = [20, 10] },
  ]) { const b = config(); mutate(b); assert.notEqual(jobComparisonScope(a), jobComparisonScope(b)) }
})

test('unknown positional arrays retain order rather than being treated as selection sets', () => {
  const a = config(), b = config()
  a['boss.json'].customRange = [10, 20]; b['boss.json'].customRange = [20, 10]
  assert.notEqual(jobComparisonScope(a), jobComparisonScope(b))
})

test('budget, window, pacing and unrelated notification settings do not split an unchanged search scope', () => {
  const a = config(), b = config()
  Object.assign(b['boss.json'], { autoChatRunBudget: { requests: 999 }, autoChatRunInBackground: false,
    jobListLoadWaitSeconds: 1, isSageTimeEnabled: false, autoReminder: { geminiApiKey: 'fixture' } })
  assert.equal(jobComparisonScope(a), jobComparisonScope(b))
})

test('implicit recommendations cannot claim a complete search identity from local configuration', () => {
  const a = config()
  a['boss.json'].jobSourceList.push({ type: 'expect', enabled: true })
  assert.equal(jobComparisonScope(a), null)
})

test('company comparison binds to brand and company keyword while ignoring presentation labels and URL tracking', () => {
  const a = config(), b = config(), brand = '0123456789abcdef1nRz'
  a['boss.json'].jobSourceList = [{ type: 'company', enabled: true, children: [{ enabled: true, brandId: brand, keyword: 'Java' }] }]
  b['boss.json'].jobSourceList = [{ type: 'company', enabled: true, children: [{ enabled: true,
    brandId: `https://www.zhipin.com/gongsi/${brand}.html?ka=tracking`, keyword: ' Java ', label: '备注' }] }]
  assert.match(jobComparisonScope(a), /^v1:/)
  assert.equal(jobComparisonScope(a), jobComparisonScope(b))
  b['boss.json'].jobSourceList[0].children[0].brandId = 'fedcba98765432101nRz'
  assert.notEqual(jobComparisonScope(a), jobComparisonScope(b))
  b['boss.json'].jobSourceList[0].children[0].brandId = brand
  b['boss.json'].jobSourceList[0].children[0].keyword = 'Python'
  assert.notEqual(jobComparisonScope(a), jobComparisonScope(b))
})
