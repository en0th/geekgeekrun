// Navigation guards do not relax job/company filters or authorize message sending.
import { matchesExperience, requiredJobConditionReasons } from './job-filter-config.mjs'
import { matchesCitySelection } from './city-filter.mjs'
import { clickTaskElement } from './task-page-input.mjs'
export const MAX_BATCHES_WITHOUT_CHAT = 5
export async function activateSourceAndWait(page, activate, { matchesResponse, timeout = 30000 } = {}) {
  const controller = new AbortController()
  try {
    const [response] = await Promise.all([
      page.waitForResponse(matchesResponse || (response =>
        response.url().startsWith('https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json') ||
        response.url().startsWith('https://www.zhipin.com/wapi/zpgeek/search/joblist.json')),
      { timeout, signal: controller.signal }),
      Promise.resolve().then(activate)
    ])
    return response
  } finally {
    controller.abort()
  }
}
export class NoMatchBatchGuard {
  constructor(max = MAX_BATCHES_WITHOUT_CHAT) { this.max = max; this.loaded = 0 }
  beforeLoad() {
    if (this.loaded >= this.max) throw new Error('AUTO_CHAT_NO_MATCH_BATCH_LIMIT')
  }
  loadedBatch() { this.loaded++ }
  // something usable turned up (collect mode keeps going while it finds jobs to save)
  reset() { this.loaded = 0 }
}
export async function readListSnapshot(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.page-company-position')?.__vue__
    const company = Array.isArray(root?.jobList) ? root : root?.$children?.find(child => Array.isArray(child.jobList))
    if (company && Array.isArray(company.jobList)) return { ids: company.jobList.map(row => row.encryptJobId),
      hasMore: typeof company.brandJobInfo?.hasMore === 'boolean' ? company.brandJobInfo.hasMore : company.currentPage * company.pageSize < company.totalCount,
      mode: 'paged', page: company.currentPage, brandId: company.encryptBrandId, loading: !!company.jobLoading, loggedIn: company.$store?.getters?.isLogin === true }
    const view = document.querySelector('.page-jobs-main')?.__vue__
    if (!Array.isArray(view?.jobList) || typeof view.hasMore !== 'boolean') return null
    return { ids: view.jobList.map(row => row.encryptJobId), hasMore: view.hasMore }
  })
}
export async function loadNextJobBatch({ page, list, timeoutMs = 15000, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, checkResponses = async () => {} }) {
  await checkResponses()
  const before = await readListSnapshot(page)
  if (!before) throw new Error('AUTO_CHAT_LIST_STALLED')
  if (before.mode === 'paged' && !before.loggedIn) throw new Error('AUTO_CHAT_COMPANY_SOURCE_NOT_CONFIRMED')
  if (!before.hasMore) return { hasMore: false }
  const known = new Set(before.ids)
  if (before.mode === 'paged') {
    await page.evaluate(({ brandId, nextPage }) => {
      const root = document.querySelector('.page-company-position')?.__vue__
      const v = Array.isArray(root?.jobList) ? root : root?.$children?.find(child => Array.isArray(child.jobList))
      if (v?.encryptBrandId !== brandId || typeof v.onCurrentPageChange !== 'function') throw Error('AUTO_CHAT_COMPANY_SOURCE_NOT_CONFIRMED')
      v.onCurrentPageChange(nextPage)
    }, { brandId: before.brandId, nextPage: before.page + 1 })
    const deadline = now() + timeoutMs
    while (now() < deadline) {
      await pause(100)
      await checkResponses()
      const next = await readListSnapshot(page)
      if (!next || !next.loggedIn || next.brandId !== before.brandId) throw new Error('AUTO_CHAT_COMPANY_SOURCE_NOT_CONFIRMED')
      if (!next.loading && next.page === before.page + 1 && (next.ids.some(id => id && !known.has(id)) || !next.hasMore)) return next
    }
    throw new Error('AUTO_CHAT_LIST_STALLED')
  }
  const box = await list.boundingBox()
  if (!box) throw new Error('AUTO_CHAT_LIST_STALLED')
  const height = await page.evaluate('window.innerHeight')
  await page.mouse.move(box.x + box.width / 2, height / 2)
  const deadline = now() + timeoutMs
  // randomised per batch like the original scroller, so the scrolling isn't uniform
  const increase = 40 + Math.floor(30 * Math.random())
  while (now() < deadline) {
    await checkResponses()
    await page.mouse.wheel({ deltaY: increase })
    await pause(100)
    await checkResponses()
    const next = await readListSnapshot(page)
    if (!next) throw new Error('AUTO_CHAT_LIST_STALLED')
    if (next.ids.some(id => id && !known.has(id)) || !next.hasMore) return next
  }
  throw new Error('AUTO_CHAT_LIST_STALLED')
}
export async function openJobCardForReview({ page, list, index, jobId, timeoutMs = 12000, checkResponses = async () => {} }) {
  await checkResponses()
  if (!jobId || !Number.isSafeInteger(index) || index < 0) throw new Error('AUTO_CHAT_DETAIL_NOT_READY')
  // Query one card instead of creating an unreleased handle for every row on every review.
  const handle = await list.evaluateHandle((element, offset) => element.querySelectorAll('li.job-card-box')[offset] || null, index)
  try {
    const card = handle.asElement()
    if (!card) throw new Error('AUTO_CHAT_DETAIL_NOT_READY')
    // Click even index zero; BOSS may still be showing a previous source's detail.
    await clickTaskElement(page, card)
  } finally {
    await handle.dispose()
  }
  try {
    const ready = await page.waitForFunction(expectedId => {
      const root = document.querySelector('.page-company-position')?.__vue__
      const company = Array.isArray(root?.jobList) ? root : root?.$children?.find(child => Array.isArray(child.jobList))
      const selected = (document.querySelector('.page-jobs-main')?.__vue__ || company)?.currentJob
      const detail = document.querySelector('.job-detail-box')?.__vue__?.data
      return String(selected?.encryptJobId || selected?.encryptId || '') === String(expectedId) &&
        String(detail?.jobInfo?.encryptId || '') === String(expectedId)
    }, { timeout: timeoutMs, polling: 100 }, jobId)
    await ready.dispose()
  } catch {
    await checkResponses()
    throw new Error('AUTO_CHAT_DETAIL_NOT_READY')
  }
  await checkResponses()
}
// Apply each NO_OP prefilter only to its own enabled criterion.
export function listSkipReason(row, { cities = [], cityStrategy, experiences = [], experienceStrategy, salaryEnabled, salaryStrategy, salaryMatches = true, invalidSalary = false }) {
  if (cityStrategy === 3 && !matchesCitySelection(cities, row.cityName)) return '城市不符合'
  if (experiences.length && experienceStrategy === 3 && !matchesExperience(experiences, row.jobExperience)) return '经验不符合'
  if (salaryEnabled && (invalidSalary || (salaryStrategy === 3 && !salaryMatches))) return '薪资不符合或信息不足'
  return ''
}
export function describeListScope(rows, { allow = [], blocked = () => false, skipReasons = new Map() }) {
  const counts = {}
  for (const row of rows) {
    const reason = skipReasons.get(row.encryptJobId) ||
      (blocked(row) ? '本次已处理或处于冷却' : allow.length && !allow.some(word => (row.brandName || '').toLowerCase().includes(word.toLowerCase())) ? '公司不在只看名单' : '')
    if (reason) counts[reason] = (counts[reason] || 0) + 1
  }
  const text = Object.entries(counts).map(([reason, count]) => reason + ' ' + count + ' 条').join('；')
  return '当前列表 ' + rows.length + ' 条' + (text ? '；' + text : '，等待逐条检查')
}


/**
 * The last check before the chat button is clicked: never in collect mode, and only for the
 * job that passed every condition (not whatever job was looked at last).
 */
export function assertCanGreet({ isCollectMode, targetJobIndex, matchedJobId, targetJobId, detail, requiredConditions = {} }) {
  if (isCollectMode) throw new Error('AUTO_CHAT_COLLECT_MODE_CHAT_BLOCKED')
  if (targetJobIndex < 0 || !matchedJobId || matchedJobId !== targetJobId)
    throw new Error('AUTO_CHAT_UNMATCHED_JOB_CHAT_BLOCKED')
  if (requiredJobConditionReasons(detail, requiredConditions).length)
    throw new Error('AUTO_CHAT_REQUIRED_CONDITION_CHAT_BLOCKED')
}
