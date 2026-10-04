// Interpreting a BOSS login check. Pure so it can be unit tested; the request lives in
// src/main/features/boss-login-check.ts.

export const BOSS_USER_INFO_URL = 'https://www.zhipin.com/wapi/zpuser/wap/getUserInfo.json'

/** "name=value; ..." for the cookies sent to www.zhipin.com, skipping expired ones */
export function cookieHeaderFor(cookies, host = 'www.zhipin.com', now = Date.now() / 1000) {
  return (Array.isArray(cookies) ? cookies : [])
    .filter((c) => {
      if (!c?.name || typeof c.domain !== 'string') return false
      const domain = c.domain.replace(/^\./, '')
      if (host !== domain && !host.endsWith('.' + domain)) return false
      return !(typeof c.expirationDate === 'number' && !c.session && c.expirationDate < now)
    })
    .map((c) => `${c.name}=${c.value ?? ''}`)
    .join('; ')
}

/**
 * status: valid (logged in), invalid (BOSS says not logged in) or unknown (the answer
 * couldn't be read: verification page, server error).
 */
export function interpretUserInfoResponse(httpStatus, bodyText) {
  let body
  try {
    body = JSON.parse(bodyText)
  } catch {
    return {
      status: 'unknown',
      detail: `BOSS返回了无法识别的内容（HTTP ${httpStatus}），可能需要在浏览器中完成安全验证`
    }
  }
  if (body?.code === 0) return { status: 'valid', detail: '' }
  if (httpStatus >= 500)
    return { status: 'unknown', detail: `BOSS服务暂时不可用（HTTP ${httpStatus}）` }
  return {
    status: 'invalid',
    detail: String(body?.message || `登录状态无效（代码 ${body?.code ?? httpStatus}）`)
  }
}
