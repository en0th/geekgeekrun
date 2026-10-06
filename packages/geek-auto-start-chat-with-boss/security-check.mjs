// BOSS sends a browser it doubts to a verification page (slider, security check). Only a person
// can pass it; afterwards the page goes back to where it was, so the task can wait and go on.
const SECURITY_CHECK_PATHS = [
  '/web/user/safe/verify-slider',
  '/web/common/security-check.html',
  '/web/passport/zp/verify'
]

export function isSecurityCheckUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (!/(^|\.)zhipin\.com$/.test(parsed.hostname)) return false
  return (
    SECURITY_CHECK_PATHS.some((p) => parsed.pathname.startsWith(p)) ||
    /verify-slider|captcha/i.test(parsed.pathname)
  )
}

/**
 * Wait until the page has left the verification page.
 * Resolves 'passed', or 'closed' when the window was closed first.
 */
export async function waitForSecurityCheck({ currentUrl, isClosed, sleep, interval = 2000 }) {
  while (true) {
    if (isClosed()) return 'closed'
    let url
    try {
      url = await currentUrl()
    } catch {
      return 'closed'
    }
    if (url && !isSecurityCheckUrl(url)) return 'passed'
    await sleep(interval)
  }
}
