import { classifyBossLoginResponse, bossLoginError } from '@geekgeekrun/utils/boss-login.mjs'
import { isCompanyJobsDocument } from './company-source.mjs'
import { watchJobDocument } from './job-response-document.mjs'

const listPaths = new Set([
  '/wapi/zpgeek/search/joblist.json',
  '/wapi/zpgeek/pc/recommend/job/list.json',
  '/wapi/zpgeek/brand/job/querylist.json'
])
const scopeFields = ['query', 'city', 'salary', 'experience', 'degree', 'industry', 'scale', 'jobType', 'position', 'expectId', 'jobExpectId', 'sort',
  'brandId', 'encryptBrandId', 'companyId', 'encryptCompanyId', 'positionLv1']
const scopeValue = value => [...new Set((Array.isArray(value) ? value : String(value ?? '').split(','))
  .map(String).map(value => value.trim()).filter(value => value && value !== '0'))].sort().join(',')

function readListRequest(response) {
  const request = response.request?.()
  const url = new URL(request?.url?.() || response.url())
  const parameters = Object.fromEntries(url.searchParams)
  const posted = request?.postData?.()
  if (posted) {
    try { Object.assign(parameters, JSON.parse(posted)) }
    catch { Object.assign(parameters, Object.fromEntries(new URLSearchParams(posted))) }
  }
  return { path: url.pathname, parameters }
}
export function jobResponseKind(url) {
  let parsed
  try { parsed = new URL(url) } catch { return null }
  if (!/(^|\.)zhipin\.com$/.test(parsed.hostname)) return null
  if (listPaths.has(parsed.pathname)) return 'list'
  return parsed.pathname === '/wapi/zpgeek/job/detail.json' ? 'detail' : null
}

// A successful job response has a different schema from the user identity probe.
export function classifyJobResponse(httpStatus, body, kind = 'list') {
  const access = classifyBossLoginResponse(httpStatus, body)
  if (['invalid', 'restricted'].includes(access.status)) return access
  if (httpStatus >= 200 && httpStatus < 300 && (body?.code === 0 || body?.code === '0')) {
    if (kind === 'list' && Array.isArray(body?.zpData?.jobList))
      return { status: body.zpData.jobList.length ? 'available' : 'empty', detail: '' }
    if (kind === 'detail' && body?.zpData?.jobInfo && !Array.isArray(body.zpData.jobInfo) &&
      String(body.zpData.jobInfo.encryptId || body.zpData.jobInfo.encryptJobId || '').trim())
      return { status: 'available', detail: '' }
  }
  return { status: 'unknown', detail: 'BOSS职位接口响应暂时无法确认，已暂停任务；登录凭证和已完成的进度会保留' }
}

