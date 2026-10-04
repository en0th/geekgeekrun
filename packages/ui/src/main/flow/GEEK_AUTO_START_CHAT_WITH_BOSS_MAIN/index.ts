import DingtalkPlugin from '@geekgeekrun/dingtalk-plugin/index.mjs'
import { app } from 'electron'
import { SyncHook, AsyncSeriesHook } from 'tapable'
import {
  readConfigFile,
  getPublicDbFilePath
} from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
// import { pipeWriteRegardlessError } from '../utils/pipe'
import { sleep } from '@geekgeekrun/utils/sleep.mjs'
import { readRunSettings } from '@geekgeekrun/geek-auto-start-chat-with-boss/run-settings.mjs'
import { AUTO_CHAT_ERROR_EXIT_CODE } from '../../../common/enums/auto-start-chat'
import attachListenerForKillSelfOnParentExited from '../../utils/attachListenerForKillSelfOnParentExited'
import minimist from 'minimist'
import SqlitePluginModule from '@geekgeekrun/sqlite-plugin'
import gtag from '../../utils/gtag'
import GtagPlugin from '../../utils/gtag/GtagPlugin'
import { connectToDaemon, sendToDaemon } from '../OPEN_SETTING_WINDOW/connect-to-daemon'
// import { PeriodPushCurrentPageScreenshotPlugin } from '../../utils/screenshot'
import { checkShouldExit } from '../../utils/worker'
import { CookieInvalidHandlePlugin } from '../../features/cookie-invalid-handle-plugin'
import initPublicIpc from '../../utils/initPublicIpc'
import { createTaskProgress } from '../../features/task-progress'
import { yieldIfRequested } from '../../features/task-queue'
import { getLastUsedAndAvailableBrowser } from '../DOWNLOAD_DEPENDENCIES/utils/browser-history'
import { configWithBrowserAssistant } from '../../features/config-with-browser-assistant'
const { default: SqlitePlugin } = SqlitePluginModule

process.on('SIGTERM', () => {
  console.log('收到SIGTERM信号，正在退出')
  process.exit(0)
})

const rerunInterval = (() => {
  let v = Number(process.env.MAIN_BOSSGEEKGO_RERUN_INTERVAL)
  if (isNaN(v)) {
    v = 5000
  }

  return v
})()

const { groupRobotAccessToken: dingTalkAccessToken } = readConfigFile('dingtalk.json')

const initPlugins = (hooks) => {
  new DingtalkPlugin(dingTalkAccessToken).apply(hooks)
  new SqlitePlugin(getPublicDbFilePath()).apply(hooks)
  new GtagPlugin().apply(hooks)
  // new PeriodPushCurrentPageScreenshotPlugin().apply(hooks)
  new CookieInvalidHandlePlugin().apply(hooks)
}

