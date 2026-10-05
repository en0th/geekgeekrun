import { app } from 'electron'
import { initPuppeteer } from '@geekgeekrun/geek-auto-start-chat-with-boss/index.mjs'
import {
  readStorageFile,
  writeStorageFile
} from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import {
  RECOMMEND_JOB_ENTRY_SELECTOR,
  USER_SET_EXPECT_JOB_ENTRIES_SELECTOR
} from '@geekgeekrun/geek-auto-start-chat-with-boss/constant.mjs'
import { setDomainLocalStorage } from '@geekgeekrun/utils/puppeteer/local-storage.mjs'
import {
  saveJobInfoFromRecommendPage,
  saveChatStartupRecord,
  saveMarkAsNotSuitRecord,
  saveChatMessageRecord,
  saveJobHireStatusRecord
} from '@geekgeekrun/sqlite-plugin/dist/handlers'
import { initDb } from '@geekgeekrun/sqlite-plugin'
import { getPublicDbFilePath } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import {
  MarkAsNotSuitReason,
  JobSource,
  JobHireStatus
} from '@geekgeekrun/sqlite-plugin/dist/enums'
import cheerio from 'cheerio'

import fs from 'node:fs'
import type { Browser, ElementHandle, HTTPResponse, Page, Target } from 'puppeteer'
import { pipeWriteRegardlessError } from '../utils/pipe'
import * as JSONStream from 'JSONStream'
import { ChatStartupFrom } from '@geekgeekrun/sqlite-plugin/dist/entity/ChatStartupLog'
import attachListenerForKillSelfOnParentExited from '../../utils/attachListenerForKillSelfOnParentExited'
import { type ChatMessageRecord } from '@geekgeekrun/sqlite-plugin/src/entity/ChatMessageRecord'
import { BossInfo } from '@geekgeekrun/sqlite-plugin/dist/entity/BossInfo'
import { messageForSaveFilter } from '../../../common/utils/chat-list'

import {
  ensureEditThisCookie,
  editThisCookieExtensionPath
} from '@geekgeekrun/launch-bosszhipin-login-page-with-preload-extension/utils.mjs'

const dbInitPromise = initDb(getPublicDbFilePath())

