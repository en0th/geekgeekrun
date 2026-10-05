
import {
  initPuppeteer
} from '@geekgeekrun/geek-auto-start-chat-with-boss/index.mjs'
import {
  sleep,
  sleepWithRandomDelay
} from '@geekgeekrun/utils/sleep.mjs'
import { blockNavigation } from '@geekgeekrun/utils/puppeteer/block-navigation.mjs'
import {
  writeStorageFile
} from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'

import JSON5 from 'json5'
import url from 'url';
import {
  runtimeFolderPath,
  ensureEditThisCookie,
  editThisCookieExtensionPath,
} from './utils.mjs'

import { EventEmitter } from 'node:events'
import { waitForLogin } from './login-watch.mjs'

export const loginEventBus = new EventEmitter()

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

// where the cookies are collected after login: a page that loads the full set of site cookies
const COOKIE_PAGE_URL = 'https://www.zhipin.com/web/geek/jobs'

export async function main() {
  await ensureEditThisCookie()
  const { puppeteer } = await initPuppeteer()
  const browser = await puppeteer.launch({
    headless: false,
    pipe: true,
    enableExtensions: [editThisCookieExtensionPath]
  })

  // keep everything in the one login tab
  const closeAttachedSet = new WeakSet()
  browser.on('targetcreated', async function closeNewTabs(target) {
    const pages = await target.browser().pages()
    for (let i = 1; i < pages.length; i++) {
      const page = pages[i]
      if (!closeAttachedSet.has(page)) {
        closeAttachedSet.add(page)
        page.once('domcontentloaded', () => {
          page.close()
        })
      }
    }
  })

  const [page] = await browser.pages()
  let closed = false
  const quit = async () => {
    if (closed) return
    closed = true
    await browser.close().catch(() => void 0)
    const electron = await import('electron')
    electron.app.quit()
  }
  // the user closed the login window: nothing to collect
  page.once('close', quit)
  browser.once('disconnected', () => {
    closed = true
  })

  await blockNavigation(page, (req) => !req.url().startsWith('https://www.zhipin.com'))
  // a slow load must not end the flow: the user can still log in once the page is usable
  await page.goto('https://www.zhipin.com/web/user/').catch((err) => console.log(err))

  try {
    const loggedIn = await waitForLogin({
      getCookies: () => page.cookies('https://www.zhipin.com/'),
      // the same account API the site calls; code 0 means logged in
      askAccountApi: () =>
        page.evaluate(async () => {
          const res = await fetch('/wapi/zpuser/wap/getUserInfo.json', {
            credentials: 'include',
            signal: AbortSignal.timeout(8000)
          })
          return (await res.json())?.code === 0
        }),
      isClosed: () => closed,
      sleep
    })
    if (!loggedIn) return

    // a job page sets the rest of the site cookies (e.g. after a security check)
    await page.goto(COOKIE_PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 60 * 1000 }).catch(() => void 0)
    if (page.url().startsWith('https://www.zhipin.com/web/common/security-check.html')) {
      await page.waitForNavigation({ timeout: 60 * 1000 }).catch(() => void 0)
    }
    await sleep(2000)
    const cookies = await page.cookies()
    await writeStorageFile('boss-cookies.json', cookies)
    loginEventBus.emit('cookie-collected', cookies)
    // let the message reach the login assistant before the process goes away
    await sleep(800)
  } catch (err) {
    // leave the window open so the user can still log in or close it
    console.log(err)
    return
  }
  await quit()
}
