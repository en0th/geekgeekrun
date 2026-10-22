// Adapter for eatmoreduck/boss-zhipin-scraper JSON and CSV, based on b8076fc.
// Read exported data only; no browser, network, or messaging actions.
import { parseCompanySize } from '@geekgeekrun/utils/job-values.cjs'
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null
const stableId = value => {
  const id = text(value)
  return id && /^[A-Za-z0-9_~.-]+$/.test(id) && id.length <= 200 ? id : null
}
function linkedId(value) {
  if (!text(value)) return null
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || !['www.zhipin.com', 'zhipin.com'].includes(url.hostname) || url.username || url.password)
      return null
    const match = url.pathname.match(/^\/job_detail\/([^/]+)\.html$/)
    return match ? stableId(decodeURIComponent(match[1])) : null
  } catch { return null }
}
export function scraperCapturedAt(value) {
  const date = text(value)
  // The scraper often writes a local timestamp without an offset. Preserve it
  // as source text; it is neither a UTC capture time nor a publication date.
  return date && date.length <= 80 && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(date) &&
    Number.isFinite(Date.parse(date)) ? date : null
}

export function adaptScraperRecords(records, metadata = {}) {
  if (!Array.isArray(records) || records.length > 200000) throw new Error('scraper 导入需要不超过 200,000 行的岗位数组')
  const counts = { invalidId: 0, conflictingId: 0, missingJd: 0, missingCompanyId: 0, missingBossId: 0 }
  const sourceCapturedAt = scraperCapturedAt(metadata.scraped_at)
  const handled = new Set(['encrypt_job_id', 'encrypt_brand_id', 'encrypt_boss_id', 'title', 'salary', 'location',
    'jd', 'job_link', 'link', 'boss_name', 'company', 'boss_title', 'company_scale', 'company_stage', 'company_industry', 'scraped_at'])
  const ignoredHeaders = new Set()
  const rows = records.map(record => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('scraper 岗位行必须是对象')
    for (const field of Object.keys(record)) if (!handled.has(field)) ignoredHeaders.add(field)
    const direct = stableId(record.encrypt_job_id), linked = linkedId(record.job_link || record.link)
    const conflicting = Boolean(direct && linked && direct !== linked)
    const encryptJobId = conflicting ? null : direct || linked
    if (conflicting) counts.conflictingId++
    else if (!encryptJobId) counts.invalidId++
    const description = text(record.jd)
    const companyId = stableId(record.encrypt_brand_id), bossId = stableId(record.encrypt_boss_id)
    const [companyScaleLow, companyScaleHigh] = parseCompanySize(record.company_scale)
    if (!description) counts.missingJd++
    if (!companyId) counts.missingCompanyId++
    if (!bossId) counts.missingBossId++
    return {
      encryptJobId, jobName: text(record.title), salaryDesc: text(record.salary),
      address: text(record.location), description,
      // boss_name in this format is brandName, never the recruiter's name.
      companyName: text(record.boss_name) || text(record.company),
      encryptCompanyId: companyId, encryptBossId: bossId, bossTitle: text(record.boss_title),
      companyStageName: text(record.company_stage), companyIndustryName: text(record.company_industry),
      companyScaleLow, companyScaleHigh,
      sourceCapturedAt: scraperCapturedAt(record.scraped_at) || sourceCapturedAt
    }
  })
  const warnings = [
    'scraper 的 boss_name 按公司品牌导入；MD5 job_id、is_new 和安全参数不会导入，招聘者姓名保持缺失。',
    '源采集时间按原文保存；无时区的时间不推断时区，也不当作岗位发布时间或本库首次入库时间。'
  ]
  if (counts.invalidId) warnings.push(`${counts.invalidId} 行缺少稳定岗位 ID 和有效 BOSS 岗位链接，将跳过。`)
  if (counts.conflictingId) warnings.push(`${counts.conflictingId} 行岗位 ID 与链接冲突，将跳过。`)
  if (counts.missingJd) warnings.push(`${counts.missingJd} 行没有 JD，不会编造 JD 或清空库内已有描述。`)
  if (counts.missingCompanyId || counts.missingBossId)
    warnings.push(`公司 ID 缺失 ${counts.missingCompanyId} 行，招聘者 ID 缺失 ${counts.missingBossId} 行；不按名称制造 ID。`)
  if (metadata.scraped_at && !sourceCapturedAt) warnings.push('文件的源采集时间无效，未推断为当前时间。')
  return { rows, warnings, ignoredHeaders: [...ignoredHeaders].sort() }
}
