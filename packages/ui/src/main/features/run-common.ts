import { AUTO_CHAT_ERROR_EXIT_CODE } from '../../common/enums/auto-start-chat'
import { daemonEE, sendToDaemon } from '../flow/OPEN_SETTING_WINDOW/connect-to-daemon'
import { saveAndGetCurrentRunRecord, saveRunConfigSnapshot } from '../flow/OPEN_SETTING_WINDOW/utils/db'
import minimist from 'minimist'
import { readConfigFile, runtimeFolderPath, storageFilePath } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { createBudgetStore } from '@geekgeekrun/geek-auto-start-chat-with-boss/run-budget-store.mjs'
import { writeTaskConfigSnapshot, jobConfigSnapshot } from '@geekgeekrun/geek-auto-start-chat-with-boss/task-config-snapshot.mjs'
import path from 'node:path'
import { readRunSettings } from '@geekgeekrun/geek-auto-start-chat-with-boss/run-settings.mjs'
import { normalizeJobSources } from '@geekgeekrun/geek-auto-start-chat-with-boss/search-source.mjs'
import { app } from 'electron'
import { initializeAutoChatResume, readAutoChatResume } from './task-resume'
import { assertCheckpointCanResume } from '../../common/task-recovery.mjs'
import { withGlobalRunPolicy, readGlobalRunPolicy } from './run-policy'
import { checkBossLoginStatus } from './boss-login-check'
import { createDailyQuotaStore } from '@geekgeekrun/geek-auto-start-chat-with-boss/daily-chat-quota.mjs'

interface DaemonStatus {
  workers?: { workerId: string; args?: string[] }[]
  queue?: { workerId: string; position: number; args?: string[] }[]
  history?: { workerId: string; runRecordId?: number | null; code: number | null; endedAt: number }[]
}

