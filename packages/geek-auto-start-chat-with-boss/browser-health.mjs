import { jobResponseKind } from './boss-job-responses.mjs'
import { bossLoginError, classifyBossLoginResponse } from '@geekgeekrun/utils/boss-login.mjs'
import { isSecurityCheckUrl } from './security-check.mjs'

export const TASK_BROWSER_ERROR = 'AUTO_CHAT_BROWSER_UNAVAILABLE'
const pendingChats = new WeakSet()
const networkCodes = new Set(['ERR_PROXY_CONNECTION_FAILED', 'ERR_TUNNEL_CONNECTION_FAILED', 'ERR_NO_SUPPORTED_PROXIES',
  'ERR_NAME_NOT_RESOLVED', 'ERR_CONNECTION_RESET', 'ERR_CONNECTION_CLOSED', 'ERR_CONNECTION_REFUSED', 'ERR_CONNECTION_TIMED_OUT',
  'ERR_TIMED_OUT', 'ERR_INTERNET_DISCONNECTED', 'ERR_NETWORK_CHANGED', 'ERR_ADDRESS_UNREACHABLE',
  'ERR_CERT_COMMON_NAME_INVALID', 'ERR_CERT_DATE_INVALID', 'ERR_CERT_AUTHORITY_INVALID', 'ERR_CERT_INVALID',
  'ERR_SSL_PROTOCOL_ERROR', 'ERR_SSL_VERSION_OR_CIPHER_MISMATCH'])
export function beginChatConfirmation(page) { pendingChats.add(page) }
export function finishChatConfirmation(page) { pendingChats.delete(page) }
export function taskPageError(page, error) {
  return pendingChats.has(page) ? Object.assign(new Error('AUTO_CHAT_MESSAGE_SEND_UNCONFIRMED'), {
    detail: '发起沟通后浏览器或连接中断，发送结果尚未确认；请先在BOSS核对结果，避免重复发送',
  }) : error
}
const reasons = {
  executable: ['launch', '未找到可执行的浏览器，任务已暂停；请在浏览器设置中重新选择已安装的 Chrome 或 Edge 后恢复'],
  launch: ['launch', '浏览器启动失败，任务已暂停；请检查所选浏览器是否可正常打开、版本是否可用后恢复'],
  'launch-timeout': ['launch', '浏览器启动连接超时，任务已暂停；请确认浏览器可正常打开，检查后再继续'],
  connection: ['connection', '任务浏览器的连接或监听已中断，任务已暂停；请检查浏览器或代理设置后恢复'],
  closed: ['page', '任务浏览器页面已关闭，任务已暂停；可从任务列表恢复，重新打开浏览器'],
  crashed: ['page', '任务浏览器页面已崩溃，任务已暂停；请关闭占用较高的程序或更新浏览器后恢复'],
  network: ['navigation', 'BOSS页面或岗位请求连接失败，任务已暂停；请检查网络后恢复'],
  proxy: ['navigation', '浏览器代理连接失败，任务已暂停；请检查系统及浏览器代理设置后恢复'],
  certificate: ['navigation', '浏览器未能建立受信任的安全连接，任务已暂停；请检查系统时间、网络或代理证书后恢复'],
  site: ['navigation', 'BOSS页面暂时不可用，任务已暂停；请稍后检查站点后恢复'],
  blank: ['navigation', '任务页面仍为空白或显示浏览器错误页，任务已暂停；请检查网络和浏览器后恢复'],
}

