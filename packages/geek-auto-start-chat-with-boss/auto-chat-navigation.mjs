// Navigation guards do not relax job/company filters or authorize message sending.
export const MAX_BATCHES_WITHOUT_CHAT = 5
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
    const view = document.querySelector('.page-jobs-main')?.__vue__
    if (!Array.isArray(view?.jobList) || typeof view.hasMore !== 'boolean') return null
    return { ids: view.jobList.map(row => row.encryptJobId), hasMore: view.hasMore }
  })
}
export async function loadNextJobBatch({ page, list, timeoutMs = 15000, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now }) {
  const before = await readListSnapshot(page)
  if (!before) throw new Error('AUTO_CHAT_LIST_STALLED')
  if (!before.hasMore) return { hasMore: false }
  const known = new Set(before.ids)
  const box = await list.boundingBox()
  if (!box) throw new Error('AUTO_CHAT_LIST_STALLED')
  const height = await page.evaluate('window.innerHeight')
  await page.mouse.move(box.x + box.width / 2, height / 2)
  const deadline = now() + timeoutMs
  // randomised per batch like the original scroller, so the scrolling isn't uniform
  const increase = 40 + Math.floor(30 * Math.random())
  while (now() < deadline) {
    await page.mouse.wheel({ deltaY: increase })
    await pause(100)
    const next = await readListSnapshot(page)
    if (!next) throw new Error('AUTO_CHAT_LIST_STALLED')
    if (next.ids.some(id => id && !known.has(id)) || !next.hasMore) return next
  }
  throw new Error('AUTO_CHAT_LIST_STALLED')
}
export async function openJobCardForReview({ page, list, index, jobId, timeoutMs = 12000 }) {
  const cards = await list.$$('li.job-card-box')
  if (!jobId || !cards[index]) throw new Error('AUTO_CHAT_DETAIL_NOT_READY')
  // Click even index zero; BOSS may still be showing a previous source's detail.
  await cards[index].click()
  try {
    await page.waitForFunction(expectedId => {
      const selected = document.querySelector('.page-jobs-main')?.__vue__?.currentJob
      const detail = document.querySelector('.job-detail-box')?.__vue__?.data
      return String(selected?.encryptJobId || selected?.encryptId || '') === String(expectedId) &&
        String(detail?.jobInfo?.encryptId || '') === String(expectedId)
    }, { timeout: timeoutMs }, jobId)
  } catch { throw new Error('AUTO_CHAT_DETAIL_NOT_READY') }
}
// Apply each NO_OP prefilter only to its own enabled criterion.
export function listSkipReason(row, { cities = [], cityStrategy, experiences = [], experienceStrategy, salaryEnabled, salaryStrategy, salaryMatches = true, invalidSalary = false }) {
  if (cities.length && cityStrategy === 3 && !cities.includes(row.cityName)) return '城市不符合'
  if (experiences.length && experienceStrategy === 3 && !experiences.includes(row.jobExperience)) return '经验不符合'
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
export function assertCanGreet({ isCollectMode, targetJobIndex, matchedJobId, targetJobId }) {
  if (isCollectMode) throw new Error('AUTO_CHAT_COLLECT_MODE_CHAT_BLOCKED')
  if (targetJobIndex < 0 || !matchedJobId || matchedJobId !== targetJobId)
    throw new Error('AUTO_CHAT_UNMATCHED_JOB_CHAT_BLOCKED')
}
