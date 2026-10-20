import { classifyBossLoginResponse, bossLoginError } from '@geekgeekrun/utils/boss-login.mjs'

const listPaths = new Set([
  '/wapi/zpgeek/search/joblist.json',
  '/wapi/zpgeek/pc/recommend/job/list.json'
])
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
    if (disposed || !kind) return
    if ([401, 403, 429].includes(response.status())) {
      block(classifyJobResponse(response.status(), null, kind))
      return
    }
    const searchCheck = expectedSearch
    let timer, cancel
    const cancelled = new Promise((_, reject) => {
      cancel = () => reject(new Error('Job response monitor closed'))
      cancelReads.add(cancel)
      timer = setTimeout(() => reject(new Error('Job response body timed out')), bodyTimeoutMs)
    })
    const reading = (async () => {
      try {
        const body = await Promise.race([Promise.resolve().then(() => response.json()), cancelled])
        const result = classifyJobResponse(response.status(), body, kind)
        if (kind === 'list' && ['available', 'empty'].includes(result.status)) {
          try {
            const request = response.request?.()
            const url = new URL(request?.url?.() || response.url())
            const parameters = Object.fromEntries(url.searchParams)
            const posted = request?.postData?.()
            if (posted) {
              try { Object.assign(parameters, JSON.parse(posted)) }
              catch { Object.assign(parameters, Object.fromEntries(new URLSearchParams(posted))) }
            }
            onListResponse({ path: url.pathname,
              query: parameters.query ?? null, city: parameters.city ?? null,
              count: body.zpData.jobList.length,
              fields: Object.keys(body.zpData),
              flags: Object.fromEntries(Object.entries(body.zpData).filter(([, value]) => ['number', 'boolean'].includes(typeof value))) })
          } catch { /* Observability must not change response validation. */ }
        }
        if (!['available', 'empty'].includes(result.status)) block(result)
        else if (searchCheck && response.url().split('?')[0].endsWith('/search/joblist.json') && !searchCheck(response.request()))
          block({ status: 'unknown', detail: 'BOSS搜索响应与本次搜索内容或平台职位类目不一致，已暂停任务，请检查页面后恢复' })
      } catch {
        if (!disposed) block(classifyJobResponse(response.status(), null, kind))
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
    async guard(action) {
      await assertHealthy()
      return Promise.race([Promise.resolve().then(action), failed])
    },
    dispose() {
      disposed = true
      rejectFailure(failure || new Error('AUTO_CHAT_JOB_PAGE_CLOSED'))
      page.off('response', onResponse)
      for (const cancel of cancelReads) cancel()
    }
  }
}
