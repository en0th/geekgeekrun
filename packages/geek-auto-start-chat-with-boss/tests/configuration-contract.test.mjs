import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { experienceSelectionLabels, experienceSelectionCodes, normalizeExperienceSelections, matchesExperience,
  escapeKeyword, keywordPattern, allKeywordPattern, createJobDetailMatcher, validateJobFilterConfig, mergeJobFilterConfig, companySelections, matchesSalary } from '../job-filter-config.mjs'
import { listSkipReason, assertCanGreet } from '../auto-chat-navigation.mjs'
import { waitSeconds, filterCombinationLimit, normalizeRunBudget } from '../run-settings.mjs'
import { normalizeCitySelection } from '../city-filter.mjs'

// Exercise the actual renderer serializer, not a copy of it. Native saving persists this patch.
const renderer = fs.readFileSync(new URL('../../ui/src/renderer/src/page/Ux/index.js', import.meta.url), 'utf8')
const serializer = renderer.slice(renderer.indexOf('    function runConfig(d)'), renderer.indexOf('    function configForDraft(d)'))
const context = vm.createContext({ globalPace: { value: null }, isCollectAll: d => d.runMode === 'collect' && !d.collectOnlyMatchingJobs,
  clone: value => JSON.parse(JSON.stringify(value)),
  original: { fieldsForUseCommonConfig: {} }, common: {}, waitSeconds, filterCombinationLimit, normalizeRunBudget, normalizeCitySelection, DEFAULT_JOB_LIST_LOAD_WAIT_SECONDS: 5,
  DEFAULT_JOB_DETAIL_VIEW_WAIT_SECONDS: 2, experienceSelectionCodes, escape: escapeKeyword, regex: keywordPattern,
  allKeywordPattern, activeLabels: ['', '半年前活跃', '近半年活跃', '5月内活跃', '4月内活跃', '3月内活跃', '2月内活跃', '本月活跃', '2周内活跃', '本周活跃', '3日内活跃', '昨日活跃', '今日活跃', '刚刚活跃'] })
vm.runInContext(serializer, context)
const draft = extra => ({ titles: ['产品'], categories: [], description: [], cities: ['深圳'], companies: [], excluded: [],
  experience: ['应届生', '1年以内', '1-3年', '经验不限'], low: 5000, high: 10000, unit: 'month', runMode: 'chat',
  regexMode: false, regexLogic: 1, hr: false, activity: '不限', overrides: {}, scopes: {}, strategy: 3, ...extra })
const save = d => JSON.parse(JSON.stringify(context.basicToConfig(d)))

test('execution budgets survive the actual form serializer, including unlimited values', () => {
  const config = save(draft({ runInBackground: false, runBudget: { requests: 22, detailRequests: 0, activeMinutes: 30 } }))
  assert.equal(config.autoChatRunInBackground, false)
  assert.deepEqual(config.autoChatRunBudget, { requests: 22, detailRequests: 0, activeMinutes: 30 })
  assert.doesNotThrow(() => validateJobFilterConfig(config))
  assert.throws(() => save(draft({ runBudget: { requests: -1 } })), /预算/)
})

test('the real form serializer retains literal exclusion words separately from positive ANY rules', () => {
  const config = save(draft({ runMode: 'collect', collectOnlyMatchingJobs: true, regexLogic: 2,
    requiredConditions: { excludedWords: ['外包', 'C++', 'ＡＩ'] } }))
  assert.deepEqual(config.requiredJobConditions.excludedWords, ['外包', 'C++', 'ＡＩ'])
  assert.equal(config.jobDetailRegExpMatchLogic, 2)
  assert.equal(config.autoChatRunMode, 'collect')
  assert.doesNotThrow(() => validateJobFilterConfig(config))
})

