// Job status polling task: opens each favourited job's detail page and records whether it is
// still hiring, closed or deleted. A finite task in the daemon's BOSS queue (jobStatusPollMain).
import { app } from 'electron'
import { Browser, Page } from 'puppeteer'
import { initDb } from '@geekgeekrun/sqlite-plugin'
import { saveJobHireStatusRecord } from '@geekgeekrun/sqlite-plugin/dist/handlers'
import { JobHireStatus } from '@geekgeekrun/sqlite-plugin/dist/enums'
import {
  getPublicDbFilePath,
  readConfigFile,
  readStorageFile,
  writeStorageFile
} from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { readRunSettings } from '@geekgeekrun/geek-auto-start-chat-with-boss/run-settings.mjs'
import { sleep, sleepWithRandomDelay } from '@geekgeekrun/utils/sleep.mjs'
import { setDomainLocalStorage } from '@geekgeekrun/utils/puppeteer/local-storage.mjs'
import { connectToDaemon, sendToDaemon } from '../OPEN_SETTING_WINDOW/connect-to-daemon'
import { getLastUsedAndAvailableBrowser } from '../DOWNLOAD_DEPENDENCIES/utils/browser-history'
import { checkCookieListFormat } from '../../../common/utils/cookie'
import { AUTO_CHAT_ERROR_EXIT_CODE } from '../../../common/enums/auto-start-chat'
import { createTaskProgress } from '../../features/task-progress'
import {
  JOB_STATUS_POLL_LAST_RUN_FILE,
  parseJobDetailStatus,
  jobHireStatusLabel
} from '../../features/job-hire-status'
import initPublicIpc from '../../utils/initPublicIpc'

const PAGE_TIMEOUT_MS = 30 * 1000

const taskProgress = createTaskProgress()

interface PollTarget {
  encryptJobId: string
  jobName: string | null
  companyName: string | null
}

async function loadTargets(ds): Promise<PollTarget[]> {
  // favourited jobs not yet known to be closed or deleted, least recently checked first
  return ds.query(
    `SELECT DISTINCT f.encryptJobId, j.jobName, c.name AS companyName
     FROM favorite_job f
       LEFT JOIN job_info j ON j.encryptJobId = f.encryptJobId
       LEFT JOIN company_info c ON c.encryptCompanyId = j.encryptCompanyId
       LEFT JOIN job_hire_status_record h ON h.encryptJobId = f.encryptJobId
     WHERE h.hireStatus IS NULL OR h.hireStatus = ?
     ORDER BY h.lastSeenDate IS NOT NULL, h.lastSeenDate ASC`,
    [JobHireStatus.HIRING]
  )
}

async function openWithLogin(browser: Browser): Promise<Page> {
  const page = (await browser.pages())[0] ?? (await browser.newPage())
  for (const cookie of readStorageFile('boss-cookies.json') ?? []) {
    if (Object.hasOwn(cookie, 'sameSite')) cookie.sameSite = 'unspecified'
    await page.setCookie(cookie)
  }
  await setDomainLocalStorage(
    browser,
    'https://www.zhipin.com/desktop/',
    readStorageFile('boss-local-storage.json')
  )
  return page
}

/** status of one job, or null when the page couldn't tell */
async function checkJob(page: Page, encryptJobId: string): Promise<JobHireStatus | null> {
  try {
    await page.goto(`https://www.zhipin.com/job_detail/${encryptJobId}.html`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT_MS
    })
  } catch (error) {
    if ((error as Error)?.message?.includes('ERR_INTERNET_DISCONNECTED'))
      throw new Error('ERR_INTERNET_DISCONNECTED')
    return null
  }
  const url = page.url()
  if (url.startsWith('https://www.zhipin.com/web/user/')) throw new Error('LOGIN_STATUS_INVALID')
  if (
    url.startsWith('https://www.zhipin.com/web/common/403.html') ||
    url.startsWith('https://www.zhipin.com/web/common/error.html')
  )
    throw new Error('ACCESS_IS_DENIED')
  await page
    .waitForFunction(
      () =>
        !!document.querySelector('#main .job-banner') ||
        !!document.documentElement.innerText?.includes('您访问的页面不存在'),
      { timeout: 15 * 1000 }
    )
    .catch(() => void 0)
  return parseJobDetailStatus(await page.content())
}

