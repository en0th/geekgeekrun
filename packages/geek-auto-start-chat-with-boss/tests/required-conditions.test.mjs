import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeRequiredJobConditions, requiredJobConditionReasons, matchesSalary, validateJobFilterConfig } from '../job-filter-config.mjs'
import { assertCanGreet, activateSourceAndWait } from '../auto-chat-navigation.mjs'
import { bindRunAccount } from '../run-account.mjs'
import { jobConfigSnapshot } from '../task-config-snapshot.mjs'

const detail = { jobInfo: { degreeName: '本科', jobNatureName: '实习' },
  brandComInfo: { scaleName: '100-499人', industryName: '互联网/AI', stageName: 'A轮' } }
const conditions = { companyScaleMin: 100, companyScaleMax: 500, jobNatures: ['实习'],
  degrees: ['本科', '硕士'], industries: ['互联网'], financingStages: ['A轮'] }

test('old configs enable no new hard conditions', () => {
  assert.deepEqual(requiredJobConditionReasons({}, {}), [])
  assert.deepEqual(requiredJobConditionReasons(detail, conditions), [])
})

test('a company below the required size cannot pass even when all text conditions match', () => {
  assert.deepEqual(requiredJobConditionReasons({ ...detail, brandComInfo: { ...detail.brandComInfo, scaleName: '0-20人' } }, conditions), ['公司人数范围不符合'])
  assert.deepEqual(requiredJobConditionReasons({ ...detail, brandComInfo: { scaleName: '10000人以上' } }, { companyScaleMax: 500 }), ['公司人数范围不符合'])
})

test('missing hard condition evidence and mismatching values fail closed', () => {
  assert.equal(requiredJobConditionReasons({}, conditions).length, 5)
  const bad = { ...detail, jobInfo: { degreeName: '大专', jobNatureName: '全职' } }
  assert.deepEqual(requiredJobConditionReasons(bad, conditions), ['求职类型不符合', '学历不符合'])
  for (const invalid of [{ jobNatures: ['猜测类型'] }, { companyScaleMin: 200, companyScaleMax: 100 }, { companyScaleMin: -1 }, { companyScaleMin: [] }, { companyScaleMin: true }, { industries: 'AI' }])
    assert.throws(() => normalizeRequiredJobConditions(invalid))
  for (const expectSalaryLow of [true, [], {}, ' '])
    assert.throws(() => validateJobFilterConfig({ expectSalaryLow }), /薪资金额/)
  assert.throws(() => validateJobFilterConfig({ expectSalaryLow: 100, expectSalaryCalculateWay: true }), /薪资单位/)
  assert.doesNotThrow(() => validateJobFilterConfig({ expectSalaryLow: '5', expectSalaryHigh: '', expectSalaryCalculateWay: 1 }))
})

test('the final sending gate checks hard conditions independently of matching job IDs', () => {
  const args = { isCollectMode: false, targetJobIndex: 0, matchedJobId: 'job', targetJobId: 'job', requiredConditions: conditions }
  assert.throws(() => assertCanGreet(args), /REQUIRED_CONDITION_CHAT_BLOCKED/)
  assert.doesNotThrow(() => assertCanGreet({ ...args, detail }))
  assert.throws(() => assertCanGreet({ ...args, detail, isCollectMode: true }), /COLLECT_MODE_CHAT_BLOCKED/)
})

test('run snapshots retain hard conditions and daily salary units', () => {
  const withExclusions = { ...conditions, excludedWords: ['外包', 'C++'] }
  const snapshot = jobConfigSnapshot({ 'boss.json': { requiredJobConditions: withExclusions, expectSalaryCalculateWay: 3, expectSalaryLow: 150 },
    'common-job-condition-config.json': {}, 'target-company-list.json': [] })
  assert.deepEqual(snapshot['boss.json'].requiredJobConditions, withExclusions)
  assert.equal(snapshot['boss.json'].expectSalaryCalculateWay, 3)
  assert.equal(matchesSalary({ low: 200, high: 300, unit: 'day', status: 'parsed' }, { low: 150, unit: 3 }), true)
})

test('literal exclusions check both title and JD independently of positive ANY matches', () => {
  const rules = { excludedWords: ['外包', 'C++', 'ＡＩ'] }
  const row = { jobInfo: { jobName: '后端工程师', postDescription: '开发内部产品' } }
  assert.deepEqual(requiredJobConditionReasons(row, rules), [])
  for (const [jobName, postDescription, hit] of [['外包工程师', '开发内部产品', '外包'],
    ['后端工程师', '要求 C++，熟悉底层', 'C++'], ['Ai工程师', '开发内部产品', 'ＡＩ']]) {
    assert.match(requiredJobConditionReasons({ jobInfo: { jobName, postDescription } }, rules).join('；'), new RegExp('屏蔽词'))
    assert.ok(requiredJobConditionReasons({ jobInfo: { jobName, postDescription } }, rules)[0].includes(hit))
  }
  assert.deepEqual(requiredJobConditionReasons({ jobInfo: { jobName: 'Java', postDescription: '欢迎外包团队' } }, rules), ['岗位包含屏蔽词：外包'])
})

test('enabled exclusions require complete title and JD evidence, and never authorize marking or sending', () => {
  const requiredConditions = { excludedWords: ['外包'] }
  assert.match(requiredJobConditionReasons({ jobInfo: { jobName: '开发' } }, requiredConditions)[0], /信息不足/)
  assert.match(requiredJobConditionReasons({ jobInfo: { postDescription: '研发工作' } }, requiredConditions)[0], /信息不足/)
  assert.deepEqual(requiredJobConditionReasons({}, {}), [])
  assert.throws(() => validateJobFilterConfig({ requiredJobConditions: { excludedWords: '外包' } }))
  assert.throws(() => assertCanGreet({ isCollectMode: false, targetJobIndex: 0, matchedJobId: 'x', targetJobId: 'x',
    detail: { jobInfo: { jobName: '开发', postDescription: '外包岗位' } }, requiredConditions }), /REQUIRED_CONDITION_CHAT_BLOCKED/)
})

test('resuming under a different or unconfirmed account is blocked', () => {
  assert.equal(bindRunAccount(null, 'account-a'), 'account-a')
  assert.equal(bindRunAccount('account-a', 'account-a'), 'account-a')
  assert.throws(() => bindRunAccount('account-a', 'account-b'), /ACCOUNT_CHANGED/)
  assert.throws(() => bindRunAccount(null, ''), /LOGIN_STATUS_UNKNOWN/)
})

test('source switching listens before activation so an immediate response is not missed', async () => {
  let listener, resolve
  const pending = new Promise(done => { resolve = done })
  const page = { waitForResponse: predicate => { listener = predicate; return pending } }
  const response = { url: () => 'https://www.zhipin.com/wapi/zpgeek/search/joblist.json?page=1' }
  assert.equal(await activateSourceAndWait(page, async () => {
    assert.ok(listener)
    assert.equal(listener(response), true)
    resolve(response)
  }), response)
})