let startLock: Promise<unknown> = Promise.resolve()
export function runCommon(options: Parameters<typeof runCommonInternal>[0]) {
  const result = startLock.then(() => runCommonInternal(options))
  startLock = result.catch(() => {})
  return result
}
async function runCommonInternal({
  mode,
  // the poll task doesn't create an auto-greeting run record
  withRunRecord = true,
  // exit codes after which this task must not be restarted, on top of the shared ones
  extraNoAutoRestartExitCodes = [] as number[],
  // 继续任务: go on with this run record instead of creating a new one
  resumeRunRecordId = null as number | null,
  capturedConfig = null as Record<string, any> | null,
  expectedAccountId = null as string | null
}: {
  mode: string
  withRunRecord?: boolean
  extraNoAutoRestartExitCodes?: number[]
  resumeRunRecordId?: number | null
  capturedConfig?: Record<string, any> | null
  expectedAccountId?: string | null
}) {
  await sendToDaemon(
    {
      type: 'user-process-register'
    },
    {
      needCallback: true
    }
  )
  const daemonStatus = (await sendToDaemon(
    {
      type: 'get-status'
    },
    {
      needCallback: true
    }
  )) as DaemonStatus | undefined
  const runningTask = daemonStatus?.workers?.find((it) => it.workerId === mode)
  // a task waiting in the queue counts as started too
  const queuedTask = daemonStatus?.queue?.find((it) => it.workerId === mode)
  if (runningTask || queuedTask) {
    const commandlineArgs = minimist((runningTask ?? queuedTask)?.args ?? [])
    const runRecordId = Number(commandlineArgs['run-record-id'])
    if (resumeRunRecordId && runRecordId !== resumeRunRecordId)
      throw new Error('已有其他任务正在运行或排队，请重新加载任务列表。')
    console.log(runningTask ? '任务已在运行中' : '任务已在队列中')
    return {
      runRecordId,
      isAlreadyRunning: true,
      queued: !runningTask,
      queuePosition: queuedTask?.position ?? 0
    }
  }
  const currentResume = mode === 'geekAutoStartWithBossMain' ? readAutoChatResume({ strict: true }) : null
  if (mode === 'geekAutoStartWithBossMain') {
    const login = await checkBossLoginStatus()
    if (login.status !== 'valid' || !login.accountId) throw Error('请先登录并验证BOSS账号，再开始任务。')
    if (expectedAccountId && expectedAccountId !== login.accountId) throw Error('当前账号与任务账号不同，未启动；请切回原账号。')
    expectedAccountId = login.accountId
    const runMode = (capturedConfig?.['boss.json'] || readConfigFile('boss.json'))?.autoChatRunMode
    if (runMode !== 'collect') {
      try { createDailyQuotaStore(storageFilePath).assert(expectedAccountId, readGlobalRunPolicy().dailyLimit) }
      catch (error) { throw Error((error as { detail?: string }).detail || (error as Error).message) }
    }
  }
  const currentRunRecord = resumeRunRecordId
    ? { id: resumeRunRecordId }
    : withRunRecord
      ? (await saveAndGetCurrentRunRecord())?.data
      : null
  const subProcessEnv: NodeJS.ProcessEnv = {
    ...process.env,
    GEEKGEEKRUND_NO_AUTO_RESTART_EXIT_CODE: [
      AUTO_CHAT_ERROR_EXIT_CODE.PUPPETEER_IS_NOT_EXECUTABLE,
      AUTO_CHAT_ERROR_EXIT_CODE.LOGIN_STATUS_INVALID,
      AUTO_CHAT_ERROR_EXIT_CODE.LOGIN_STATUS_UNCONFIRMED,
      AUTO_CHAT_ERROR_EXIT_CODE.ACCOUNT_CHANGED,
      AUTO_CHAT_ERROR_EXIT_CODE.CITY_FILTER_NOT_APPLIED,
      AUTO_CHAT_ERROR_EXIT_CODE.RUN_BUDGET_EXCEEDED,
      AUTO_CHAT_ERROR_EXIT_CODE.RUN_BUDGET_UNAVAILABLE,
      AUTO_CHAT_ERROR_EXIT_CODE.DAILY_GOAL_REACHED,
      AUTO_CHAT_ERROR_EXIT_CODE.PLATFORM_DAILY_LIMIT,
      AUTO_CHAT_ERROR_EXIT_CODE.DAILY_QUOTA_UNAVAILABLE,
      AUTO_CHAT_ERROR_EXIT_CODE.JSON_STORAGE_UNAVAILABLE,
      AUTO_CHAT_ERROR_EXIT_CODE.BACKGROUND_WINDOW_UNAVAILABLE,
      AUTO_CHAT_ERROR_EXIT_CODE.BROWSER_UNAVAILABLE,
      AUTO_CHAT_ERROR_EXIT_CODE.PAGE_FILTER_NOT_APPLIED,
      AUTO_CHAT_ERROR_EXIT_CODE.ACCESS_IS_DENIED,
      AUTO_CHAT_ERROR_EXIT_CODE.LLM_UNAVAILABLE,
      AUTO_CHAT_ERROR_EXIT_CODE.MESSAGE_SEND_UNCONFIRMED,
      AUTO_CHAT_ERROR_EXIT_CODE.NO_MATCHING_JOBS,
      AUTO_CHAT_ERROR_EXIT_CODE.JOB_PAGE_NOT_READY,
      AUTO_CHAT_ERROR_EXIT_CODE.SECURITY_CHECK_NOT_PASSED,
      AUTO_CHAT_ERROR_EXIT_CODE.ALL_SOURCES_ROTATED,
      ...extraNoAutoRestartExitCodes
    ].join(',')
  }
  let autoChatRunMode = 'chat'
  if (mode === 'geekAutoStartWithBossMain') {
    const config = capturedConfig || withGlobalRunPolicy(Object.fromEntries(['boss.json', 'common-job-condition-config.json', 'target-company-list.json'].map(name => [name, readConfigFile(name)])))
    if (expectedAccountId) config['boss.json'].autoChatExpectedAccountId = expectedAccountId
    if (resumeRunRecordId) assertCheckpointCanResume(currentResume, {
      runRecordId: resumeRunRecordId,
      runMode: readRunSettings(config['boss.json']).runMode,
      history: daemonStatus?.history ?? []
    })
    normalizeJobSources(config['boss.json'].jobSourceList)
    autoChatRunMode = readRunSettings(config['boss.json']).runMode
    if (!resumeRunRecordId) await saveRunConfigSnapshot({ runRecordId: Number(currentRunRecord?.id), config: {
      version: 2, task: 'auto', savedAt: new Date().toISOString(), actualConfig: jobConfigSnapshot(config)
    } })
    subProcessEnv.GEEKGEEKRUN_TASK_CONFIG_FILE = writeTaskConfigSnapshot(
      path.join(runtimeFolderPath, 'task-configs'), currentRunRecord?.id, config,
      { resuming: Boolean(resumeRunRecordId) }
    )
    // Only an explicitly new logical run starts at zero. In particular, old journal
    // files may outlive a restored database whose run IDs are assigned again.
    if (!resumeRunRecordId) {
      createBudgetStore(storageFilePath, currentRunRecord?.id).save({
        usage: { requests: 0, detailRequests: 0, activeMs: 0 }, baselineUnknown: false
      })
      initializeAutoChatResume(Number(currentRunRecord?.id), autoChatRunMode)
    }
  }
  const taskArgs = [`--mode=${mode}`, `--run-record-id=${currentRunRecord?.id || 0}`]
  // recorded in the task history so a finished run links to the right data (chats or jobs)
  if (mode === 'geekAutoStartWithBossMain')
    taskArgs.push(`--run-mode=${autoChatRunMode}`)
  const args = !app.isPackaged ? [app.getAppPath(), ...taskArgs] : taskArgs
  // the daemon queues BOSS tasks while another one runs
  const startResponse = (await sendToDaemon(
    {
      type: 'start-worker',
      workerId: mode,
      command: process.argv[0],
      args,
      env: subProcessEnv
    },
    {
      needCallback: true
    }
  )) as { queued?: boolean; position?: number } | undefined
  daemonEE.on('message', (message) => {
    if (message.type === 'worker-exited') {
      if (
        message.workerId === mode &&
        !message.restarting &&
        globalThis.GEEKGEEKRUN_PROCESS_ROLE !== 'ui'
      ) {
        process.exit(0)
      }
    }
  })
  return {
    runRecordId: currentRunRecord?.id,
    queued: Boolean(startResponse?.queued),
    queuePosition: startResponse?.position ?? 0
  }
}