const runRecordId = minimist(process.argv.slice(2))['run-record-id'] ?? null
const runAutoChat = async () => {
  app.dock?.hide()
  let puppeteerExecutable = await getLastUsedAndAvailableBrowser()
  if (!puppeteerExecutable) {
    try {
      await configWithBrowserAssistant({ autoFind: true })
    } catch (error) {
      //
    }
    puppeteerExecutable = await getLastUsedAndAvailableBrowser()
  }
  if (!puppeteerExecutable) {
    sendToDaemon({
      type: 'worker-to-gui-message',
      workerId: process.env.GEEKGEEKRUND_WORKER_ID,
      data: {
        type: 'prerequisite-step-by-step-check',
        step: {
          id: 'puppeteer-executable-check',
          status: 'rejected'
        },
        runRecordId
      }
    })
    app.exit(AUTO_CHAT_ERROR_EXIT_CODE.PUPPETEER_IS_NOT_EXECUTABLE)
    return
  }
  sendToDaemon({
    type: 'worker-to-gui-message',
    workerId: process.env.GEEKGEEKRUND_WORKER_ID,
    data: {
      type: 'prerequisite-step-by-step-check',
      step: {
        id: 'puppeteer-executable-check',
        status: 'fulfilled'
      },
      runRecordId
    }
  })
  process.env.PUPPETEER_EXECUTABLE_PATH = puppeteerExecutable.executablePath
  const { initPuppeteer, mainLoop, closeBrowserWindow, autoStartChatEventBus } = await import(
    '@geekgeekrun/geek-auto-start-chat-with-boss/index.mjs'
  )
  const taskProgress = createTaskProgress()
  autoStartChatEventBus.on('TASK_PROGRESS', ({ kind, detail, state, listSummary }) =>
    taskProgress.update(kind, detail, state || 'running', { listSummary })
  )
  taskProgress.update(undefined, '准备查找岗位')
  process.on('disconnect', () => {
    closeBrowserWindow()
    app.exit()
  })
  await initPuppeteer()

  const hooks = {
    puppeteerLaunched: new SyncHook(['browser']),
    pageGotten: new SyncHook(['page']),
    pageLoaded: new SyncHook(),
    cookieWillSet: new AsyncSeriesHook(['cookies']),
    userInfoResponse: new AsyncSeriesHook(['userInfo']),
    mainFlowWillLaunch: new AsyncSeriesHook(['args']),
    jobDetailIsGetFromRecommendList: new AsyncSeriesHook(['userInfo']),
    newChatWillStartup: new AsyncSeriesHook(['positionInfoDetail']),
    newChatStartup: new AsyncSeriesHook(['positionInfoDetail', 'chatRunningContext']),
    jobMarkedAsNotSuit: new AsyncSeriesHook(['positionInfoDetail', 'markDetail']),
    noPositionFoundForCurrentJob: new SyncHook(),
    noPositionFoundAfterTraverseAllJob: new SyncHook(),
    errorEncounter: new SyncHook(['errorInfo']),
    encounterEmptyRecommendJobList: new AsyncSeriesHook(['args']),
    sageTimeEnter: new AsyncSeriesHook(['args']),
    sageTimeExit: new AsyncSeriesHook(['args']),
    // between jobs; see yieldIfRequested
    checkpoint: new AsyncSeriesHook([])
  }
  initPlugins(hooks)
  hooks.checkpoint.tapPromise('TaskQueue', () =>
    yieldIfRequested(async () => {
      taskProgress.update(undefined, '排队中的任务先运行，本任务稍后自动继续', 'yielded')
      await closeBrowserWindow?.()
    })
  )
  hooks.noPositionFoundAfterTraverseAllJob.tap('TaskProgress', () =>
    taskProgress.update(
      undefined,
      `暂时没有${readRunSettings(readConfigFile('boss.json')).runMode === 'collect' ? '待收集' : '可沟通'}岗位，稍后继续查找`,
      'waiting'
    )
  )
  hooks.sageTimeEnter.tapPromise('TaskProgress', async () =>
    taskProgress.update(undefined, '定时休息中', 'resting')
  )
  hooks.sageTimeExit.tapPromise('TaskProgress', async () =>
    taskProgress.update(undefined, '休息结束，继续查找')
  )

  gtag('run_auto_chat_with_boss_main_ready')

  autoStartChatEventBus.once('LOGIN_STATUS_INVALID', () => {})

  while (true) {
    try {
      await mainLoop(hooks)
    } catch (err) {
      if (err instanceof Error) {
        if (
          /AUTO_CHAT_(NO_MATCH_BATCH_LIMIT|LIST_STALLED|DETAIL_NOT_READY|NO_USABLE_SOURCE|COLLECT_MODE_CHAT_BLOCKED|UNMATCHED_JOB_CHAT_BLOCKED)/.test(
            err.message
          )
        ) {
          const noMatch = err.message.includes('NO_MATCH_BATCH_LIMIT')
          taskProgress.update(
            undefined,
            noMatch
              ? '连续检查5批岗位仍无可处理岗位，已停止；请检查公司名单、岗位分类和经验条件'
              : /CHAT_BLOCKED/.test(err.message)
                ? '已阻止一次不应发生的打招呼（岗位未通过条件检查或处于只收集模式），任务已停止；请反馈此问题'
                : err.message.includes('NO_USABLE_SOURCE')
                  ? '没有可用的职位来源：BOSS账号未设置求职期望；请在BOSS中添加求职期望，或启用“推荐职位”“搜索”来源'
                  : '岗位列表或详情无法确认，已停止，未继续发送；请检查BOSS页面后重新开始',
            'blocked'
          )
          await closeBrowserWindow?.()
          process.exit(
            noMatch
              ? AUTO_CHAT_ERROR_EXIT_CODE.NO_MATCHING_JOBS
              : AUTO_CHAT_ERROR_EXIT_CODE.JOB_PAGE_NOT_READY
          )
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
        if (
          err.message.includes(`Could not find Chrome`) ||
          err.message.includes(`no executable was found`)
        ) {
          process.exit(AUTO_CHAT_ERROR_EXIT_CODE.PUPPETEER_IS_NOT_EXECUTABLE)
          break
        }
      }
      closeBrowserWindow?.()
      console.error(err)
      taskProgress.update(undefined, '遇到异常，等待重新检查任务', 'retrying')
      const shouldExit = await checkShouldExit()
      if (shouldExit) {
        app.exit()
        return
      }
      console.log(
        `[Run core main] An internal error is caught, and browser will be restarted in ${rerunInterval}ms.`
      )
      await sleep(rerunInterval)
    }
  }
}

export const waitForProcessHandShakeAndRunAutoChat = async () => {
  await app.whenReady()
  app.on('window-all-closed', (e) => {
    e.preventDefault()
  })
  initPublicIpc()
  await connectToDaemon()
  await sendToDaemon(
    {
      type: 'ping'
    },
    {
      needCallback: true
    }
  )
  sendToDaemon({
    type: 'worker-to-gui-message',
    workerId: process.env.GEEKGEEKRUND_WORKER_ID,
    data: {
      type: 'prerequisite-step-by-step-check',
      step: {
        id: 'worker-launch',
        status: 'fulfilled'
      },
      runRecordId
    }
  })
  runAutoChat()
}

attachListenerForKillSelfOnParentExited()