async function runPoll() {
  const ds = await initDb(getPublicDbFilePath())
  const targets = await loadTargets(ds)
  const { jobDetailViewWaitSeconds } = readRunSettings(readConfigFile('boss.json'))
  const summary = {
    startedAt: Date.now(),
    total: targets.length,
    checked: 0,
    changed: 0,
    unknown: 0,
    closed: 0
  }
  if (!targets.length) {
    taskProgress.update(undefined, '收藏夹中没有需要检查的职位', 'stopped')
    return summary
  }
  taskProgress.update(undefined, `准备检查 ${targets.length} 个收藏的职位`)

  const { initPuppeteer } = await import('@geekgeekrun/geek-auto-start-chat-with-boss/index.mjs')
  const { puppeteer } = await initPuppeteer()
  const browser: Browser = await puppeteer.launch({
    headless: false,
    ignoreHTTPSErrors: true,
    defaultViewport: { width: 1440, height: 800 }
  })
  try {
    const page = await openWithLogin(browser)
    const previous = new Map<string, number>(
      (
        await ds.query(
          `SELECT encryptJobId, hireStatus FROM job_hire_status_record WHERE encryptJobId IN (${targets.map(() => '?').join(',')})`,
          targets.map((it) => it.encryptJobId)
        )
      ).map((it) => [it.encryptJobId, it.hireStatus])
    )
    for (const [index, target] of targets.entries()) {
      const name =
        (target.companyName && target.jobName
          ? `${target.companyName}「${target.jobName}」`
          : target.companyName || target.jobName) || target.encryptJobId
      const status = await checkJob(page, target.encryptJobId)
      summary.checked++
      if (status === null) {
        summary.unknown++
        taskProgress.update('skipped', `无法确认状态：${name}`)
      } else {
        await saveJobHireStatusRecord(ds, {
          encryptJobId: target.encryptJobId,
          hireStatus: status,
          lastSeenDate: new Date()
        })
        if (previous.get(target.encryptJobId) !== status) summary.changed++
        if (status !== JobHireStatus.HIRING) summary.closed++
        taskProgress.update(
          'viewed',
          `已检查 ${index + 1}/${targets.length}：${name}（${jobHireStatusLabel[status]}）`
        )
      }
      // same pace as reading job details in auto-greeting
      if (index < targets.length - 1) await sleepWithRandomDelay(jobDetailViewWaitSeconds * 1000)
    }
  } finally {
    await browser.close().catch(() => void 0)
  }
  return summary
}

export async function runEntry() {
  app.dock?.hide()
  await app.whenReady()
  // listening is enough to keep a windowless worker from quitting
  app.on('window-all-closed', () => void 0)
  initPublicIpc()
  await connectToDaemon()
  await sendToDaemon({ type: 'ping' }, { needCallback: true })

  const exitWith = async (code: number, detail: string) => {
    taskProgress.update(undefined, detail, code === 0 ? 'stopped' : 'error')
    await sleep(300)
    process.exit(code)
  }

  const browserInfo = await getLastUsedAndAvailableBrowser()
  if (!browserInfo) {
    return exitWith(
      AUTO_CHAT_ERROR_EXIT_CODE.PUPPETEER_IS_NOT_EXECUTABLE,
      '未找到可用的浏览器，请先在设置中配置浏览器'
    )
  }
  process.env.PUPPETEER_EXECUTABLE_PATH = browserInfo.executablePath
  // a scheduled background task: never prompt for login, just report it
  if (!checkCookieListFormat(readStorageFile('boss-cookies.json'))) {
    return exitWith(
      AUTO_CHAT_ERROR_EXIT_CODE.LOGIN_STATUS_INVALID,
      '登录凭证无效，请先登录BOSS直聘后再检查'
    )
  }
  try {
    const summary = await runPoll()
    await writeStorageFile(JOB_STATUS_POLL_LAST_RUN_FILE, { ...summary, finishedAt: Date.now() })
    return exitWith(
      AUTO_CHAT_ERROR_EXIT_CODE.NORMAL,
      summary.total
        ? `检查完成：${summary.checked} 个职位，${summary.closed} 个已关闭或删除，${summary.changed} 个状态有变化` +
            (summary.unknown ? `，${summary.unknown} 个暂时无法确认` : '')
        : '收藏夹中没有需要检查的职位'
    )
  } catch (error) {
    const message = (error as Error)?.message ?? ''
    if (message.includes('LOGIN_STATUS_INVALID'))
      return exitWith(
        AUTO_CHAT_ERROR_EXIT_CODE.LOGIN_STATUS_INVALID,
        '登录状态已失效，请重新登录BOSS直聘'
      )
    if (message.includes('ACCESS_IS_DENIED'))
      return exitWith(
        AUTO_CHAT_ERROR_EXIT_CODE.ACCESS_IS_DENIED,
        '平台拒绝访问或需要人工验证，已停止检查'
      )
    if (message.includes('ERR_INTERNET_DISCONNECTED'))
      return exitWith(AUTO_CHAT_ERROR_EXIT_CODE.ERR_INTERNET_DISCONNECTED, '网络已断开，已停止检查')
    console.error(error)
    // a finite task: report and stop rather than being restarted over and over
    return exitWith(1, '检查遇到异常：' + message.slice(0, 200))
  }
}
