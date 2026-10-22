import catalog from './data/position-codes.json' with { type: 'json' }

const positions = new Map()
export const positionOptions = Object.entries(catalog).filter(([name]) => name !== '_meta').map(([groupLabel, group]) => ({
  label: groupLabel, value: group.code,
  children: Object.entries(group).filter(([name]) => name !== 'code').map(([subgroupLabel, subgroup]) => ({
    label: subgroupLabel, value: subgroup.code,
    children: Object.entries(subgroup).filter(([name]) => name !== 'code').map(([label, value]) => {
      positions.set(value, `${groupLabel} / ${subgroupLabel} / ${label}`)
      return { label, value }
    })
  }))
}))
export const positionCatalogMetadata = Object.freeze({ ...catalog._meta })

export function normalizePositionCodes(value) {
  if (value == null || value === '') return []
  const values = Array.isArray(value) ? value : [value]
  const codes = [...new Set(values.map(value => String(value).trim()).filter(Boolean))].sort()
  const unknown = codes.filter(code => !positions.has(code))
  if (unknown.length) throw new Error('无法识别平台职位类目：' + unknown.join('、') + '，请重新选择')
  return codes
}
export function positionLabels(value) {
  return normalizePositionCodes(value).map(code => positions.get(code))
}
export function searchSourceIdentity(source) {
  return [String(source.keyword || '').trim(), normalizePositionCodes(source.positionCodes)]
}
export function hasSearchCriteria(row) {
  return Boolean(String(row?.keyword || '').trim() || (Array.isArray(row?.positionCodes)
    ? row.positionCodes.some(code => String(code ?? '').trim()) : String(row?.positionCodes ?? '').trim()))
}
export function describeSearchSource(source) {
  const keyword = String(source.keyword || '').trim()
  let label = ''
  try { label = positionLabels(source.positionCodes).join('、') }
  catch { label = '平台职位类目需要重新选择' }
  return [keyword ? '“' + keyword + '”' : '', label].filter(Boolean).join(' · ')
}

export function normalizeJobSources(sources = []) {
  const result = [], seen = new Set()
  for (const source of sources ?? []) {
    if (!source?.enabled) continue
    if (source.type === 'search') {
      for (const row of source.children ?? []) {
        if (!row?.enabled || !hasSearchCriteria(row)) continue
        const [keyword, positionCodes] = searchSourceIdentity(row)
        const key = JSON.stringify(['search', keyword, positionCodes])
        if (seen.has(key)) continue
        result.push({ type: 'search', keyword, positionCodes })
        seen.add(key)
      }
    } else if (!seen.has(source.type)) {
      result.push({ type: source.type })
      seen.add(source.type)
    }
  }
  return result
}
export function sourceFingerprintEntry(source) {
  const entry = [source.type, source.selector ?? null, source.keyword ?? null]
  const codes = normalizePositionCodes(source.positionCodes)
  // Preserve the existing resume fingerprint when the new optional field is unused.
  return codes.length ? [...entry, codes] : entry
}

function requestParameters(request) {
  const url = new URL(request.url())
  const values = Object.fromEntries(url.searchParams)
  const body = request.postData?.()
  if (body) {
    try { Object.assign(values, JSON.parse(body)) }
    catch { Object.assign(values, Object.fromEntries(new URLSearchParams(body))) }
  }
  return { url, values }
}
function receivedCodes(value) {
  if (value == null || value === '' || value === 0 || value === '0') return []
  return [...new Set((Array.isArray(value) ? value : String(value).split(',')).map(String).map(v => v.trim()).filter(Boolean))].sort()
}
export function searchRequestMatches(request, source) {
  try {
    const { url, values } = requestParameters(request)
    if (!/(^|\.)zhipin\.com$/.test(url.hostname) || url.pathname !== '/wapi/zpgeek/search/joblist.json') return false
    const [keyword, positionCodes] = searchSourceIdentity(source)
    return String(values.query ?? '').trim() === keyword &&
      JSON.stringify(receivedCodes(values.position)) === JSON.stringify(positionCodes)
  } catch { return false }
}
export function searchPageMatches(scope, source) {
  const [keyword, codes] = searchSourceIdentity(source)
  return String(scope.query ?? '').trim() === keyword &&
    JSON.stringify(receivedCodes(scope.position)) === JSON.stringify(codes)
}
export async function readSearchScope(page) {
  return page.evaluate(() => {
    const form = document.querySelector('.page-jobs-main')?.__vue__?.formData
    if (!form) return null
    const url = new URL(location.href)
    return { query: form.query ?? url.searchParams.get('query') ?? '',
      position: form.position ?? url.searchParams.get('position') ?? '',
      city: form.city ?? url.searchParams.get('city') ?? '' }
  })
}
export function buildPositionSearchUrl(source, currentUrl, scope = {}) {
  const [keyword, codes] = searchSourceIdentity(source)
  const previous = new URL(currentUrl)
  const url = new URL('https://www.zhipin.com/web/geek/job')
  for (const key of ['city', 'scale', 'stage', 'salary', 'experience', 'degree', 'industry', 'jobType']) {
    const value = previous.searchParams.get(key)
    if (value) url.searchParams.set(key, value)
  }
  if (!url.searchParams.has('city') && /^\d{9}$/.test(String(scope.city))) url.searchParams.set('city', String(scope.city))
  url.searchParams.set('query', keyword)
  if (codes.length) url.searchParams.set('position', codes.join(','))
  return url.href
}

/** Navigate only when entering/leaving a position filter; ordinary keyword search keeps its UI path. */
export async function activateSearchSource(page, source, searchBoxSelector) {
  const scope = await readSearchScope(page)
  if (normalizePositionCodes(source.positionCodes).length || receivedCodes(scope?.position).length) {
    await page.goto(buildPositionSearchUrl(source, page.url(), scope || {}), { waitUntil: 'domcontentloaded', timeout: 30000 })
    return
  }
  const box = await page.waitForSelector(searchBoxSelector)
  await box?.dispose()
  const input = await page.$(`${searchBoxSelector} input`)
  if (!input) throw Object.assign(new Error('AUTO_CHAT_SEARCH_FILTER_NOT_APPLIED'), {
    detail: '未找到BOSS搜索输入框，任务已暂停；请检查页面后恢复',
  })
  try {
    await input.focus()
    await input.evaluate(element => element.select())
    // Keyboard replacement also notifies the site's reactive input component.
    await input.press('Backspace')
    await input.type(String(source.keyword || '').trim(), { delay: 100 })
    await input.press('Enter')
  } finally { await input.dispose() }
}
