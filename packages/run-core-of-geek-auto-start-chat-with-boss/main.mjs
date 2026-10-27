import DingtalkPlugin from '@geekgeekrun/dingtalk-plugin/index.mjs'
import { isJsonStorageError } from '@geekgeekrun/utils/atomic-json.mjs'
import {
  SyncHook,
  AsyncSeriesHook
} from 'tapable'
import fs from 'node:fs'
import path from 'node:path'
import { get__dirname } from '@geekgeekrun/utils/legacy-path.mjs';
import JSON5 from 'json5'
import { readRunSettings } from '@geekgeekrun/geek-auto-start-chat-with-boss/run-settings.mjs'
import { jobComparisonScope } from '@geekgeekrun/geek-auto-start-chat-with-boss/job-comparison-scope.mjs'
import { normalizeJobSources } from '@geekgeekrun/geek-auto-start-chat-with-boss/search-source.mjs'
import { createAutomaticRetry } from '@geekgeekrun/geek-auto-start-chat-with-boss/automatic-retry.mjs'
import { installWorkerShutdown } from '@geekgeekrun/utils/worker-shutdown.mjs'
import {
  AUTO_CHAT_ERROR_EXIT_CODE
} from './enums.mjs'

import SqlitePluginModule from '@geekgeekrun/sqlite-plugin'
const {
  default: SqlitePlugin
} = SqlitePluginModule

const initPlugins = (hooks, { readConfigFile, getPublicDbFilePath }) => {
  const { groupRobotAccessToken: dingTalkAccessToken } = readConfigFile('dingtalk.json')
  if (!process.env.GEEKGEEKRUN_COLLECT_AUDIT_DIR) new DingtalkPlugin(dingTalkAccessToken).apply(hooks)
  const settings = readRunSettings(readConfigFile('boss.json'))
  new SqlitePlugin(getPublicDbFilePath(), {
    collectOnlyMatched: settings.runMode === 'collect' && settings.collectOnlyMatchingJobs,
    captureNetworkDetails: !normalizeJobSources(readConfigFile('boss.json').jobSourceList).some(source => source.type === 'company'),
    comparisonScope: jobComparisonScope(Object.fromEntries(
      ['boss.json', 'common-job-condition-config.json', 'target-company-list.json'].map(name => [name, readConfigFile(name)])))
  }).apply(hooks)
}

