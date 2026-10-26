import test from 'node:test'
import assert from 'node:assert/strict'
import { actualRunFacts, requiredConditionFacts } from '../src/common/run-config-facts.mjs'
import { runProfileHelp } from '../src/common/run-profile-help.mjs'
import { policyRunConfig, RUN_PROFILES } from '../../geek-auto-start-chat-with-boss/run-policy.mjs'
import { taskRecoveryGuidance } from '../src/common/task-recovery-guidance.mjs'

test('empty and legacy absent hard conditions never expose JSON', () => {
  for (const value of [undefined, {}, { jobNatures: [], degrees: [], industries: [], financingStages: [], excludedWords: [], companyScaleMin: null, companyScaleMax: null }]) {
    const rows = actualRunFacts({ 'boss.json': { requiredJobConditions: value } })
    assert.equal(Object.fromEntries(rows)['必需条件'], '未设置额外条件')
    assert(!rows.some(([, value]) => value.includes('{') || value.includes('companyScaleMin')))
  }
})

test('all active hard conditions display their saved Chinese meanings without mutating the snapshot', () => {
  const rules = { jobNatures: ['全职'], degrees: ['本科', '硕士'], industries: ['互联网'], financingStages: ['A轮'], excludedWords: ['外包'], companyScaleMin: 100, companyScaleMax: 500 }
  const snapshot = { 'boss.json': { requiredJobConditions: rules }, 'common-job-condition-config.json': { requiredJobConditions: { degrees: ['博士'] } } }
  const before = structuredClone(snapshot), rows = Object.fromEntries(actualRunFacts(snapshot))
  for (const [label, value] of [['求职类型', '全职'], ['学历要求', '本科、硕士'], ['公司人数', '100—500人'], ['所属行业', '互联网'], ['融资阶段', 'A轮'], ['岗位屏蔽词', '外包']]) assert.equal(rows[label], value)
  assert.deepEqual(snapshot, before)
  snapshot['boss.json'].fieldsForUseCommonConfig = { requiredConditions: true }
  assert.equal(Object.fromEntries(actualRunFacts(snapshot))['学历要求'], '博士')
})

test('one-sided company limits and corrupt historical conditions remain understandable', () => {
  for (const [value, text] of [[{ companyScaleMin: 0 }, '0人及以上'], [{ companyScaleMax: 50 }, '50人及以下'], [{ companyScaleMin: 10, companyScaleMax: 10 }, '10人']])
    assert.equal(Object.fromEntries(requiredConditionFacts(value))['公司人数'], text)
  for (const value of [null, [], 'broken', { degrees: [101] }]) assert.match(requiredConditionFacts(value)[0][1], /格式无法识别.*核对/)
})

test('each mode help matches the live execution parameters and separates requests from greetings', () => {
  for (const key of Object.keys(RUN_PROFILES)) {
    const config = policyRunConfig({ profile: key }), help = runProfileHelp(key)
    assert(help.includes(`等待：${config.jobListLoadWaitSeconds}秒`))
    assert(help.includes(`${config.jobDetailViewWaitSeconds}—${config.jobDetailViewWaitSeconds + 1}秒`))
    assert(help.includes(`读取${config.autoChatRunBudget.requests}次`))
    assert(help.includes(`详情最多${config.autoChatRunBudget.detailRequests}次`))
    assert(help.includes(`${config.autoChatRunBudget.activeMinutes}分钟`))
    assert.match(help, /失败和重试也计入/); assert.match(help, /读取次数不是成功打招呼人数/)
    assert.match(help, /每日目标.*自动重试.*来源查完.*平台限制或须核对的异常/)
  }
  assert.match(runProfileHelp('deep'), /速度相同/)
  assert.match(runProfileHelp('fast'), /验证码、限流或账号限制/)
  assert.throws(() => runProfileHelp('unknown'))
})

test('a pending job send points to software reconciliation while a follow-up send still points to BOSS', () => {
  const checkpoint = { runRecordId: 1, runMode: 'chat', messageSendPending: true }
  const guide = taskRecoveryGuidance({ checkpoint })
  assert.equal(guide.primaryAction, 'acknowledge-daily'); assert.equal(guide.canContinue, false)
  assert.match(guide.nextStep, /只在BOSS查看不会解除/)
  assert.equal(taskRecoveryGuidance({ checkpoint, task: 'follow' }).primaryAction, 'boss-chat')
})
