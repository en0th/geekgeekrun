import { normalizeCompanyBrandId, companyJobsUrl, assertCompanyJobIdentity } from './company-source.mjs'
import { activateSourceAndWait } from './auto-chat-navigation.mjs'
import filterCatalog from './internal-config/job-filter-conditions-20241002.json' with { type: 'json' }
import industries from './internal-config/job-filter-industry-filter-exemption-20241002.json' with { type: 'json' }
import cities from './cityGroup.mjs'
export { isCompanyJobsDocument } from './company-source.mjs'

export const COMPANY_LIST_PATH = '/wapi/zpgeek/brand/job/querylist.json'
const codes = rows => new Set(rows.map(row => String(row.code)))
const allowed = { ...Object.fromEntries(['salaryList', 'experienceList', 'degreeList', 'scaleList'].map(key => [key, codes(filterCatalog[key])])),
  industryList: codes(industries.flatMap(group => group.subLevelModelList || [])),
  cityList: new Set(['100010000', ...cities.zpData.cityGroup.flatMap(group => group.cityList.map(row => String(row.code)))]) }
const values = input => [...new Set((Array.isArray(input) ? input : String(input ?? '').split(','))
  .map(String).map(s => s.trim()).filter(s => s && s !== '0'))].sort()
const one = input => {
  const v = values(input)
  if (v.length > 1) throw new Error('公司页的单次筛选只接受一个选项，请使用现有筛选组合逐项执行')
  return v[0] || ''
}
const city = value => value === '100010000' ? '' : value || ''
const failure = detail => Object.assign(new Error('AUTO_CHAT_COMPANY_SOURCE_NOT_CONFIRMED'), { detail })

