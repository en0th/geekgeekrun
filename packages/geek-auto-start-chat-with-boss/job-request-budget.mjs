import { jobResponseKind } from './boss-job-responses.mjs'
import { budgetStateError } from './run-budget.mjs'
import { createRequire } from 'node:module'
import { isCompanyJobsDocument } from './company-source.mjs'
import { taskBrowserError, taskPageError } from './browser-health.mjs'
// puppeteer-extra loads Puppeteer through require(). Its CDP event names are Symbols;
// the separately loaded ESM copy exports different Symbols for the same event.
const { CDPSessionEvent } = createRequire(import.meta.url)('puppeteer')

/** Intercept only job list/detail requests, before they can leave the task's page. */
export async function attachJobRequestBudget(page, budget, { onConnectionLost } = {}) {
  let session
  let disposed = false
  const unavailable = () => budgetStateError('岗位请求预算监听已中断，任务已暂停；请检查浏览器后恢复，累计用量会保留')
  const disconnected = () => {
    if (disposed) return
    let diagnostic
    try { diagnostic = onConnectionLost?.() } catch { /* Keep the durable budget stop even if diagnostics fail. */ }
    budget.fail(diagnostic instanceof Error ? diagnostic : taskPageError(page,
      page.isClosed?.() || page.browser?.()?.connected === false ? taskBrowserError('connection') : unavailable()))
  }
  async function paused({ requestId, request }) {
    if (disposed) return
    try {
      const kind = jobResponseKind(request.url) || (isCompanyJobsDocument(request.url) ? 'list' : null)
      if (kind) budget.reserveRequest(kind)
      await session.send('Fetch.continueRequest', { requestId })
    } catch (error) {
      // Fail closed. Never continue a request whose reservation was refused or unsaved.
      await session.send('Fetch.failRequest', { requestId, errorReason: 'Aborted' }).catch(() => {})
      if (!disposed) budget.fail(error.message?.startsWith('AUTO_CHAT_RUN_BUDGET_') ? error : unavailable())
    }
  }
  try {
    session = await page.createCDPSession()
    session.on('Fetch.requestPaused', paused)
    session.on(CDPSessionEvent.Disconnected, disconnected)
    await session.send('Fetch.enable', { patterns: [
      '/wapi/zpgeek/search/joblist.json', '/wapi/zpgeek/pc/recommend/job/list.json', '/wapi/zpgeek/job/detail.json',
      '/wapi/zpgeek/brand/job/querylist.json', '/gongsi/job/'
    ].map(endpoint => ({ urlPattern: '*://*zhipin.com' + endpoint + '*', requestStage: 'Request' })) })
  } catch {
    disposed = true
    session?.off('Fetch.requestPaused', paused)
    session?.off(CDPSessionEvent.Disconnected, disconnected)
    throw budget.fail(unavailable())
  }
  return {
    // The page is closed immediately by the caller. Do not disable interception on
    // a live page: Fetch.disable could release a request refused by the budget.
    dispose() {
      disposed = true
      session.off('Fetch.requestPaused', paused)
      session.off(CDPSessionEvent.Disconnected, disconnected)
    }
  }
}
