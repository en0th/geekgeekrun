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
import { sleep } from '@geekgeekrun/utils/sleep.mjs'
import { installWorkerShutdown } from '@geekgeekrun/utils/worker-shutdown.mjs'
import {
  AUTO_CHAT_ERROR_EXIT_CODE
} from './enums.mjs'

import SqlitePluginModule from '@geekgeekrun/sqlite-plugin'
const {
  default: SqlitePlugin
} = SqlitePluginModule

const rerunInterval = (() => {
  let v = Number(process.env.MAIN_BOSSGEEKGO_RERUN_INTERVAL)
  if (isNaN(v)) {
    v = 5000
  }

  return v
})()

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
  const { mainLoop, closeBrowserWindow } = await import('@geekgeekrun/geek-auto-start-chat-with-boss/index.mjs')
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
  while (true) {
    try {
      await mainLoop(hooks)
    } catch (err) {
      if (shutdown.isStopping()) return
      if (err instanceof Error) {
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
      closeBrowserWindow?.()
      console.error(err)
      console.log(`[Run core main] An internal error is caught, and browser will be restarted in ${rerunInterval}ms.`)
      await sleep(rerunInterval)
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
