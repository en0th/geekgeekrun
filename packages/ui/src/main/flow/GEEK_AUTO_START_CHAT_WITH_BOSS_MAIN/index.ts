import DingtalkPlugin from '@geekgeekrun/dingtalk-plugin/index.mjs'
import { app } from 'electron'
import { SyncHook, AsyncSeriesHook, AsyncSeriesWaterfallHook } from 'tapable'
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
import { readAutoChatResume, writeAutoChatResume, discardAutoChatResume } from '../../features/task-resume'
import { yieldIfRequested } from '../../features/task-queue'
import { isJsonStorageError } from '@geekgeekrun/utils/atomic-json.mjs'
import { getLastUsedAndAvailableBrowser } from '../DOWNLOAD_DEPENDENCIES/utils/browser-history'
import { configWithBrowserAssistant } from '../../features/config-with-browser-assistant'
import { attachCollectAcceptance } from '../../features/collect-acceptance'
import { installWorkerShutdown } from '@geekgeekrun/utils/worker-shutdown.mjs'
import { createAutomaticRetry } from '@geekgeekrun/geek-auto-start-chat-with-boss/automatic-retry.mjs'
const { default: SqlitePlugin } = SqlitePluginModule

let closeForShutdown: () => Promise<void> = async () => {}
let saveForShutdown: () => void = () => {}
const shutdown = installWorkerShutdown({ close: () => closeForShutdown(), save: () => saveForShutdown() })

const { groupRobotAccessToken: dingTalkAccessToken } = readConfigFile('dingtalk.json')

