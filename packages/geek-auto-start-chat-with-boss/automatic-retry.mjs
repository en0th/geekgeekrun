const delays = [5000, 15000, 30000, 60000, 120000]
const networkError = /\bERR_(?:INTERNET_DISCONNECTED|NETWORK_CHANGED|NAME_NOT_RESOLVED|CONNECTION_[A-Z_]+|TIMED_OUT|ADDRESS_UNREACHABLE|PROXY_CONNECTION_FAILED|TUNNEL_CONNECTION_FAILED)\b/

export function retryProblem(error, { sendPending = false } = {}) {
  const message = String(error?.message || '')
  if (sendPending || /SEND_UNCONFIRMED|AUTO_CHAT_DAILY_|AUTO_CHAT_RUN_BUDGET_|CHAT_BLOCKED|ACCOUNT_CHANGED|LOGIN_STATUS_(?:INVALID|RESTRICTED)|SECURITY_CHECK|ALL_SOURCES_ROTATED|NO_USABLE_SOURCE|NO_MATCH_BATCH_LIMIT/.test(message)
    || String(error?.code || '').startsWith('GGR_')) return null
  if (message === 'AUTO_CHAT_BROWSER_UNAVAILABLE') {
    const { reason, httpStatus } = error.diagnostic || {}
    if (['network', 'connection', 'closed', 'crashed', 'blank', 'launch-timeout', 'proxy'].includes(reason)
      || (reason === 'site' && (httpStatus >= 500 || httpStatus === 408)))
      return { kind: 'network', text: '浏览器或网络连接暂时中断' }
    return null
  }
  if (networkError.test(message)) return { kind: 'network', text: '网络连接暂时中断' }
  if (/AUTO_CHAT_(?:LIST_STALLED|DETAIL_NOT_READY|JOB_PAGE_CLOSED)/.test(message) || error?.name === 'TimeoutError')
    return { kind: 'page', text: '岗位页面暂未加载完成' }
  if (/Node is detached|Execution context was destroyed|Cannot find context|Task control is not available|not clickable|not attached to the document/i.test(message))
    return { kind: 'page', text: '页面内容正在切换，正在重新核对当前岗位' }
  if (message === 'LOGIN_STATUS_UNKNOWN') return { kind: 'network', text: '暂未收到可确认的登录或岗位响应' }
  if (/AUTO_CHAT_(?:PAGE_FILTER_NOT_APPLIED|CITY_FILTER_NOT_APPLIED|SEARCH_FILTER_NOT_APPLIED|COMPANY_SOURCE_NOT_CONFIRMED)/.test(message))
    return { kind: 'configuration', text: '页面筛选暂未确认，正在重新应用原条件' }
  if (message === 'AUTO_CHAT_RETRY_UNEXPECTED') return { kind: 'unexpected', text: '任务暂未完成，正在重新检查' }
  return null
}

/** One task remains alive while transient reads recover; sending is never retried here. */
export function createAutomaticRetry({ prepare, publish = () => {}, progressKey = () => '',
  sendPending = () => false, isStopping = () => false, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let attempt = 0, previousProgress, configurationAttempts = 0
  return {
    async recover(error) {
      const problem = retryProblem(error, { sendPending: sendPending() })
      if (!problem || isStopping()) return false
      const progress = progressKey()
      if (progress !== previousProgress) { attempt = 0; configurationAttempts = 0; previousProgress = progress }
      if (problem.kind === 'configuration' && ++configurationAttempts > 3) return false
      const delayMs = delays[Math.min(attempt++, delays.length - 1)]
      await prepare(error)
      if (isStopping()) return false
      if (sendPending()) throw Object.assign(new Error('AUTO_CHAT_MESSAGE_SEND_UNCONFIRMED'), { detail: '上次发送结果尚未确认，请先核对；不会自动重发。' })
      const until = now() + delayMs
      publish({ attempt, until, delayMs, reason: problem.text })
      while (!isStopping() && now() < until) await sleep(Math.min(1000, until - now()))
      if (isStopping()) return false
      publish({ attempt, until: 0, delayMs: 0, reason: '正在重新连接，从原进度继续' })
      return true
    },
  }
}