test('actual UI serializer + list prefilter reproduces and fixes the user experience bug', () => {
  const config = save(draft())
  assert.deepEqual(config.expectWorkExpList, [102, 103, 104, 101])
  for (const experience of ['1年以内', '1-3年', '经验不限']) {
    assert.equal(listSkipReason({ cityName: '深圳', jobExperience: experience }, {
      cities: config.expectCityList, cityStrategy: config.expectCityNotMatchStrategy,
      experiences: config.expectWorkExpList, experienceStrategy: config.expectWorkExpNotMatchStrategy,
      salaryEnabled: true, salaryStrategy: config.expectSalaryNotMatchStrategy, salaryMatches: true }), '')
  }
  assert.equal(matchesExperience(config.expectWorkExpList, '3-5年'), false)
})
test('old text, numeric-string and mixed experience configs retain selections', () => {
  assert.deepEqual(experienceSelectionLabels(['104', '1–3年', 101]), ['1-3年', '经验不限'])
  assert.deepEqual(experienceSelectionCodes(['1-3年', '经验不限']), [104, 101])
  assert.equal(matchesExperience([104], '1 – 3 年'), true)
})
test('student/new-graduate aliases preserve the existing combined BOSS category', () => {
  for (const exp of ['应届生', '在校生', '在校/应届']) assert.equal(matchesExperience([102], exp), true)
  assert.deepEqual(normalizeExperienceSelections([102, 108]), ['在校/应届'])
  assert.deepEqual(experienceSelectionCodes(['在校/应届']), [108, 102])
})
test('经验不限 is one requirement category; clearing experience disables the filter', () => {
  assert.equal(matchesExperience([101], '5-10年'), false)
  assert.equal(matchesExperience([], '5-10年'), true)
  assert.equal(matchesExperience([0], '5-10年'), true)
  assert.equal(matchesExperience([104], undefined), false)
  assert.throws(() => experienceSelectionLabels([999]), /无法识别/)
})
test('产品 is substring matching in the actual UI-to-execution chain', () => {
  const matches = createJobDetailMatcher(save(draft()))
  for (const title of ['产品经理', '产品助理', '高级产品专员', '海外产品经理']) assert.equal(matches({ jobName: title }), true)
  for (const title of ['销售', '工程师', '', undefined]) assert.equal(matches({ jobName: title }), false)
})
test('multiple titles match any keyword; literal punctuation cannot become regex', () => {
  const matches = createJobDetailMatcher(save(draft({ titles: ['C++', '产品'] })))
  assert.equal(matches({ jobName: 'C++工程师' }), true)
  assert.equal(matches({ jobName: '产品助理' }), true)
  assert.equal(matches({ jobName: 'CC工程师' }), false)
  assert.equal(new RegExp(keywordPattern(['A.B'])).test('A0B'), false)
})
test('name/category/description ALL and ANY use only supplied conditions', () => {
  const allConfig = save(draft({ categories: ['软件'], description: ['需求', '数据'] }))
  const all = createJobDetailMatcher(allConfig)
  assert.equal(all({ jobName: '产品', positionName: '软件开发', postDescription: '分析数据，梳理需求' }), true)
  assert.equal(all({ jobName: '产品', positionName: '软件开发', postDescription: '只有需求' }), false)
  const any = createJobDetailMatcher({ ...allConfig, jobDetailRegExpMatchLogic: 2 })
  assert.equal(any({ jobName: '工程师', positionName: '软件开发' }), true)
  assert.equal(any({ jobName: '销售', positionName: '销售', postDescription: '销售' }), false)
  assert.equal(createJobDetailMatcher({ jobDetailRegExpMatchLogic: 2 })({}), true)
})
test('invalid expressions fail explicitly rather than silently authorize sending', () => {
  assert.throws(() => createJobDetailMatcher({ expectJobNameRegExpStr: '[' }), /岗位名称匹配规则无效/)
  assert.throws(() => validateJobFilterConfig({ blockCompanyNameRegExpStr: '[' }), /排除公司/)
  assert.throws(() => validateJobFilterConfig({ posterHrTitleRegExpStr: '[' }), /招聘者身份/)
})
test('company include and exclude keywords preserve literal OR matching', () => {
  const config = save(draft({ companies: ['公司A', '公司B'], excluded: ['外包', 'A.B'] }))
  assert.deepEqual(config.expectCompanies, ['公司A', '公司B'])
  const excluded = new RegExp(config.blockCompanyNameRegExpStr, 'im')
  assert.equal(excluded.test('上海外包公司'), true)
  assert.equal(excluded.test('A.B科技'), true)
  assert.equal(excluded.test('AxB科技'), false)
})
test('clearing new keyword fields retires the legacy rule, not resurrects it', () => {
  const config = mergeJobFilterConfig({ expectJobRegExpStr: '产品经理' }, save(draft({ titles: [], categories: [], description: [] })))
  assert.equal(Object.hasOwn(config, 'expectJobRegExpStr'), false)
  assert.equal(createJobDetailMatcher(config)({ jobName: '销售' }), true)
})
test('company array survives the UI-to-save boundary without splitting embedded commas', () => {
  const config = save(draft({ companies: ['ACME,Inc'] }))
  assert.deepEqual(companySelections(config.expectCompanies), ['ACME,Inc'])
  assert.equal(companySelections(config.expectCompanies).some(word => 'OtherInc'.includes(word)), false)
  assert.deepEqual(companySelections('公司A,公司B'), ['公司A', '公司B'])
})
test('city and per-condition treatment options remain independent', () => {
  const config = save(draft({ overrides: { city: 3, salary: 2, experience: 1 }, scopes: { experience: 1 } }))
  assert.equal(config.expectSalaryNotMatchStrategy, 2)
  assert.equal(config.expectWorkExpNotMatchStrategy, 1)
  assert.equal(config.strategyScopeOptionWhenMarkJobWorkExpNotMatch, 1)
  assert.equal(listSkipReason({ cityName: '广州', jobExperience: '1-3年' }, { cities: config.expectCityList, cityStrategy: 3, experiences: config.expectWorkExpList, experienceStrategy: 1 }), '城市不符合')
})
test('nationwide is serialized as an unrestricted local city condition', () => {
  assert.deepEqual(save(draft({ cities: ['全国', '深圳'] })).expectCityList, [])
})
test('monthly salary converts yuan to K and matches overlap including endpoints', () => {
  const config = save(draft())
  const expected = { low: config.expectSalaryLow, high: config.expectSalaryHigh, unit: config.expectSalaryCalculateWay }
  assert.deepEqual(expected, { low: 5, high: 10, unit: 1 })
  for (const actual of [{ low: 6, high: 7 }, { low: 9, high: 14 }, { low: 10, high: 15 }]) assert.equal(matchesSalary(actual, expected), true)
  assert.equal(matchesSalary({ low: 15, high: 25 }, expected), false)
})
test('annual salary stays in 万/year and respects 薪数/default 12; open bounds', () => {
  const config = save(draft({ unit: 'year', low: 10, high: 15 }))
  const expected = { low: config.expectSalaryLow, high: config.expectSalaryHigh, unit: config.expectSalaryCalculateWay }
  assert.equal(matchesSalary({ low: 8, high: 10, month: 14 }, expected), true)
  assert.equal(matchesSalary({ low: 8, high: 10 }, expected), true)
  assert.equal(matchesSalary({ low: 3, high: 4 }, expected), false)
  assert.equal(matchesSalary({ low: 20, high: 30 }, { low: 10 }), true)
  assert.equal(matchesSalary({ low: 3, high: 4 }, { high: 5 }), true)
  assert.equal(matchesSalary({ low: null, high: null }, { low: 5 }), false)
  assert.equal(matchesSalary({ low: null, high: null }), true)
})
test('the actual UI serializer keeps daily/hourly amounts and hard conditions in the execution contract', () => {
  for (const [unit, code] of [['day', 3], ['hour', 4]]) {
    const requiredConditions = { companyScaleMin: 100, jobNatures: ['实习'] }
    const config = save(draft({ unit, low: 150, high: 300, requiredConditions }))
    assert.equal(config.expectSalaryCalculateWay, code)
    assert.equal(config.expectSalaryLow, 150)
    assert.deepEqual(config.requiredJobConditions, requiredConditions)
  }
})
test('HR/activity, collect mode, rotation and global pace are serialized correctly', () => {
  const config = save(draft({ hr: true, hrRule: 'HR|人事', activity: '今日活跃', perSourceSuccessLimit: 0, noMatchStreakLimit: 7, filterCombinationLimit: 23, jobListLoadWaitSeconds: 8, jobDetailViewWaitSeconds: 3 }))
  assert.equal(config.isPosterHrFilterEnabled, true)
  assert.equal(config.posterHrTitleRegExpStr, 'HR|人事')
  assert.equal(config.markAsNotActiveSelectedTimeRange, 11)
  assert.equal(config.autoChatPerSourceSuccessLimit, 0)
  assert.equal(config.autoChatNoMatchStreakLimit, 7)
  assert.equal(config.autoChatFilterCombinationLimit, 23)
  assert.equal(config.jobListLoadWaitSeconds, 8)
  assert.equal(config.jobDetailViewWaitSeconds, 3)
  const collect = save(draft({ runMode: 'collect', collectOnlyMatchingJobs: false }))
  assert.equal(collect.autoChatRunMode, 'collect')
  assert.equal(Object.hasOwn(collect, 'expectJobNameRegExpStr'), false)
  assert.throws(() => assertCanGreet({ isCollectMode: true }), /COLLECT_MODE_CHAT_BLOCKED/)
})
