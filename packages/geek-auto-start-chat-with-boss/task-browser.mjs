import { randomUUID } from 'node:crypto'
import { useBackgroundTaskInput } from './task-page-input.mjs'
import { closeOwnedBrowser } from './browser-cleanup.mjs'
import { browserLaunchError } from './browser-health.mjs'

export const BACKGROUND_WINDOW_ERROR = 'AUTO_CHAT_BACKGROUND_WINDOW_UNAVAILABLE'
const viewport = { width: 1440, height: 760 }

// Keep a normal, headed Chrome session. Create its first window inactive and minimized,
// rather than showing a default window first and trying to hide it afterwards.
export async function launchTaskBrowser(puppeteer, { background = true } = {}) {
  const browser = await puppeteer.launch({
    headless: false,
    handleSIGTERM: false,
    handleSIGINT: false,
    handleSIGHUP: false,
    ignoreHTTPSErrors: true,
    defaultViewport: viewport,
    ...(background ? { waitForInitialPage: false, args: ['--no-startup-window'] } : {}),
  }).catch(cause => { throw browserLaunchError(cause) })
  let session
  try {
    if (!background) {
      const page = (await browser.pages())[0] || await browser.newPage()
      return { browser, page }
    }
    session = await browser.target().createCDPSession()
    const bootstrapUrl = 'about:blank#ggr-' + randomUUID()
    const { targetId } = await session.send('Target.createTarget', {
      url: bootstrapUrl, newWindow: true, background: true, windowState: 'minimized',
    })
    const target = await browser.waitForTarget(target => target.url() === bootstrapUrl)
    const page = await target.page()
    if (!page) throw new Error('Browser did not create the task page')
    const { windowId, bounds } = await session.send('Browser.getWindowForTarget', { targetId })
    // Older Chrome versions may ignore createTarget.windowState. Never activate the target.
    if (bounds.windowState !== 'minimized')
      await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } })
    const state = await session.send('Browser.getWindowBounds', { windowId })
    if (state.bounds.windowState !== 'minimized') throw new Error('Browser did not minimize the task window')
    useBackgroundTaskInput(page)
    return { browser, page }
  } catch (cause) {
    await closeOwnedBrowser(browser)
    if (!background) throw browserLaunchError(cause)
    throw Object.assign(new Error(BACKGROUND_WINDOW_ERROR, { cause }), {
      detail: '无法确认BOSS浏览器已在后台最小化，任务已暂停；请检查浏览器，或关闭“后台运行浏览器”后恢复。',
    })
  } finally {
    await session?.detach().catch(() => {})
  }
}

// Only used when BOSS needs a person to complete a security check.
export async function showTaskBrowser(page) {
  const session = await page.createCDPSession()
  try {
    const { windowId } = await session.send('Browser.getWindowForTarget')
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })
    await page.bringToFront()
  } finally {
    await session.detach().catch(() => {})
  }
}
