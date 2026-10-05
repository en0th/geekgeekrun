// Waiting for the user to finish logging in on the BOSS login page, whatever way they log in
// (QR code, SMS, WeChat): instead of waiting for particular login API calls, which change with
// the site, poll whether the browser now holds a login that the site's account API accepts.

// cookies BOSS sets once a user is logged in
export const LOGIN_COOKIE_NAMES = ['wt2', 'zp_at']
export const POLL_INTERVAL_MS = 2000
// ask the account API even without those cookies every this many polls, in case they are renamed
export const API_FALLBACK_EVERY = 5

/** the login cookie values, joined; '' when there are none */
export function loginToken(cookies) {
  return (cookies || [])
    .filter((c) => LOGIN_COOKIE_NAMES.includes(c?.name) && c?.value)
    .map((c) => c.name + '=' + c.value)
    .sort()
    .join(';')
}

/**
 * Whether this poll should ask the account API: when a login cookie appeared or changed since
 * the last answer, and every API_FALLBACK_EVERY polls in any case (renamed cookies, a stale
 * cookie left over from an expired login that the site has since renewed).
 */
export function shouldAskAccountApi(cookies, pollIndex, lastAskedToken = '') {
  const token = loginToken(cookies)
  if (token && token !== lastAskedToken) return true
  return pollIndex > 0 && pollIndex % API_FALLBACK_EVERY === 0
}

/**
 * Resolves once logged in, or with false when `isClosed()` turns true first.
 * `getCookies()` reads the browser's zhipin.com cookies; `askAccountApi()` resolves to
 * whether the site's user info API answers code 0.
 */
export async function waitForLogin({
  getCookies,
  askAccountApi,
  isClosed,
  sleep,
  interval = POLL_INTERVAL_MS
}) {
  let lastAskedToken = ''
  for (let i = 0; !isClosed(); i++) {
    let cookies = []
    try {
      cookies = await getCookies()
    } catch {
      // the page is navigating; try again on the next poll
    }
    if (shouldAskAccountApi(cookies, i, lastAskedToken)) {
      lastAskedToken = loginToken(cookies)
      try {
        if (await askAccountApi()) return true
      } catch {
        // not answered yet
      }
    }
    await sleep(interval)
  }
  return false
}
