import { RUN_PROFILES } from '@geekgeekrun/geek-auto-start-chat-with-boss/run-policy.mjs'
import { experienceSelectionLabels, normalizeRequiredJobConditions } from '@geekgeekrun/geek-auto-start-chat-with-boss/job-filter-config.mjs'

export function requiredConditionFacts(value) {
  let rules
  try { rules = normalizeRequiredJobConditions(value) }
  catch { return [['必需条件', '历史条件格式无法识别，请载入配置后核对']] }
  const rows = [
    ['求职类型', rules.jobNatures.join('、')],
    ['学历要求', rules.degrees.join('、')],
    ['所属行业', rules.industries.join('、')],
    ['融资阶段', rules.financingStages.join('、')],
    ['岗位屏蔽词', rules.excludedWords.join('、')],
  ].filter(([, value]) => value)
  const low = rules.companyScaleMin, high = rules.companyScaleMax
  if (low != null || high != null) rows.splice(1, 0, ['公司人数', low != null && high != null
    ? low === high ? `${low}人` : `${low}—${high}人`
    : low != null ? `${low}人及以上` : `${high}人及以下`])
  return rows.length ? rows : [['必需条件', '未设置额外条件']]
}

// Read the non-secret configuration frozen by the main process, including bookings
// submitted while no renderer is open. Old renderer-only snapshots remain readable.
export function actualRunFacts(config) {
  const boss = { ...config['boss.json'] }, common = config['common-job-condition-config.json'] || {}
  const groups = { jobDetail: ['expectJobRegExpStr', 'expectJobNameRegExpStr', 'expectJobTypeRegExpStr', 'expectJobDescRegExpStr', 'jobDetailRegExpMatchLogic'], city: ['expectCityList'], salary: ['expectSalaryCalculateWay', 'expectSalaryLow', 'expectSalaryHigh'], workExp: ['expectWorkExpList'], requiredConditions: ['requiredJobConditions'], blockCompanyNameRegExpStr: ['blockCompanyNameRegExpStr'], expectCompanies: ['expectCompanies'] }
  for (const [group, enabled] of Object.entries(boss.fieldsForUseCommonConfig || {})) if (enabled)
    for (const key of groups[group] || []) if (Object.hasOwn(common, key)) boss[key] = common[key]
  const show = v => Array.isArray(v) ? v.join('、') || '不限' : v == null || v === '' ? '不限' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  const p = boss.autoChatRunPolicy, rest = boss.autoChatTimedRest
  return [
    ['运行方式', boss.autoChatRunMode === 'collect' ? '只收集岗位' : '自动打招呼'],
    ['岗位名称匹配规则', show(boss.expectJobNameRegExpStr || boss.expectJobRegExpStr)],
    ['职位分类匹配规则', show(boss.expectJobTypeRegExpStr)],
    ['岗位描述匹配规则', show(boss.expectJobDescRegExpStr)],
    ['名称、分类与描述匹配', Number(boss.jobDetailRegExpMatchLogic || 1) === 1 ? '全部条件满足' : '任一条件满足'],
    ['工作城市', show(boss.expectCityList)],
    ['薪资范围', boss.expectSalaryLow == null && boss.expectSalaryHigh == null ? '不限' : `${boss.expectSalaryLow ?? '不限'}—${boss.expectSalaryHigh ?? '不限'}（${({ 1: '千元/月', 2: '万元/年', 3: '元/天', 4: '元/时' })[boss.expectSalaryCalculateWay || 1]}）`],
    ['工作经验', show(experienceSelectionLabels(boss.expectWorkExpList || []))],
    ...requiredConditionFacts(boss.requiredJobConditions),
    ['只看公司', show(boss.fieldsForUseCommonConfig?.expectCompanies ? common.expectCompanies : config['target-company-list.json'])],
    ['排除公司规则', show(boss.blockCompanyNameRegExpStr)],
    ['招聘者身份规则', boss.isPosterHrFilterEnabled ? show(boss.posterHrTitleRegExpStr) : '不限'],
    ['职位来源', (boss.jobSourceList || []).filter(s => s.enabled !== false).map(s => `${({ search: '搜索', expect: '求职期望', recommend: '推荐', company: '公司' })[s.type] || s.type}${s.children?.length ? '：' + s.children.map(c => c.keyword || c.brandId || '').filter(Boolean).join('、') : ''}`).join('；') || '未设置'],
    ['默认不匹配处理', ({ 1: '在BOSS标记不合适', 2: '仅在本机标记不合适', 3: '略过，下次仍可查看' })[boss.jobNotMatchStrategy ?? 1]],
    ['运行模式', RUN_PROFILES[p?.profile]?.label || '旧版运行设置'],
    ['定时休息', rest ? rest.enabled ? `每运行${rest.workMinutes}分钟，休息${rest.restMinutes}分钟` : '未启用' : '旧版设置'],
    ['开始时每日自动目标', p ? `${p.dailyLimit}人；实际开聊前按当前系统设置及今日追加量检查` : '未保存'],
    ['浏览器', '默认后台运行，需要登录或验证时显示窗口'],
  ]
}
