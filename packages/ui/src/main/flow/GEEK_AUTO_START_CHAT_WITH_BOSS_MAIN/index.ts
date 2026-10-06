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
import { connectToDaemon, sendToDaemon } from '../OPEN_SETTING_WINDOW/connect-to-daemon'
// import { PeriodPushCurrentPageScreenshotPlugin } from '../../utils/screenshot'
import { checkShouldExit } from '../../utils/worker'
import { CookieInvalidHandlePlugin } from '../../features/cookie-invalid-handle-plugin'
import initPublicIpc from '../../utils/initPublicIpc'
import { createTaskProgress } from '../../features/task-progress'
import { readAutoChatResume, writeAutoChatResume } from '../../features/task-resume'
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
  const {
    initPuppeteer,
    mainLoop,
    closeBrowserWindow,
    autoStartChatEventBus,
    exportRunState,
    importRunState,
    resumeFromCurrentPosition,
    waitUntilSecurityCheckPassed
  } = await import('@geekgeekrun/geek-auto-start-chat-with-boss/index.mjs')
  // the same run started again (继续任务, or restarted after making way for another task):
  // go on with its position, skipped jobs and counters
  const saved = readAutoChatResume()
  const resumed = !!runRecordId && Number(saved?.runRecordId) === Number(runRecordId)
  if (resumed) importRunState(saved!.runState, { skipCurrentFilter: saved!.skipCurrentFilter })
  const taskProgress = createTaskProgress(resumed ? saved!.progress : null)
  const runMode = readRunSettings(readConfigFile('boss.json')).runMode
  let skipCurrentFilterNextTime = false
  const saveResume = () => {
    if (!runRecordId) return
    const { log, ...rest } = taskProgress.progress
    writeAutoChatResume({
      runRecordId: Number(runRecordId),
      runMode,
      savedAt: Date.now(),
      skipCurrentFilter: skipCurrentFilterNextTime,
      runState: exportRunState(),
      progress: { ...rest, log: log.slice(-100) }
    })
  }
  const resumeSaver = setInterval(saveResume, 5 * 1000)
  // the stop notice names what the last list was filtered by, not a fixed guess
  const listSummaryHint = () => {
    const summary = String(taskProgress.progress.listSummary || '')
    return summary
      ? `最近一批${summary.replace(/^当前列表/, '')}；任务已暂停，调整对应条件后可在任务列表中恢复`
      : '请检查求职条件和BOSS页面筛选，任务已暂停，调整后可在任务列表中恢复'
  }
  autoStartChatEventBus.on('RUN_POSITION', saveResume)
  // every way out of the process (stop, error, yield) leaves the latest state behind
  process.on('exit', () => {
    clearInterval(resumeSaver)
    saveResume()
  })

  // BOSS asked for a verification: pause and let the user pass it in the open window
  const PAUSE_TEXT = 'BOSS要求安全验证，任务已暂停；请在打开的BOSS窗口中完成验证，完成后自动继续'
  let pausedForCheck = false
  const pauseForSecurityCheck = () => {
    if (pausedForCheck) return
    pausedForCheck = true
    taskProgress.update(undefined, PAUSE_TEXT, 'paused')
    sendToDaemon({
      type: 'worker-to-gui-message',
      workerId: process.env.GEEKGEEKRUND_WORKER_ID,
      data: {
        type: 'toast',
        level: 'warning',
        title: '找岗位已暂停：需要安全验证',
        message: '请在打开的BOSS窗口中完成验证，完成后任务会自动继续。',
        duration: 30 * 1000
      }
    })
  }
  const securityCheckPassed = () => {
    if (!pausedForCheck) return
    pausedForCheck = false
    taskProgress.update(undefined, '安全验证已完成，继续任务')
  }
  autoStartChatEventBus.on('SECURITY_CHECK', pauseForSecurityCheck)
  autoStartChatEventBus.on('SECURITY_CHECK_PASSED', securityCheckPassed)
  // the job being looked at, named in the execution log
  let currentJob = ''
  const jobLabel = (data) =>
    ((brand, job) => (brand && job ? `${brand}「${job}」` : brand || job))(
      data?.brandComInfo?.brandName,
      data?.jobInfo?.jobName
    ) ||
    data?.jobInfo?.encryptId ||
    ''
  autoStartChatEventBus.on('TASK_PROGRESS', ({ kind, detail, state, listSummary }) => {
    const named = (prefix) => (currentJob ? `${prefix}：${currentJob}` : '')
    const logText =
      kind === 'viewed'
        ? named('查看并入库')
        : kind === 'collected'
          ? named('收集')
          : kind === 'sent'
            ? named('打招呼')
            : kind === 'skipped'
              ? named('跳过') + (currentJob && detail ? `（${detail}）` : '')
              : ''
    taskProgress.update(kind, detail, state || 'running', { listSummary }, logText || undefined)
  })
  taskProgress.update(undefined, resumed ? '继续上次的任务' : '准备查找岗位')
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
  hooks.jobDetailIsGetFromRecommendList.tapPromise('TaskProgress', async (data) => {
    currentJob = jobLabel(data)
  })
  // the hook passes (jobData, { markOp, ... }); its declared typing only knows one argument
  hooks.jobMarkedAsNotSuit.tapPromise('TaskProgress', async (...args: unknown[]) => {
    const [data, markDetail] = args as [unknown, { markOp?: number } | undefined]
    taskProgress.log(
      'marked',
      `${markDetail?.markOp === 1 ? '在BOSS标记不合适' : '本地标记不合适'}：${jobLabel(data)}`,
      'marked'
    )
  })
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

  autoStartChatEventBus.once('LOGIN_STATUS_INVALID', () => {})

  while (true) {
    try {
      await mainLoop(hooks)
    } catch (err) {
      if (err instanceof Error && err.message.includes('AUTO_CHAT_SECURITY_CHECK')) {
        pauseForSecurityCheck()
        const result = await waitUntilSecurityCheckPassed()
        if (result === 'passed') {
          securityCheckPassed()
          // a fresh browser with the new cookies, from where the run was
          resumeFromCurrentPosition()
          await closeBrowserWindow?.()
          await sleep(2000)
          continue
        }
        pausedForCheck = false
        taskProgress.update(
          undefined,
          '安全验证窗口已关闭，任务已暂停；可在任务列表中恢复，恢复后会重新打开BOSS',
          'blocked'
        )
        await closeBrowserWindow?.()
        process.exit(AUTO_CHAT_ERROR_EXIT_CODE.SECURITY_CHECK_NOT_PASSED)
        return
      }
      if (err instanceof Error) {
        if (
          /AUTO_CHAT_(NO_MATCH_BATCH_LIMIT|LIST_STALLED|DETAIL_NOT_READY|NO_USABLE_SOURCE|COLLECT_MODE_CHAT_BLOCKED|UNMATCHED_JOB_CHAT_BLOCKED)/.test(
            err.message
          )
        ) {
          const noMatch = err.message.includes('NO_MATCH_BATCH_LIMIT')
          // 继续任务 then starts after the filter combination that had nothing usable
          skipCurrentFilterNextTime = noMatch
          taskProgress.update(
            undefined,
            noMatch
              ? `连续检查5批岗位仍无可处理岗位；${listSummaryHint()}`
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