const main = async () => {
  const { readConfigFile, readStorageFile, getPublicDbFilePath } = await import('@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs')
  const bossCookies = readStorageFile('boss-cookies.json')
  const { mainLoop, closeBrowserWindow, prepareForAutomaticRetry, autoStartChatEventBus } = await import('@geekgeekrun/geek-auto-start-chat-with-boss/index.mjs')
  const shutdown = installWorkerShutdown({ close: closeBrowserWindow })
  if (!bossCookies?.length) {
    console.error('There is no cookies. You can save a copy with EditThisCookie extension.')
    process.exit(AUTO_CHAT_ERROR_EXIT_CODE.COOKIE_INVALID)
  }
  const hooks = {
    daemonInitialized: new AsyncSeriesHook(),
    puppeteerLaunched: new SyncHook(['browser']),
    pageGotten: new SyncHook(['page']),
    pageLoaded: new SyncHook(),
    cookieWillSet: new AsyncSeriesHook(['cookies']),
    userInfoResponse: new AsyncSeriesHook(['userInfo']),
    mainFlowWillLaunch: new AsyncSeriesHook(['args']),
    jobDetailIsGetFromRecommendList: new AsyncSeriesHook(['positionInfoDetail']),
    jobMatchedForCollection: new AsyncSeriesHook(['detail']),
    newChatWillStartup: new AsyncSeriesHook(['positionInfoDetail']),
    newChatStartup: new AsyncSeriesHook(['positionInfoDetail', 'chatRunningContext']),
    jobMarkedAsNotSuit: new AsyncSeriesHook(['positionInfoDetail', 'markDetail']),
    noPositionFoundForCurrentJob: new SyncHook(),
    noPositionFoundAfterTraverseAllJob: new SyncHook(),
    errorEncounter: new SyncHook(['errorInfo']),
    encounterEmptyRecommendJobList: new AsyncSeriesHook(['args']),
    sageTimeEnter: new AsyncSeriesHook(['args']),
    sageTimeExit: new AsyncSeriesHook(['args'])
  }
  initPlugins(hooks, { readConfigFile, getPublicDbFilePath })
  await hooks.daemonInitialized.promise()
  let sendPending = false, progress = 0
  autoStartChatEventBus.on('CHAT_CONFIRMATION', pending => { sendPending = pending })
  autoStartChatEventBus.on('TASK_PROGRESS', event => { if (['viewed', 'sent', 'collected'].includes(event.kind)) progress++ })
  const automaticRetry = createAutomaticRetry({ prepare: prepareForAutomaticRetry,
    sendPending: () => sendPending, isStopping: () => shutdown.isStopping(), progressKey: () => progress,
    publish: ({ attempt, until, delayMs, reason }) => {
      const detail = until ? `${reason}，${delayMs / 1000}秒后自动重试（第${attempt}次）；已有结果保留。` : reason
      console.log(detail)
      autoStartChatEventBus.emit('TASK_PROGRESS', { detail, state: 'retrying' })
    },
  })
  while (true) {
    if (shutdown.isStopping()) return
    try {
      await mainLoop(hooks)
    } catch (err) {
      if (shutdown.isStopping()) return
      try {
        if (await automaticRetry.recover(err)) continue
        if (shutdown.isStopping()) return
      } catch (retryError) { if (shutdown.isStopping()) return; err = retryError }
      if (sendPending && !/AUTO_CHAT_DAILY_/.test(err?.message || ''))
        err = Object.assign(new Error('AUTO_CHAT_MESSAGE_SEND_UNCONFIRMED'), { detail: '发送结果尚未确认，请先核对；不会自动重发。' })
      if (err instanceof Error) {
        if (/AUTO_CHAT_DAILY_|STARTUP_CHAT_ERROR_DUE_TO_TODAY_CHANCE_HAS_USED_OUT/.test(err.message)) {
          console.error(err.detail || err.message)
          await closeBrowserWindow?.()
          process.exit(/PLATFORM_LIMIT|TODAY_CHANCE/.test(err.message) ? 103 : /GOAL_REACHED/.test(err.message) ? 102 : /UNCONFIRMED/.test(err.message) ? 87 : 104)
          return
        }
        if (err.message === 'AUTO_CHAT_SECURITY_CHECK') {
          console.error('BOSS需要人工安全验证，任务已暂停；请完成验证并更新登录状态后重新运行')
          await closeBrowserWindow?.()
          process.exit(AUTO_CHAT_ERROR_EXIT_CODE.LOGIN_STATUS_UNCONFIRMED)
          return
        }
        if (/AUTO_CHAT_(NO_MATCH_BATCH_LIMIT|LIST_STALLED|DETAIL_NOT_READY|NO_USABLE_SOURCE|COLLECT_MODE_CHAT_BLOCKED|UNMATCHED_JOB_CHAT_BLOCKED|REQUIRED_CONDITION_CHAT_BLOCKED)/.test(err.message)) {
          console.error(err.detail || '岗位页面、来源或发送条件未能确认，任务已停止；请检查页面与条件后重新运行')
          await closeBrowserWindow?.()
          process.exit(err.message.includes('NO_MATCH_BATCH_LIMIT') ? AUTO_CHAT_ERROR_EXIT_CODE.NO_MATCHING_JOBS : AUTO_CHAT_ERROR_EXIT_CODE.JOB_PAGE_NOT_READY)
          return
        }
        if (['AUTO_CHAT_BROWSER_UNAVAILABLE', 'AUTO_CHAT_MESSAGE_SEND_UNCONFIRMED'].includes(err.message)) {
          console.error(err.detail || '浏览器或连接异常，任务已暂停')
          await closeBrowserWindow?.()
          process.exit(err.message.includes('SEND_UNCONFIRMED') ? AUTO_CHAT_ERROR_EXIT_CODE.MESSAGE_SEND_UNCONFIRMED : AUTO_CHAT_ERROR_EXIT_CODE.BROWSER_UNAVAILABLE)
          return
        }
        if (err.message.includes('AUTO_CHAT_PAGE_FILTER_NOT_APPLIED')) {
          console.error(err.detail || err.message)
          await closeBrowserWindow?.()
          process.exit(AUTO_CHAT_ERROR_EXIT_CODE.PAGE_FILTER_NOT_APPLIED)
          return
        }
        if (err.message.includes('AUTO_CHAT_BACKGROUND_WINDOW_UNAVAILABLE')) {
          console.error(err.detail || err.message)
          await closeBrowserWindow?.()
          process.exit(AUTO_CHAT_ERROR_EXIT_CODE.BACKGROUND_WINDOW_UNAVAILABLE)
          return
        }
        if (isJsonStorageError(err)) {
          console.error(err.message)
          await closeBrowserWindow?.()
          process.exit(AUTO_CHAT_ERROR_EXIT_CODE.JSON_STORAGE_UNAVAILABLE)
          return
        }
        if (/AUTO_CHAT_RUN_BUDGET_(EXCEEDED|UNAVAILABLE)/.test(err.message)) {
          console.error(err.detail || err.message)
          await closeBrowserWindow?.()
          process.exit(err.message.includes('EXCEEDED') ? AUTO_CHAT_ERROR_EXIT_CODE.RUN_BUDGET_EXCEEDED : AUTO_CHAT_ERROR_EXIT_CODE.RUN_BUDGET_UNAVAILABLE)
          return
        }
        if (err.message.includes('AUTO_CHAT_ALL_SOURCES_ROTATED')) {
          console.log('所有职位来源已轮换完成，任务结束')
          await closeBrowserWindow?.()
          process.exit(AUTO_CHAT_ERROR_EXIT_CODE.ALL_SOURCES_ROTATED)
          return
        }
        if (err.message.includes('AUTO_CHAT_CITY_FILTER_NOT_APPLIED')) {
          console.error(err.detail || err.message)
          await closeBrowserWindow?.()
          process.exit(AUTO_CHAT_ERROR_EXIT_CODE.CITY_FILTER_NOT_APPLIED)
          return
        }
        if (/LOGIN_STATUS_(RESTRICTED|UNKNOWN)|AUTO_CHAT_ACCOUNT_CHANGED|AUTO_CHAT_(?:SEARCH_FILTER_NOT_APPLIED|COMPANY_SOURCE_NOT_CONFIRMED)|AUTO_CHAT_JOB_PAGE_CLOSED/.test(err.message)) {
          console.error(err.detail || err.message)
          await closeBrowserWindow?.()
          process.exit(err.message.includes('ACCOUNT_CHANGED') ? AUTO_CHAT_ERROR_EXIT_CODE.ACCOUNT_CHANGED : AUTO_CHAT_ERROR_EXIT_CODE.LOGIN_STATUS_UNCONFIRMED)
          return
        }
        if (err.message.includes('LOGIN_STATUS_INVALID')) {
          process.exit(AUTO_CHAT_ERROR_EXIT_CODE.LOGIN_STATUS_INVALID)
          break
        }
        if (err.message.includes('ERR_INTERNET_DISCONNECTED')) {
          process.exit(AUTO_CHAT_ERROR_EXIT_CODE.ERR_INTERNET_DISCONNECTED)
          break
        }
        if (err.message.includes('ACCESS_IS_DENIED')) {
          process.exit(AUTO_CHAT_ERROR_EXIT_CODE.ACCESS_IS_DENIED)
          break
        }
      }
      console.error(err)
      await automaticRetry.recover(new Error('AUTO_CHAT_RETRY_UNEXPECTED'))
    }
  }
}

(async () => {
  try {
    await main()
  } catch(err) {
    console.error(err)
    if (isJsonStorageError(err)) process.exit(AUTO_CHAT_ERROR_EXIT_CODE.JSON_STORAGE_UNAVAILABLE)
  }
})()
