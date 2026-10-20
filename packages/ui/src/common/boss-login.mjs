import { classifyBossLoginResponse } from '@geekgeekrun/utils/boss-login.mjs'

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
 * Only an explicit authentication failure invalidates credentials.
 */
export function interpretUserInfoResponse(httpStatus, bodyText) {
  let body
  try {
    body = JSON.parse(bodyText)
  } catch {
    if ([401, 403, 429].includes(httpStatus)) return classifyBossLoginResponse(httpStatus, null)
    return {
      status: 'unknown',
      detail: `BOSS返回了无法识别的内容（HTTP ${httpStatus}），可能需要在浏览器中完成安全验证`
    }
  }
  return classifyBossLoginResponse(httpStatus, body)
}