// Never put raw launch messages, executable paths, URLs or debugger endpoints in task logs.
export function taskBrowserError(reason, { cause, httpStatus } = {}) {
  if (!reasons[reason]) reason = 'connection'
  const [stage, detail] = reasons[reason]
  const code = String(cause?.message || '').match(/\bERR_[A-Z_]+\b/)?.[0]
  return Object.assign(new Error(TASK_BROWSER_ERROR), {
    detail, diagnostic: { stage, reason, ...(networkCodes.has(code) ? { code } : {}), ...(httpStatus ? { httpStatus } : {}) },
  })
}
export function browserLaunchError(cause) {
  const missing = cause?.code === 'ENOENT' || /could not find chrome|no executable was found|executable doesn't exist|browser was not found/i.test(cause?.message || '')
  const timeout = cause?.name === 'TimeoutError' || /timed?\s*out|timeout/i.test(cause?.message || '')
  return taskBrowserError(missing ? 'executable' : timeout ? 'launch-timeout' : 'launch', { cause })
}
function requestError(text) {
  const reason = /ERR_(?:PROXY|TUNNEL)/.test(text) ? 'proxy' : /ERR_(?:CERT|SSL)/.test(text) ? 'certificate' : 'network'
  return taskBrowserError(reason, { cause: new Error(text) })
}
function bossUrl(value) {
  try { return /(^|\.)zhipin\.com$/.test(new URL(value).hostname) } catch { return false }
}

/** Observe the one owned task browser. Unrelated assets, subframes and script errors
 * cannot stand in for failed job transport or a crashed page. */
export function watchTaskBrowser(browser, page, { onFailure = () => {} } = {}) {
  let failure, disposed = false, rejectFailure
  const failed = new Promise((_, reject) => { rejectFailure = reject })
  failed.catch(() => {})
  function block(error) {
    if (disposed || failure) return failure
    error = taskPageError(page, error)
    failure = error
    rejectFailure(error)
    try { onFailure(error) } catch { /* Diagnostics cannot disable the stop. */ }
    return failure
  }
  const closed = () => block(taskBrowserError('closed'))
  const crashed = cause => block(taskBrowserError('crashed', { cause }))
  const disconnected = () => block(taskBrowserError('connection'))
  const mainDocument = request => request.isNavigationRequest?.() && request.frame?.() === page.mainFrame()
  const requestFailed = request => {
    try {
      const url = request.url(), text = request.failure?.()?.errorText || ''
      // Native source/filter changes and refused budget reservations abort old requests.
      if (text.includes('ERR_ABORTED') || (!jobResponseKind(url) && !(bossUrl(url) && mainDocument(request)))) return
      block(requestError(text))
    } catch { /* A detached request cannot provide transport evidence. */ }
  }
  const response = response => {
    try {
      const url = response.url(), status = response.status()
      if (!bossUrl(url) || !mainDocument(response.request()) || isSecurityCheckUrl(url)) return
      if ([403, 429].includes(status)) block(bossLoginError(classifyBossLoginResponse(status, null)))
      else if (status >= 400) block(taskBrowserError('site', { httpStatus: status }))
    } catch { /* Job API bodies remain the responsibility of the response guard. */ }
  }
  const navigated = frame => {
    try {
      if (frame === page.mainFrame() && /^(?:chrome-error:|about:neterror)/.test(frame.url())) block(taskBrowserError('blank'))
    } catch { /* Ignore frames already detached during shutdown. */ }
  }
  browser.on('disconnected', disconnected)
  page.on('close', closed)
  page.on('error', crashed)
  page.on('requestfailed', requestFailed)
  page.on('response', response)
  page.on('framenavigated', navigated)
  // Close/disconnect can precede listener installation while launch is completing.
  if (page.isClosed?.()) closed()
  else if (browser.connected === false) disconnected()
  const assertHealthy = () => {
    if (failure) throw failure
    if (disposed) throw new Error('AUTO_CHAT_TASK_STOPPING')
  }
  return {
    assertHealthy,
    connectionLost: disconnected,
    async guard(action) { assertHealthy(); return Promise.race([Promise.resolve().then(() => { assertHealthy(); return action() }), failed]) },
    dispose() {
      disposed = true
      pendingChats.delete(page)
      browser.off('disconnected', disconnected)
      for (const [event, listener] of [['close', closed], ['error', crashed], ['requestfailed', requestFailed], ['response', response], ['framenavigated', navigated]]) page.off(event, listener)
      rejectFailure(new Error('AUTO_CHAT_TASK_STOPPING'))
    },
  }
}
