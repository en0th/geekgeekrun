// Checks at start whether the saved BOSS login still works, with one request to the user
// info API the BOSS site itself calls; nothing is opened in a browser.
import { readStorageFile } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { checkCookieListFormat } from '../../common/utils/cookie'
import {
  BOSS_USER_INFO_URL,
  cookieHeaderFor,
  interpretUserInfoResponse
} from '../../common/boss-login.mjs'

export type BossLoginStatus = 'missing' | 'valid' | 'invalid' | 'unknown'

const TIMEOUT_MS = 10 * 1000

export async function checkBossLoginStatus(): Promise<{ status: BossLoginStatus; detail: string }> {
  const cookies = readStorageFile('boss-cookies.json')
  if (!checkCookieListFormat(cookies)) return { status: 'missing', detail: '' }
  const cookie = cookieHeaderFor(cookies)
  if (!cookie) return { status: 'invalid', detail: '已保存的登录凭证均已过期' }
  try {
    const res = await fetch(BOSS_USER_INFO_URL, {
      headers: {
        Cookie: cookie,
        Accept: 'application/json, text/plain, */*',
        Referer: 'https://www.zhipin.com/web/geek/job',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    return interpretUserInfoResponse(res.status, await res.text()) as {
      status: BossLoginStatus
      detail: string
    }
  } catch (error) {
    const timedOut = (error as Error)?.name === 'TimeoutError'
    return {
      status: 'unknown',
      detail: timedOut ? '连接BOSS直聘超时，请检查网络' : '无法连接BOSS直聘，请检查网络'
    }
  }
}
