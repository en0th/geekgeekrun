import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { parseSalaryDetails, matchesSalaryDetails } from '../../utils/job-values.cjs'
import { missingJobFields, scopedMarkStrategy } from '../../geek-auto-start-chat-with-boss/job-safety.mjs'
import { requiredJobConditionReasons, matchesExperience, escapeKeyword } from '../../geek-auto-start-chat-with-boss/job-filter-config.mjs'
import { normalizeCitySelection, matchesCitySelection } from '../../geek-auto-start-chat-with-boss/city-filter.mjs'

const source = fs.readFileSync(new URL('../src/renderer/src/page/Ux/index.js', import.meta.url), 'utf8')
const body = source.slice(source.indexOf('    function evaluate(originalRow, d)'), source.indexOf('    const workerIds ='))
const ctx = vm.createContext({ missingJobFields, scopedMarkStrategy, parseSalaryDetails, matchesSalaryDetails,
  requiredJobConditionReasons, matchesExperience, normalizeCitySelection, matchesCitySelection, escape: escapeKeyword, cityOptions: [], activeLabels: [],
  strategyLabel: code => ({ 1: '在BOSS标记', 2: '本地冷却', 3: '略过' })[code] })
vm.runInContext(body, ctx)
const policy = { titles: [], categories: [], description: [], cities: [], companies: [], excluded: [], experience: [],
  salary: true, unit: 'day', low: 150, high: 300, strategy: 1, overrides: {}, scopes: {}, activity: '不限',
  requiredConditions: { jobNatures: ['实习'], companyScaleMin: 100 } }
const job = { encryptJobId: 'job', salaryDesc: '200元/天', salaryLow: null, salaryHigh: null,
  jobNatureName: '实习', companyScaleLow: 100, companyScaleHigh: 499 }
const evaluate = (row, draft = policy) => {
  ctx.row = row; ctx.draft = draft
  return JSON.parse(JSON.stringify(vm.runInContext('evaluate(row, draft)', ctx)))
}

test('the actual preview accepts a parsed daily salary even with empty monthly columns', () => {
  assert.equal(evaluate(job).result, '匹配')
})

test('hard conditions only skip, regardless of the general BOSS-marking policy', () => {
  const result = evaluate({ ...job, companyScaleLow: 0, companyScaleHigh: 20 })
  assert.equal(result.result, '不匹配')
  assert.deepEqual(result.actionLabels, ['跳过'])
  assert.match(result.action, /不发送、不标记/)
})

test('the preview keeps period mismatch and missing type evidence blocked', () => {
  assert.equal(evaluate(job, { ...policy, unit: 'month', low: 5000 }).result, '不匹配')
  assert.equal(evaluate({ ...job, jobNatureName: null }).result, '信息不足')
})

test('nationwide preview accepts any city and does not require a literal 全国 city field', () => {
  assert.equal(evaluate({ ...job, cityName: '上海' }, { ...policy, cities: ['全国'] }).result, '匹配')
  assert.equal(evaluate(job, { ...policy, cities: ['全国', '深圳'] }).result, '匹配')
  assert.equal(evaluate({ ...job, cityName: '上海' }, { ...policy, cities: ['深圳'] }).result, '不匹配')
})

test('collect preview describes collection and never proposes messages or marking', () => {
  const accepted = evaluate(job, { ...policy, runMode: 'collect', collectOnlyMatchingJobs: true })
  assert.deepEqual(accepted.actionLabels, ['可收集'])
  assert.match(accepted.action, /仅保存岗位，不发送、不标记/)
  const rejected = evaluate(job, { ...policy, runMode: 'collect', collectOnlyMatchingJobs: true, low: 500 })
  assert.equal(rejected.result, '不匹配')
  assert.deepEqual(rejected.actionLabels, ['跳过'])
  assert.match(rejected.action, /不发送、不标记/)
})

test('collect-all preview ignores hard conditions and salary just like live execution', () => {
  const result = evaluate({ salaryDesc: '面议' }, { ...policy, runMode: 'collect', collectOnlyMatchingJobs: false })
  assert.equal(result.result, '匹配')
  assert.deepEqual(result.actionLabels, ['可收集'])
})

test('a saved real internship and an hourly variant use the same hard-condition and salary contract', () => {
  const intern = { ...job, salaryDesc: '200-250元/天', jobNatureName: '实习', degreeName: '本科',
    companyScaleLow: 500, companyScaleHigh: 999, companyIndustryName: '其他专业服务' }
  const draft = { ...policy, runMode: 'collect', requiredConditions: { jobNatures: ['实习'], degrees: ['本科'],
    companyScaleMin: 100, companyScaleMax: 1000, industries: ['专业服务'] } }
  assert.equal(evaluate(intern, draft).result, '匹配')
  assert.equal(evaluate(intern, { ...draft, requiredConditions: { ...draft.requiredConditions, degrees: ['博士'] } }).result, '不匹配')
  assert.equal(evaluate({ ...intern, salaryDesc: '25-30元/时', jobNatureName: '兼职' }, {
    ...draft, unit: 'hour', low: 25, high: 30, requiredConditions: { jobNatures: ['兼职'] }
  }).result, '匹配')
})

test('preview uses the real title and saved description for literal exclusions before ANY conditions', () => {
  const draft = { ...policy, runMode: 'collect', regexLogic: 2, titles: ['工程师'],
    requiredConditions: { excludedWords: ['外包', 'C++'] } }
  const row = { ...job, jobName: '实习工程师', description: '参与内部系统研发' }
  assert.equal(evaluate(row, draft).result, '匹配')
  for (const change of [{ jobName: '外包工程师' }, { description: '熟悉 C++' }]) {
    const result = evaluate({ ...row, ...change }, draft)
    assert.equal(result.result, '不匹配')
    assert.match(result.reason, /屏蔽词/)
    assert.deepEqual(result.actionLabels, ['跳过'])
  }
  assert.equal(evaluate({ ...row, description: null }, draft).result, '信息不足')
  assert.equal(evaluate(row, { ...draft, collectOnlyMatchingJobs: false }).result, '匹配')
})