const JOB_DETAIL_URL_RE = /^https:\/\/www\.zhipin\.com\/job_detail\/([^/?#]+)\.html/
const isAddFriendResponse = (url: string, encryptJobId: string) =>
  url.startsWith('https://www.zhipin.com/wapi/zpgeek/friend/add.json') &&
  new URL(url).searchParams.get('jobId') === encryptJobId

// the job detail page has no logged-in user data to read; reuse the account of earlier records
async function currentUserIdFromDb() {
  const ds = await dbInitPromise
  const [log] = await ds.query(
    'SELECT encryptCurrentUserId AS id FROM chat_startup_log ORDER BY id DESC LIMIT 1'
  )
  if (log?.id) return log.id as string
  const [user] = await ds.query('SELECT encryptUserId AS id FROM user_info LIMIT 1')
  return (user?.id as string) ?? ''
}

/**
 * friend/add.json answered: did BOSS start the chat? The page may jump to the chat page before
 * the body can be read, which also means the chat was started.
 */
async function readAddFriendResult(page: Page, response: HTTPResponse) {
  try {
    const body = await response.json()
    return { ok: body?.code === 0, body }
  } catch {
    await new Promise((r) => setTimeout(r, 2000))
    return { ok: page.url().startsWith('https://www.zhipin.com/web/geek/chat'), body: null }
  }
}

const attachRequestsListener = async (target: Target) => {
  const page = await target.page()
  if (!page) {
    return
  }

  // FIXME: might not work
  async function handleJobDetailPage({ encryptJobId } = { encryptJobId: null }) {
    if (!encryptJobId) {
      return
    }
    try {
      await page.waitForFunction(
        ({ encryptJobId }) => {
          return (
            location.href.startsWith(`https://www.zhipin.com/job_detail/${encryptJobId}`) &&
            (!!document.querySelector('#main .job-banner') ||
              !!document.documentElement.innerText?.includes(`您访问的页面不存在`))
          )
        },
        undefined,
        { encryptJobId }
      )
      const htmlContent = await page.content()
      if (htmlContent) {
        const $ = cheerio.load(htmlContent)
        const [jobBannerEl] = $('#main .job-banner') ?? []
        if (!jobBannerEl) {
          console.log(`access might be blocked`)
          if (
            htmlContent.includes(`您访问的页面不存在`) ||
            location.href === `https://www.zhipin.com/`
          ) {
            await saveJobHireStatusRecord(await dbInitPromise, {
              encryptJobId,
              hireStatus: JobHireStatus.DELETED,
              lastSeenDate: new Date()
            })
          }
        } else {
          const [jobStatusTextEl] = $('#main .job-banner .job-status') ?? []
          if (jobStatusTextEl) {
            const jobStatusText = $(jobStatusTextEl).text()?.trim() ?? ''
            if ([`职位已关闭`].includes(jobStatusText)) {
              await saveJobHireStatusRecord(await dbInitPromise, {
                encryptJobId,
                hireStatus: JobHireStatus.CLOSED,
                lastSeenDate: new Date()
              })
            } else {
              await saveJobHireStatusRecord(await dbInitPromise, {
                encryptJobId,
                hireStatus: JobHireStatus.HIRING,
                lastSeenDate: new Date()
              })
            }
          }
        }
      }
    } catch {
      //
    }
  }

  if (page.url().match(/^https:\/\/www.zhipin.com\/job_detail\/(.+)\.html/)) {
    const encryptJobId = page.url().match(/^https:\/\/www.zhipin.com\/job_detail\/(.+)\.html/)?.[1]
    if (encryptJobId) {
      handleJobDetailPage({ encryptJobId })
    }
  }

  async function getCurrentJobSource() {
    const methodMap = {
      async recommend() {
        return await page.evaluate(
          ({ RECOMMEND_JOB_ENTRY_SELECTOR }) => {
            return document.querySelector(RECOMMEND_JOB_ENTRY_SELECTOR).classList.contains('active')
          },
          {
            RECOMMEND_JOB_ENTRY_SELECTOR
          }
        )
      },
      async expect() {
        return await page.evaluate(
          ({ USER_SET_EXPECT_JOB_ENTRIES_SELECTOR }) => {
            return [...document.querySelectorAll(USER_SET_EXPECT_JOB_ENTRIES_SELECTOR)].some((el) =>
              el.classList.contains('active')
            )
          },
          {
            USER_SET_EXPECT_JOB_ENTRIES_SELECTOR
          }
        )
      },
      async search() {
        const elHandle = await page.$(`.page-jobs-main`)
        const currentKeyWord = await elHandle?.evaluate((el) => {
          return el?.__vue__?.formData?.query
        })
        return !!currentKeyWord
      }
    }
    for (const [type, func] of Object.entries(methodMap)) {
      try {
        if (await func()) {
          return type
        }
      } catch (err) {
        console.error('encounter error when get job source')
      }
    }
    return null
  }

  page.on('response', async (response) => {
    const detailJobId = page.url().match(JOB_DETAIL_URL_RE)?.[1]
    if (detailJobId && isAddFriendResponse(response.url(), detailJobId)) {
      // 立即沟通 on a job detail page: clicked by the user, or by 资料库 → 打招呼
      const { ok } = await readAddFriendResult(page, response)
      if (ok) {
        await saveChatStartupRecord(
          await dbInitPromise,
          { jobInfo: { encryptId: detailJobId } },
          { encryptUserId: await currentUserIdFromDb() },
          { chatStartupFrom: ChatStartupFrom.ManuallyFromRecommendList }
        )
      }
      return
    }
    if (response.url().match(/^https:\/\/www.zhipin.com\/job_detail\/(.+)\.html/)) {
      const encryptJobId = response
        .url()
        .match(/^https:\/\/www.zhipin.com\/job_detail\/(.+)\.html/)?.[1]
      if (encryptJobId) {
        handleJobDetailPage({ encryptJobId })
      }
    } else if (response.url().startsWith('https://www.zhipin.com/wapi/zpgeek/job/detail.json')) {
      const data = await response.json()

      console.log(data)
      if (data.code === 0) {
        await saveJobInfoFromRecommendPage(await dbInitPromise, data.zpData)
        await saveJobHireStatusRecord(await dbInitPromise, {
          encryptJobId: data.zpData.jobInfo.encryptId,
          hireStatus: JobHireStatus.HIRING,
          lastSeenDate: new Date()
        })
      }
    } else if (
      response.url().startsWith('https://www.zhipin.com/wapi/zpgeek/negativefeedback/reasons.json')
    ) {
      const rawReasonResData = (await response.json())?.zpData?.result ?? []
      const reasonCodeToTextMap = await readStorageFile(
        'job-not-suit-reason-code-to-text-cache.json'
      )
      for (const it of rawReasonResData) {
        reasonCodeToTextMap[it.code] = it.text?.content ?? ''
      }
      await writeStorageFile('job-not-suit-reason-code-to-text-cache.json', reasonCodeToTextMap)
    } else if (
      page.url().startsWith('https://www.zhipin.com/web/geek/jobs') &&
      response.url().startsWith('https://www.zhipin.com/wapi/zpgeek/negativefeedback/save.json')
    ) {
      const currentJobData = await page.evaluate(
        'document.querySelector(".job-detail-box").__vue__.data'
      )
      const requestBody = new URLSearchParams(response.request().postData())

      const securityIdInRequest = requestBody.get('securityId')
      const currentJobSecurityId = currentJobData?.securityId

      if (securityIdInRequest !== currentJobSecurityId) {
        return
      }

      const chosenCode = Number(requestBody.get('code'))
      const currentUserInfo = await page.evaluate(
        'document.querySelector(".job-detail-box").__vue__.$store.state.userInfo'
      )
      const reasonCodeToTextMap = await readStorageFile(
        'job-not-suit-reason-code-to-text-cache.json'
      )
      const jobSource = await getCurrentJobSource()
      const markDetail = {
        markFrom: ChatStartupFrom.ManuallyFromRecommendList,
        extInfo: {
          chosenReasonInUi: {
            code: chosenCode,
            text: reasonCodeToTextMap[chosenCode]
          }
        },
        markReason: MarkAsNotSuitReason.USER_MANUAL_OPERATION_WITH_UNKNOWN_REASON,
        jobSource: JobSource[jobSource]
      }
      if (reasonCodeToTextMap[chosenCode]?.includes('活跃度低')) {
        markDetail.markReason = MarkAsNotSuitReason.BOSS_INACTIVE
        markDetail.extInfo.bossActiveTimeDesc = currentJobData?.bossInfo.activeTimeDesc
      }
      await saveMarkAsNotSuitRecord(
        await dbInitPromise,
        currentJobData,
        {
          encryptUserId: currentUserInfo.encryptUserId
        },
        markDetail
      )
    } else if (
      page.url().startsWith('https://www.zhipin.com/web/geek/jobs') &&
      response.url().startsWith('https://www.zhipin.com/wapi/zpgeek/friend/add.json')
    ) {
      const request = response.request().url()

      const url = new URL(request)
      const jobIdInAddFriendUrl = url.searchParams.get('jobId')

      // access current page, predict if jobId of current page is equal to jobId in request
      // in case of page changed after startup chat
      const currentJobData = await page.evaluate(
        'document.querySelector(".job-detail-box").__vue__.data'
      )
      const currentJobId = currentJobData?.jobInfo?.encryptId
      if (jobIdInAddFriendUrl !== currentJobId) {
        return
      }

      const currentUserInfo = await page.evaluate(
        'document.querySelector(".job-detail-box").__vue__.$store.state.userInfo'
      )
      const jobSource = await getCurrentJobSource()
      await saveChatStartupRecord(
        await dbInitPromise,
        currentJobData,
        {
          encryptUserId: currentUserInfo.encryptUserId
        },
        {
          chatStartupFrom: ChatStartupFrom.ManuallyFromRecommendList,
          jobSource: JobSource[jobSource]
        }
      )
    } else if (
      page.url().startsWith('https://www.zhipin.com/web/geek/chat') &&
      response.url().startsWith('https://www.zhipin.com/wapi/zpchat/geek/historyMsg')
    ) {
      const currentUserInfo = await page.evaluate(
        'document.querySelector(".main-wrap").__vue__.$store.state.userInfo'
      )
      const request = response.request().url()

      const url = new URL(request)
      const encryptBossIdInAddFriendUrl = url.searchParams.get('bossId')

      const bossInfo =
        (await page.evaluate(
          'document.querySelector(".chat-conversation .chat-record")?.__vue__?.boss'
        )) ?? null
      if (!bossInfo) {
        console.warn('cannot find boss info on page.')
        return
      }
      const ds = await dbInitPromise
      // save boss info
      const bossInfoRepository = ds.getRepository(BossInfo)
      let targetBossInfo = await bossInfoRepository.findOneBy({
        encryptBossId: bossInfo.encryptBossId
      })
      if (!targetBossInfo) {
        targetBossInfo = new BossInfo()
        Object.assign(targetBossInfo, {
          encryptBossId: bossInfo.encryptBossId,
          name: bossInfo.name,
          title: bossInfo.title,
          date: new Date()
        })
        await bossInfoRepository.save(targetBossInfo)
      }
      if (encryptBossIdInAddFriendUrl !== bossInfo.encryptBossId) {
        return
      }
      const rawChatRecordList =
        (
          await page.evaluate(
            'document.querySelector(".message-content .chat-record").__vue__.list$'
          )
        )?.filter(messageForSaveFilter) ?? []

      const chatRecordList = rawChatRecordList.map((it) => {
        const mappedItem = {} as InstanceType<typeof ChatMessageRecord>
        mappedItem.mid = it.mid
        mappedItem.encryptFromUserId = it.isSelf
          ? currentUserInfo.encryptUserId
          : bossInfo.encryptBossId
        mappedItem.encryptToUserId = it.isSelf
          ? bossInfo.encryptBossId
          : currentUserInfo.encryptUserId
        mappedItem.style = it.isSelf ? 'sent' : 'received'
        mappedItem.type = it.type
        mappedItem.time = it.time ? new Date(it.time) : null
        mappedItem.text = it.text
        if (it.type === 'image') {
          mappedItem.imageUrl = it.image?.originImage?.url
          mappedItem.imageHeight = it.image?.originImage?.url?.height
          mappedItem.imageWidth = it.image?.originImage?.url?.width
        }

        return mappedItem
      })
      await saveChatMessageRecord(ds, chatRecordList)
    }
  })

  await page.waitForResponse((response) => {
    if (response.url().startsWith('https://www.zhipin.com/wapi/zpgeek/job/detail.json')) {
      return true
    }
    return false
  })
}

export type GreetJobStatus =
  | 'sent'
  | 'already'
  | 'confirm-in-browser'
  | 'closed'
  | 'missing'
  | 'login'
  | 'failed'

// 资料库 → 打招呼: open the job detail page and press 立即沟通 once; the page stays open so the
// user sees what BOSS answered
async function greetJob(
  browser: Browser,
  encryptJobId: string
): Promise<{ status: GreetJobStatus; message?: string }> {
  const page = await browser.newPage()
  try {
    await page.goto(`https://www.zhipin.com/job_detail/${encryptJobId}.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 30 * 1000
    })
  } catch {
    // slow pages still render the button; the wait below decides
  }
  const stateHandle = await page
    .waitForFunction(
      () => {
        if (/\/web\/user|login/.test(location.pathname)) return 'login'
        const button = [...document.querySelectorAll<HTMLElement>('a, button, span, div')].find(
          (el) =>
            el.offsetParent !== null &&
            ['立即沟通', '继续沟通'].includes(el.innerText?.trim()) &&
            ![...el.children].some((c) => (c as HTMLElement).innerText?.trim())
        )
        if (button) return button.innerText.trim() === '立即沟通' ? 'start' : 'continue'
        const text = document.body?.innerText ?? ''
        if (text.includes('您访问的页面不存在')) return 'missing'
        if (text.includes('职位已关闭')) return 'closed'
        return false
      },
      { timeout: 25 * 1000, polling: 300 }
    )
    .catch(() => null)
  const state = (await stateHandle?.jsonValue()) as string | null
  if (!state)
    return { status: 'failed', message: '页面中没有找到“立即沟通”按钮，可能需要先完成安全验证' }
  if (state === 'login') return { status: 'login' }
  if (state === 'missing') return { status: 'missing' }
  if (state === 'closed') return { status: 'closed' }
  if (state === 'continue') return { status: 'already' }

  const responsePromise = page.waitForResponse(
    (response) => isAddFriendResponse(response.url(), encryptJobId),
    { timeout: 20 * 1000 }
  )
  const button = await page.evaluateHandle(() =>
    [...document.querySelectorAll<HTMLElement>('a, button, span, div')].find(
      (el) =>
        el.offsetParent !== null &&
        el.innerText?.trim() === '立即沟通' &&
        ![...el.children].some((c) => (c as HTMLElement).innerText?.trim())
    )
  )
  const element = button.asElement() as ElementHandle<Element> | null
  if (!element) return { status: 'failed', message: '“立即沟通”按钮已消失，请在打开的页面中查看' }
  await element.click()
  let response: HTTPResponse
  try {
    response = await responsePromise
  } catch {
    return { status: 'failed', message: 'BOSS没有响应开聊请求，请在打开的页面中查看' }
  }
  const { ok, body } = await readAddFriendResult(page, response)
  if (ok) return { status: 'sent' }
  // BOSS asks to confirm when few chances are left today; leave that decision to the user
  if (body?.zpData?.bizData?.chatRemindDialog) {
    return {
      status: 'confirm-in-browser',
      message: body.zpData.bizData.chatRemindDialog.content ?? ''
    }
  }
  return { status: 'failed', message: body?.message || body?.zpData?.bizData?.toast || '' }
}

export async function launchBossSite() {
  app.dock?.hide()
  await ensureEditThisCookie()
  const bossCookies = readStorageFile('boss-cookies.json')
  const bossLocalStorage = readStorageFile('boss-local-storage.json')

  const { puppeteer } = await initPuppeteer()
  const browser = await puppeteer.launch({
    headless: false,
    pipe: true,
    enableExtensions: [editThisCookieExtensionPath]
  })
  let [page] = await browser.pages()
  for (let i = 0; i < bossCookies.length; i++) {
    if (Object.hasOwn(bossCookies[i], 'sameSite')) {
      bossCookies[i].sameSite = 'unspecified'
    }
    await page.setCookie(bossCookies[i])
  }

  const localStoragePageUrl = `https://www.zhipin.com/desktop/`
  await setDomainLocalStorage(browser, localStoragePageUrl, bossLocalStorage)

  //#region pipe
  let pipeForWrite: null | fs.WriteStream = null
  let pipeForRead: null | fs.ReadStream = null
  try {
    pipeForWrite = fs.createWriteStream(null, { fd: 3 })
  } catch {
    console.warn('pipeForWrite is not available')
  }
  try {
    pipeForRead = fs.createReadStream(null, { fd: 3 })
  } catch {
    console.warn('pipeForRead is not available')
  }
  pipeForRead?.pipe(JSONStream.parse())?.on('data', async function handler(data) {
    if (data.type === 'GREET_JOB') {
      const result = await greetJob(browser, data.encryptJobId).catch((err) => ({
        status: 'failed' as const,
        message: String(err?.message ?? err)
      }))
      pipeWriteRegardlessError(
        pipeForWrite,
        JSON.stringify({ type: 'GREET_JOB_RESULT', requestId: data.requestId, ...result })
      )
      return
    }
    if (data.type !== 'NEW_WINDOW') {
      return
    }
    const page = await browser.newPage()
    await page.goto(data.url)
  })

  pipeWriteRegardlessError(
    pipeForWrite,
    JSON.stringify({
      type: 'SUB_PROCESS_OF_OPEN_BOSS_SITE_READY'
    })
  )
  //#endregion
  browser.on('targetcreated', (target) => {
    attachRequestsListener(target)
  })
  browser.on('targetdestroyed', async () => {
    const pages = await browser.pages()
    if (pages.length) {
      return
    }
    const cp = browser.process()
    cp.kill()
    pipeWriteRegardlessError(
      pipeForWrite,
      JSON.stringify({
        type: 'SUB_PROCESS_OF_OPEN_BOSS_SITE_CAN_BE_KILLED'
      })
    )
    process.exit(0)
  })

  const tempPage = await browser.newPage()
  await page.close()
  page = tempPage
}

attachListenerForKillSelfOnParentExited()