export function companyFilterScope(source, filters = {}) {
  for (const [key, catalog] of Object.entries(allowed)) {
    if (values(filters[key]).some(code => !catalog.has(code))) throw failure('公司来源无法识别筛选编码：' + key + '，请重新选择')
  }
  return { brandId: normalizeCompanyBrandId(source.brandId), query: String(source.keyword || '').trim(),
    city: city(one(filters.cityList)), positionLv1: '', salary: one(filters.salaryList),
    experience: one(filters.experienceList), degree: one(filters.degreeList) }
}
export function companyFilteredUrl(source, filters = {}) {
  const scope = companyFilterScope(source, filters)
  if (scope.city && !/^\d{9}$/.test(scope.city)) throw failure('公司来源的城市编码无效')
  const url = new URL(companyJobsUrl(source.brandId))
  if (scope.city) url.pathname = url.pathname.replace('/job/', `/job/c${scope.city}/`)
  for (const key of ['query', 'salary', 'experience', 'degree']) if (scope[key]) url.searchParams.set(key, scope[key])
  return url.href
}
export function companyRequestMatches(request, source, expected) {
  try {
    const u = new URL(request.url()), p = Object.fromEntries(u.searchParams)
    if (!['www.zhipin.com', 'zhipin.com'].includes(u.hostname) || u.pathname !== COMPANY_LIST_PATH) return false
    const posted = request.postData?.()
    if (posted) { try { Object.assign(p, JSON.parse(posted)) } catch { Object.assign(p, Object.fromEntries(new URLSearchParams(posted))) } }
    return companyScopeMatches(p, expected || companyFilterScope(source), source)
  } catch { return false }
}
export function companyScopeMatches(p, scope, source) {
  try {
    return p.brandId === normalizeCompanyBrandId(source.brandId) &&
      String(p.query || '').trim() === scope.query &&
      ['city', 'positionLv1', 'salary', 'experience', 'degree'].every(key =>
        JSON.stringify(values(key === 'city' ? city(p[key]) : p[key])) === JSON.stringify(values(scope[key])))
  } catch { return false }
}
// Evaluated in the site: all identity/scope values come from its rendered Vue model.
export function inspectCompanyPage() {
  // Nuxt may own the component's root element after a full city/filter navigation.
  const root = document.querySelector('.page-company-position')?.__vue__
  const v = Array.isArray(root?.jobList) ? root : root?.$children?.find(child => Array.isArray(child.jobList))
  if (!v || !Array.isArray(v.jobList)) return null
  const d = v.jobDetail, currentId = v.currentJob?.encryptJobId
  const metadata = d?.jobInfo?.encryptId === currentId && d?.brandComInfo?.encryptBrandId === v.encryptBrandId
    ? { scale: d.brandComInfo.scale, industry: d.brandComInfo.industry } : null
  return { scope: { brandId: v.encryptBrandId, query: String(v.queryParams?.query || '').trim(),
    city: String(v.city || ''), positionLv1: v.position || '', salary: v.queryParams?.salary || '',
    experience: v.queryParams?.experience || '', degree: v.queryParams?.degree || '' },
    ids: v.jobList.map(row => row.encryptJobId || ''), brandIds: v.jobList.map(row => row.encryptBrandId || ''),
    page: v.currentPage, loading: !!v.jobLoading, loggedIn: v.$store?.getters?.isLogin === true, metadata,
    available: Object.fromEntries(['salary', 'experience', 'degree'].map(key => [key,
      (v.brandJobInfo?.[key + 'List'] || []).map(row => String(row.code))])),
    hasMore: typeof v.brandJobInfo?.hasMore === 'boolean' ? v.brandJobInfo.hasMore : v.currentPage * v.pageSize < v.totalCount }
}
async function waitForCompany(page, source) {
  try {
    const handle = await page.waitForFunction(brandId => {
      const root = document.querySelector('.page-company-position')?.__vue__
      const v = Array.isArray(root?.jobList) ? root : root?.$children?.find(child => Array.isArray(child.jobList))
      return v?.encryptBrandId === brandId && Array.isArray(v.jobList) && !v.jobLoading
    }, { timeout: 20000, polling: 100 }, normalizeCompanyBrandId(source.brandId))
    await handle.dispose()
  } catch { throw failure('公司页面或品牌未能就绪，请检查登录与安全验证后恢复') }
}
export async function activateCompanySource(page, source) {
  await page.goto(companyFilteredUrl(source), { waitUntil: 'domcontentloaded', timeout: 30000 })
  await waitForCompany(page, source)
}
export async function applyCompanyPageFilters(page, source, filters, { checkResponses = async () => {}, pause = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const expected = companyFilterScope(source, filters), url = companyFilteredUrl(source, filters)
  try { await activateSourceAndWait(page, async () => {
    if (page.url() !== url) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    }
    await waitForCompany(page, source)
    const state = await page.evaluate(inspectCompanyPage)
    for (const key of ['salary', 'experience', 'degree'])
      if (expected[key] && !state?.available[key]?.includes(expected[key]))
        throw failure('公司页面不支持当前' + ({ salary: '薪资', experience: '经验', degree: '学历' })[key] + '选项，未放宽筛选；请重新选择')
    // This is the page's normal search action; its request and rendered result are
    // independently checked before processing any row (SSR alone is insufficient).
    await page.evaluate(brandId => {
      const root = document.querySelector('.page-company-position')?.__vue__
      const v = Array.isArray(root?.jobList) ? root : root?.$children?.find(child => Array.isArray(child.jobList))
      if (v?.encryptBrandId !== brandId || typeof v.searchAction !== 'function') throw Error('AUTO_CHAT_COMPANY_SOURCE_NOT_CONFIRMED')
      v.searchAction()
    }, expected.brandId)
  }, { matchesResponse: r => companyRequestMatches(r.request(), source, expected) }) }
  catch (error) {
    await checkResponses()
    if (error?.name === 'TimeoutError') throw failure('公司列表请求未能确认，请检查页面和网络后恢复')
    throw error
  }
  for (let attempt = 0; attempt < 150; attempt++) {
    await checkResponses()
    const state = await page.evaluate(inspectCompanyPage)
    if (!state || state.scope.brandId !== expected.brandId || state.brandIds.some(id => id !== expected.brandId))
      throw failure('公司列表品牌无法确认，任务已暂停')
    if (!state.loggedIn) throw failure('公司页面尚未确认登录，任务已暂停；请登录后恢复')
    if (!companyScopeMatches(state.scope, expected, source)) throw failure('公司页面未应用本次筛选，任务已暂停')
    if (!state.loading) {
      if (!state.ids.length) return true
      const restricted = values(filters.industryList).length || values(filters.scaleList).length
      if (!restricted) return true
      if (state.metadata) {
        for (const [key, field] of [['industryList', 'industry'], ['scaleList', 'scale']]) {
          const selected = values(filters[key])
          if (selected.length && !String(state.metadata[field] || '').trim()) throw failure('公司行业或规模信息不足，未放宽筛选')
          if (selected.length && !selected.includes(String(state.metadata[field]))) return false
        }
        return true
      }
    }
    await pause(100)
  }
  throw failure('公司筛选或详情资料尚未就绪，任务已暂停并保留进度')
}
export function assertCompanyPlatformFilters(source, row, detail, filters) {
  assertCompanyJobIdentity(source.brandId, row, detail)
  const expected = companyFilterScope(source, filters)
  if (expected.city && String(row.city || '') !== expected.city)
    throw failure('公司岗位的城市与本次页面筛选不一致，任务已暂停')
  for (const [key, field] of [['industryList', 'industry'], ['scaleList', 'scale']]) {
    const selected = values(filters[key])
    if (selected.length && !selected.includes(String(detail.brandComInfo?.[field])))
      throw failure('公司行业或规模已与本次筛选不一致，任务已暂停')
  }
}
