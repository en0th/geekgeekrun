const ORIGIN = 'https://www.zhipin.com'
const brandPattern = /^[a-f\d]{16}[A-Za-z\d_~-]{1,100}$/
const invalid = () => new Error('公司来源需要 BOSS 品牌 ID（encryptBrandId）或 /gongsi/ 品牌主页链接')

/** Companys/gongsis legal-entity IDs are not interchangeable with brand IDs. */
export function normalizeCompanyBrandId(value) {
  if (typeof value !== 'string' || !value.trim()) throw invalid()
  let id = value.trim()
  if (/^https?:\/\//i.test(id)) {
    let url
    try { url = new URL(id) } catch { throw invalid() }
    if (!['www.zhipin.com', 'zhipin.com'].includes(url.hostname) || url.port || url.username || url.password) throw invalid()
    const match = url.pathname.match(/^\/gongsi\/(?:job\/)?([^/]+)\.html$/)
    if (!match) throw invalid()
    try { id = decodeURIComponent(match[1]) } catch { throw invalid() }
  }
  if (!brandPattern.test(id)) throw invalid()
  return id
}

export const companyHomeUrl = value => `${ORIGIN}/gongsi/${normalizeCompanyBrandId(value)}.html`
export const companyJobsUrl = value => `${ORIGIN}/gongsi/job/${normalizeCompanyBrandId(value)}.html`
export const companySourceFingerprint = value => ['company', normalizeCompanyBrandId(value)]

export function assertCompanyJobIdentity(brand, row, detail) {
  const expected = normalizeCompanyBrandId(brand)
  const rowId = row?.encryptJobId || row?.encryptId
  if (typeof rowId !== 'string' || !rowId.trim() || row?.encryptBrandId !== expected ||
    detail?.brandComInfo?.encryptBrandId !== expected || detail?.jobInfo?.encryptId !== rowId)
    throw Object.assign(new Error('AUTO_CHAT_COMPANY_SOURCE_NOT_CONFIRMED'), {
      detail: '岗位与当前公司品牌或岗位 ID 不一致，任务已暂停并保留进度；请核对公司来源后恢复',
    })
  return true
}

export function hasCompanyConstraint(parameters = {}) {
  return ['brandId', 'encryptBrandId', 'companyId', 'encryptCompanyId'].some(key =>
    String(parameters[key] ?? '').trim() && String(parameters[key]) !== '0')
}
