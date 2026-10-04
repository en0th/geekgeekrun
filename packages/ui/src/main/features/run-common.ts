import { AUTO_CHAT_ERROR_EXIT_CODE } from '../../common/enums/auto-start-chat'
import { daemonEE, sendToDaemon } from '../flow/OPEN_SETTING_WINDOW/connect-to-daemon'
import { saveAndGetCurrentRunRecord } from '../flow/OPEN_SETTING_WINDOW/utils/db'
import minimist from 'minimist'
import { readConfigFile } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { readRunSettings } from '@geekgeekrun/geek-auto-start-chat-with-boss/run-settings.mjs'
import { app } from 'electron'

interface DaemonStatus {
  workers?: { workerId: string; args?: string[] }[]
  queue?: { workerId: string; position: number; args?: string[] }[]
}

export async function runCommon({
  mode,
  // the poll task doesn't create an auto-greeting run record
  withRunRecord = true,
  // exit codes after which this task must not be restarted, on top of the shared ones
  extraNoAutoRestartExitCodes = [] as number[]
}: {
  mode: string
  withRunRecord?: boolean
  extraNoAutoRestartExitCodes?: number[]
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
    console.log(runningTask ? '任务已在运行中' : '任务已在队列中')
    return {
      runRecordId,
      isAlreadyRunning: true,
      queued: !runningTask,
      queuePosition: queuedTask?.position ?? 0
    }
  }
  const currentRunRecord = withRunRecord ? (await saveAndGetCurrentRunRecord())?.data : null
  const subProcessEnv = {
    ...process.env,
    GEEKGEEKRUND_NO_AUTO_RESTART_EXIT_CODE: [
      AUTO_CHAT_ERROR_EXIT_CODE.PUPPETEER_IS_NOT_EXECUTABLE,
      AUTO_CHAT_ERROR_EXIT_CODE.LOGIN_STATUS_INVALID,
      AUTO_CHAT_ERROR_EXIT_CODE.LLM_UNAVAILABLE,
      AUTO_CHAT_ERROR_EXIT_CODE.MESSAGE_SEND_UNCONFIRMED,
      AUTO_CHAT_ERROR_EXIT_CODE.NO_MATCHING_JOBS,
      AUTO_CHAT_ERROR_EXIT_CODE.JOB_PAGE_NOT_READY,
      ...extraNoAutoRestartExitCodes
    ].join(',')
  }
  const taskArgs = [`--mode=${mode}`, `--run-record-id=${currentRunRecord?.id || 0}`]
  // recorded in the task history so a finished run links to the right data (chats or jobs)
  if (mode === 'geekAutoStartWithBossMain')
    taskArgs.push(`--run-mode=${readRunSettings(readConfigFile('boss.json')).runMode}`)
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