/** Watch every page of the run, including responses arriving during detail rendering. */
export function watchJobResponses(page, { bodyTimeoutMs = 15000, onBlocked = () => {}, onListResponse = () => {} } = {}) {
  const pending = new Set()
  const cancelReads = new Set()
  let failure = null
  let disposed = false
  let expectedSearch = null
  let expectedList = null
  let sequence = 0, latestList = null, listPages = new Map(), listScope = ''
  let listGeneration = 0, listPageSequences = new Map()
  const document = watchJobDocument(page, { onNavigation: generation => {
    latestList = null
    listScope = ''
    listGeneration++
    listPages.clear()
    listPageSequences.clear()
    for (const cancel of cancelReads) if (cancel.documentGeneration < generation) cancel()
  } })
  let rejectFailure
  const failed = new Promise((_, reject) => { rejectFailure = reject })
  // The monitor can fail between checkpoints, before guard() has subscribed.
  failed.catch(() => {})
  function block(result) {
    if (disposed || failure) return
    failure = bossLoginError(result)
    rejectFailure(failure)
    try { onBlocked(failure) } catch { /* Progress delivery must not disable the response guard. */ }
  }
  function onResponse(response) {
    const kind = jobResponseKind(response.url())
    if (disposed) return
    if (!kind) {
      if (isCompanyJobsDocument(response.url()) && [401, 403, 429].includes(response.status()))
        block(classifyJobResponse(response.status(), null))
      return
    }
    if ([401, 403, 429].includes(response.status())) {
      block(classifyJobResponse(response.status(), null, kind))
      return
    }
    const searchCheck = expectedSearch
    const documentGeneration = document.generation
    const responseSequence = kind === 'list' ? ++sequence : 0
    let listRequest = null
    if (kind === 'list') {
      try {
        const parsed = readListRequest(response)
        const pageNumber = Number(parsed.parameters.page ?? 1)
        const scope = JSON.stringify([parsed.path, ...scopeFields.map(key => key === 'query'
          ? String(parsed.parameters[key] ?? '').trim() : scopeValue(parsed.parameters[key]))])
        // Reset generations at header arrival, not body completion. A late page from
        // an older refresh cannot enter the cache for the new first page.
        if (scope !== listScope || pageNumber === 1) {
          listScope = scope
          listGeneration++
          listPages = new Map()
          listPageSequences = new Map()
        }
        listRequest = { ...parsed, pageNumber, generation: listGeneration }
      } catch { /* An unreadable request cannot establish a matching list. */ }
    }
    let timer, cancel
    const cancelled = new Promise((_, reject) => {
      cancel = () => reject(new Error('Job response monitor closed'))
      cancel.documentGeneration = documentGeneration
      cancelReads.add(cancel)
      timer = setTimeout(() => reject(new Error('Job response body timed out')), bodyTimeoutMs)
    })
    const reading = (async () => {
      try {
        const bodyRead = Promise.resolve().then(() => response.json()).then(body => {
          // A late, explicit authentication/restriction result still stops the run.
          // An abandoned body must never become a way to hide a known access failure.
          if (!disposed && documentGeneration !== document.generation) {
            const result = classifyJobResponse(response.status(), body, kind)
            if (['invalid', 'restricted'].includes(result.status)) block(result)
          }
          return body
        })
        const body = await Promise.race([bodyRead, cancelled])
        if (documentGeneration !== document.generation) return
        const result = classifyJobResponse(response.status(), body, kind)
        if (kind === 'list' && ['available', 'empty'].includes(result.status)) {
          try {
            const { path, parameters } = listRequest || readListRequest(response)
            const pageNumber = Number(parameters.page ?? 1)
            if (!disposed && listRequest?.generation === listGeneration) {
              if (responseSequence > (listPageSequences.get(pageNumber) || 0)) {
                listPageSequences.set(pageNumber, responseSequence)
                listPages.set(pageNumber, body.zpData.jobList.map(row => String(row?.encryptJobId || row?.encryptId || '')))
              }
              if (responseSequence > (latestList?.sequence || 0)) latestList = {
                sequence: responseSequence, path, page: pageNumber,
                parameters: Object.fromEntries(scopeFields.filter(key => parameters[key] !== undefined).map(key => [key, parameters[key]])), ids: null,
              }
              const lastPage = latestList.page
              const consecutive = Number.isSafeInteger(lastPage) && lastPage > 0 &&
                listPages.size === lastPage && [...listPages.keys()].every(page => page >= 1 && page <= lastPage)
              latestList.ids = path === '/wapi/zpgeek/brand/job/querylist.json'
                ? listPages.get(lastPage) || null
                : consecutive ? [...listPages].sort(([a], [b]) => a - b).flatMap(([, ids]) => ids) : null
            }
            onListResponse({ path, page: pageNumber,
              query: parameters.query ?? null, city: parameters.city ?? null,
              filters: Object.fromEntries(['salary', 'experience', 'degree', 'industry', 'scale', 'jobType', 'position']
                .filter(key => parameters[key] !== undefined).map(key => [key, parameters[key]])),
              count: body.zpData.jobList.length,
              fields: Object.keys(body.zpData),
              flags: Object.fromEntries(Object.entries(body.zpData).filter(([, value]) => ['number', 'boolean'].includes(typeof value))) })
          } catch { /* Observability must not change response validation. */ }
        }
        if (!['available', 'empty'].includes(result.status)) block(result)
        else if (kind === 'list' && listRequest?.path === '/wapi/zpgeek/brand/job/querylist.json' &&
          (!listRequest.parameters.brandId || body.zpData.jobList.some(row => !row?.encryptJobId || row.encryptBrandId !== listRequest.parameters.brandId)))
          block({ status: 'unknown', detail: '公司列表包含无法确认归属的岗位，任务已暂停' })
        // A response header can arrive while filters are being applied, then finish
        // decoding after readiness has armed the new scope. Use the current rule.
        else if (kind === 'list' && expectedList && !expectedList(response.request?.()))
          block({ status: 'unknown', detail: 'BOSS职位列表响应与当前筛选条件不一致，已暂停任务，请检查页面后恢复' })
        else if (searchCheck && response.url().split('?')[0].endsWith('/search/joblist.json') && !searchCheck(response.request()))
          block({ status: 'unknown', detail: 'BOSS搜索响应与本次搜索内容或平台职位类目不一致，已暂停任务，请检查页面后恢复' })
      } catch {
        if (!disposed && documentGeneration === document.generation)
          block(classifyJobResponse(response.status(), null, kind))
      } finally {
        clearTimeout(timer)
        cancelReads.delete(cancel)
      }
    })()
    pending.add(reading)
    void reading.finally(() => pending.delete(reading))
  }
  page.on('response', onResponse)
  async function assertHealthy() {
    if (failure) throw failure
    if (disposed) throw new Error('AUTO_CHAT_JOB_PAGE_CLOSED')
    await document.ready
    // Responses can arrive while an earlier response body is still being read.
    while (pending.size) {
      await Promise.all([...pending])
      if (failure) throw failure
      if (disposed) throw new Error('AUTO_CHAT_JOB_PAGE_CLOSED')
    }
    if (failure) throw failure
    if (disposed) throw new Error('AUTO_CHAT_JOB_PAGE_CLOSED')
  }
  return {
    assertHealthy,
    expectSearch(matchesRequest = null) { expectedSearch = matchesRequest },
    expectList(matchesRequest = null) { expectedList = matchesRequest },
    getListSnapshot() { return latestList },
    async guard(action) {
      await assertHealthy()
      return Promise.race([Promise.resolve().then(action), failed])
    },
    dispose() {
      disposed = true
      rejectFailure(failure || new Error('AUTO_CHAT_JOB_PAGE_CLOSED'))
      page.off('response', onResponse)
      document.dispose()
      for (const cancel of cancelReads) cancel()
      latestList = null
      listPages.clear()
      listPageSequences.clear()
    }
  }
}