const initPlugins = (hooks) => {
  if (!process.env.GEEKGEEKRUN_COLLECT_AUDIT_DIR) new DingtalkPlugin(dingTalkAccessToken).apply(hooks)
  const settings = readRunSettings(readConfigFile('boss.json'))
  new SqlitePlugin(getPublicDbFilePath(), {
    collectOnlyMatched: settings.runMode === 'collect' && settings.collectOnlyMatchingJobs
  }).apply(hooks)
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
    prepareForAutomaticRetry,
    runBudgetStatus,
    waitUntilSecurityCheckPassed,
    recheckAfterRest
  } = await import('@geekgeekrun/geek-auto-start-chat-with-boss/index.mjs')
  closeForShutdown = closeBrowserWindow
  // the same run started again (继续任务, or restarted after making way for another task):
  // go on with its position, skipped jobs and counters
  const saved = readAutoChatResume()
  const resumed = !!runRecordId && Number(saved?.runRecordId) === Number(runRecordId)
  if (resumed) importRunState(saved!.runState, { skipCurrentFilter: saved!.skipCurrentFilter })
  const taskProgress = createTaskProgress(resumed ? saved!.progress : null)
  autoStartChatEventBus.on('RUN_BUDGET', (budget) => taskProgress.setBudget(budget))
  const runMode = readRunSettings(readConfigFile('boss.json')).runMode
  let skipCurrentFilterNextTime = false
  // the run rotated through every source and finished: nothing left to resume
  let runCompleted = false
  let messageSendPending = resumed && saved?.messageSendPending === true
  let recoveryReason: 'source-missing' | 'safety-guard' | undefined
  const saveResume = ({ exitCode, pending = messageSendPending, required = false }:
    { exitCode?: number; pending?: boolean; required?: boolean } = {}) => {
    if (!runRecordId) {
      if (required) throw Object.assign(new Error('无法记录本次发送状态，任务已停止，请保留数据并检查任务记录。'), { code: 'GGR_FILE_WRITE_FAILED' })
      return
    }
    if (runCompleted) {
      discardAutoChatResume()
      return
    }
    const { log, ...rest } = taskProgress.progress
    writeAutoChatResume({
      runRecordId: Number(runRecordId),
      runMode,
      savedAt: Date.now(),
      exitCode,
      messageSendPending: pending,
      recoveryReason,
      skipCurrentFilter: skipCurrentFilterNextTime,
      runState: exportRunState(),
      progress: { ...rest, log: log.slice(-100) }
    }, { required })
  }
  // Persist synchronously before a click can send, and after confirmed DB storage.
  // This survives a window close, a manual pause and a process killed without an exit hook.
  autoStartChatEventBus.on('CHAT_CONFIRMATION', (pending: boolean) => {
    saveResume({ pending, required: true })
    messageSendPending = pending
  })
  const resumeSaver = setInterval(saveResume, 5 * 1000)
  saveForShutdown = saveResume
  // the stop notice names what the last list was filtered by, not a fixed guess
  const listSummaryHint = () => {
    const summary = String(taskProgress.progress.listSummary || '')
    return summary
      ? `最近一批${summary.replace(/^当前列表/, '')}；任务已暂停，调整对应条件后可在任务列表中恢复`
      : '请检查求职条件和BOSS页面筛选，任务已暂停，调整后可在任务列表中恢复'
  }
  autoStartChatEventBus.on('RUN_POSITION', saveResume)
  // every way out of the process (stop, error, yield) leaves the latest state behind
  process.on('exit', (exitCode) => {
    clearInterval(resumeSaver)
    saveResume({ exitCode })
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
  autoStartChatEventBus.on('TASK_PROGRESS', ({ kind, detail, state, listSummary, dailyQuota }) => {
    if (dailyQuota) { taskProgress.setExtras({ dailyQuota }); if (!kind && !detail) return }
    const named = (prefix) => (currentJob ? `${prefix}：${currentJob}` : '')
    const logText =
      kind === 'viewed'
        ? named('查看岗位')
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
  await initPuppeteer()

  const hooks = {
    puppeteerLaunched: new SyncHook(['browser']),
    pageGotten: new SyncHook(['page']),
    pageLoaded: new SyncHook(),
    cookieWillSet: new AsyncSeriesHook(['cookies']),
    userInfoResponse: new AsyncSeriesHook(['userInfo']),
    dailyQuotaSeed: new AsyncSeriesWaterfallHook<[number, { accountId: string; day: string }]>(['count', 'identity']),
    mainFlowWillLaunch: new AsyncSeriesHook(['args']),
    jobDetailIsGetFromRecommendList: new AsyncSeriesHook(['userInfo']),
    jobMatchedForCollection: new AsyncSeriesHook(['detail']),
    newChatWillStartup: new AsyncSeriesHook(['positionInfoDetail']),
    newChatStartup: new AsyncSeriesHook<[unknown, unknown]>(['positionInfoDetail', 'chatRunningContext']),
    jobMarkedAsNotSuit: new AsyncSeriesHook<[unknown, { markOp?: number } | undefined]>(['positionInfoDetail', 'markDetail']),
    noPositionFoundForCurrentJob: new SyncHook(),
    noPositionFoundAfterTraverseAllJob: new SyncHook(),
    errorEncounter: new SyncHook(['errorInfo']),
    encounterEmptyRecommendJobList: new AsyncSeriesHook(['args']),
    sageTimeEnter: new AsyncSeriesHook<[{ until?: number }]>(['args']),
    sageTimeExit: new AsyncSeriesHook(['args']),
    // between jobs; see yieldIfRequested
    checkpoint: new AsyncSeriesHook<[]>([])
  }
  hooks.sageTimeExit.tapPromise('RunPolicyGuard', recheckAfterRest)
  initPlugins(hooks)
  attachCollectAcceptance({ hooks, events: autoStartChatEventBus, runMode, runRecordId })
  hooks.jobDetailIsGetFromRecommendList.tapPromise('TaskProgress', async (data) => {
    currentJob = jobLabel(data)
  })
  hooks.jobMarkedAsNotSuit.tapPromise('TaskProgress', async (data, markDetail) => {
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
  hooks.sageTimeEnter.tapPromise('TaskProgress', async (data) => {
    taskProgress.setExtras({ restUntil: data?.until || 0 })
    taskProgress.update(undefined, '定时休息中，到时会重新检查运行条件后继续', 'resting')
  })
  hooks.sageTimeExit.tapPromise('TaskProgress', async () => {
    taskProgress.setExtras({ restUntil: 0 })
    taskProgress.update(undefined, '休息结束，继续查找')
  })

  autoStartChatEventBus.once('LOGIN_STATUS_INVALID', () => {})

  async function stopForStorage(error: unknown) {
    if (!isJsonStorageError(error)) return false
    taskProgress.update(undefined, (error as Error).message, 'blocked')
    saveResume()
    await closeBrowserWindow?.()
    process.exit(AUTO_CHAT_ERROR_EXIT_CODE.JSON_STORAGE_UNAVAILABLE)
    return true
  }
  async function stopForBudget(error: unknown) {
    if (!(error instanceof Error) || !/AUTO_CHAT_RUN_BUDGET_(EXCEEDED|UNAVAILABLE)/.test(error.message)) return false
    taskProgress.setBudget(runBudgetStatus())
    taskProgress.update(undefined, (error as Error & { detail?: string }).detail || error.message, 'blocked')
    saveResume()
    await closeBrowserWindow?.()
    process.exit(error.message.includes('EXCEEDED') ? AUTO_CHAT_ERROR_EXIT_CODE.RUN_BUDGET_EXCEEDED : AUTO_CHAT_ERROR_EXIT_CODE.RUN_BUDGET_UNAVAILABLE)
    return true
  }

  const automaticRetry = createAutomaticRetry({
    prepare: prepareForAutomaticRetry,
    isStopping: () => shutdown.isStopping(),
    sendPending: () => messageSendPending,
    progressKey: () => `${taskProgress.progress.viewed}:${taskProgress.progress.sent}:${taskProgress.progress.collected}`,
    publish: ({ attempt, until, delayMs, reason }) => {
      taskProgress.setExtras({ retryUntil: until, retryAttempt: attempt })
      taskProgress.update(undefined, until ? `${reason}，${delayMs / 1000}秒后自动重试（第${attempt}次）；已有结果保留，无需重新启动。` : reason, 'retrying')
      saveResume({ required: true })
    },
  })

  while (true) {
    if (shutdown.isStopping()) return
    try {
      await mainLoop(hooks)
    } catch (err) {
      if (shutdown.isStopping()) return
      if (await stopForStorage(err)) return
      if (await stopForBudget(err)) return
      try {
        if (await automaticRetry.recover(err)) continue
        if (shutdown.isStopping()) return
      } catch (retryError) {
        if (shutdown.isStopping()) return
        if (await stopForStorage(retryError) || await stopForBudget(retryError)) return
        err = retryError
      }
      if (messageSendPending && !(err instanceof Error && /AUTO_CHAT_DAILY_/.test(err.message)))
        err = Object.assign(new Error('AUTO_CHAT_MESSAGE_SEND_UNCONFIRMED'), { detail: '上次发送结果尚未确认，请先核对；不会自动重发。' })
      if (err instanceof Error && (/AUTO_CHAT_DAILY_/.test(err.message) || err.message === 'STARTUP_CHAT_ERROR_DUE_TO_TODAY_CHANCE_HAS_USED_OUT')) {
        const platform = /PLATFORM_LIMIT|TODAY_CHANCE/.test(err.message)
        const goal = err.message.includes('GOAL_REACHED')
        const unconfirmed = err.message.includes('UNCONFIRMED')
        taskProgress.update(undefined, (err as Error & { detail?: string }).detail || (platform
          ? 'BOSS提示该账号今日沟通额度已用尽，自动打招呼已停止，结果和进度已保留。请在平台额度恢复后再运行。'
          : '每日数量记录需检查，任务已暂停，不会清零后继续发送。'), 'blocked')
        saveResume()
        await closeBrowserWindow?.()
        process.exit(platform ? AUTO_CHAT_ERROR_EXIT_CODE.PLATFORM_DAILY_LIMIT : goal ? AUTO_CHAT_ERROR_EXIT_CODE.DAILY_GOAL_REACHED
          : unconfirmed ? AUTO_CHAT_ERROR_EXIT_CODE.MESSAGE_SEND_UNCONFIRMED : AUTO_CHAT_ERROR_EXIT_CODE.DAILY_QUOTA_UNAVAILABLE)
        return
      }
      if (err instanceof Error && err.message.includes('AUTO_CHAT_SECURITY_CHECK')) {
        pauseForSecurityCheck()
        let result
        try { result = await waitUntilSecurityCheckPassed() }
        catch (error) { if (await stopForStorage(error) || await stopForBudget(error)) return; throw error }
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
        if (['AUTO_CHAT_BROWSER_UNAVAILABLE', 'AUTO_CHAT_MESSAGE_SEND_UNCONFIRMED'].includes(err.message)) {
          taskProgress.update(undefined, (err as Error & { detail?: string }).detail || '浏览器或连接异常，任务已暂停', 'blocked')
          saveResume()
          await closeBrowserWindow?.()
          process.exit(err.message.includes('SEND_UNCONFIRMED') ? AUTO_CHAT_ERROR_EXIT_CODE.MESSAGE_SEND_UNCONFIRMED : AUTO_CHAT_ERROR_EXIT_CODE.BROWSER_UNAVAILABLE)
          return
        }
        if (err.message.includes('AUTO_CHAT_PAGE_FILTER_NOT_APPLIED')) {
          taskProgress.update(undefined, (err as Error & { detail?: string }).detail || '页面筛选未能确认，任务已暂停', 'blocked')
          saveResume()
          await closeBrowserWindow?.()
          process.exit(AUTO_CHAT_ERROR_EXIT_CODE.PAGE_FILTER_NOT_APPLIED)
          return
        }
        if (err.message.includes('AUTO_CHAT_BACKGROUND_WINDOW_UNAVAILABLE')) {
          taskProgress.update(undefined, (err as Error & { detail?: string }).detail || '浏览器后台窗口无法确认，任务已暂停', 'blocked')
          saveResume()
          await closeBrowserWindow?.()
          process.exit(AUTO_CHAT_ERROR_EXIT_CODE.BACKGROUND_WINDOW_UNAVAILABLE)
          return
        }
        if (err.message.includes('AUTO_CHAT_CITY_FILTER_NOT_APPLIED')) {
          taskProgress.update(undefined, (err as Error & { detail?: string }).detail || '城市筛选未能确认，请检查BOSS城市选择器后恢复任务', 'blocked')
          await closeBrowserWindow?.()
          process.exit(AUTO_CHAT_ERROR_EXIT_CODE.CITY_FILTER_NOT_APPLIED)
          return
        }
        if (/LOGIN_STATUS_(RESTRICTED|UNKNOWN)|AUTO_CHAT_ACCOUNT_CHANGED|AUTO_CHAT_(?:SEARCH_FILTER_NOT_APPLIED|COMPANY_SOURCE_NOT_CONFIRMED)|AUTO_CHAT_JOB_PAGE_CLOSED/.test(err.message)) {
          const accountChanged = err.message.includes('ACCOUNT_CHANGED')
          const detail = (err as Error & { detail?: string }).detail
          taskProgress.update(undefined, accountChanged
            ? 'BOSS账号已切换，请切回原账号恢复，或为新账号新建任务'
            : (detail || '暂时无法确认BOSS访问状态，登录凭证已保留；请检查BOSS页面和网络后恢复'), 'blocked')
          await closeBrowserWindow?.()
          process.exit(accountChanged ? AUTO_CHAT_ERROR_EXIT_CODE.ACCOUNT_CHANGED : AUTO_CHAT_ERROR_EXIT_CODE.LOGIN_STATUS_UNCONFIRMED)
          return
        }
        if (err.message.includes('AUTO_CHAT_ALL_SOURCES_ROTATED')) {
          // source rotation walked every source once: a successful finish, not a failure
          runCompleted = true
          taskProgress.update(undefined, '所有职位来源已轮换完成，任务结束', 'stopped')
          discardAutoChatResume()
          await closeBrowserWindow?.()
          process.exit(AUTO_CHAT_ERROR_EXIT_CODE.ALL_SOURCES_ROTATED)
          return
        }
        if (
          /AUTO_CHAT_(NO_MATCH_BATCH_LIMIT|LIST_STALLED|DETAIL_NOT_READY|NO_USABLE_SOURCE|COLLECT_MODE_CHAT_BLOCKED|UNMATCHED_JOB_CHAT_BLOCKED|REQUIRED_CONDITION_CHAT_BLOCKED)/.test(
            err.message
          )
        ) {
          const noMatch = err.message.includes('NO_MATCH_BATCH_LIMIT')
          recoveryReason = /CHAT_BLOCKED/.test(err.message) ? 'safety-guard'
            : err.message.includes('NO_USABLE_SOURCE') ? 'source-missing' : undefined
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
      console.error(err)
      const shouldExit = await checkShouldExit()
      if (shouldExit) {
        app.exit()
        return
      }
      try { await automaticRetry.recover(new Error('AUTO_CHAT_RETRY_UNEXPECTED')) }
      catch (error) { if (await stopForStorage(error) || await stopForBudget(error)) return; throw error }
    }
  }
}

export const waitForProcessHandShakeAndRunAutoChat = async () => {
  await app.whenReady()
  app.on('window-all-closed', () => {
    // Background tasks continue after auxiliary windows close.
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
  await runAutoChat()
}

attachListenerForKillSelfOnParentExited(shutdown.stop)
