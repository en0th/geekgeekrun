// Starting the job status poll task, by hand or on the configured interval.
import { readStorageFile } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import {
  JOB_STATUS_POLL_SETTINGS_FILE,
  readJobStatusPollSettings
} from '@geekgeekrun/geek-auto-start-chat-with-boss/run-settings.mjs'
import { runCommon } from './run-common'
import { AUTO_CHAT_ERROR_EXIT_CODE } from '../../common/enums/auto-start-chat'
import { JOB_STATUS_POLL_LAST_RUN_FILE } from './job-hire-status'
import { countJobStatusPollTargets } from '../flow/OPEN_SETTING_WINDOW/utils/db'

export const JOB_STATUS_POLL_MODE = 'jobStatusPollMain'
const SCHEDULER_TICK_MS = 10 * 60 * 1000

export function startJobStatusPoll() {
  return runCommon({
    mode: JOB_STATUS_POLL_MODE,
    withRunRecord: false,
    // a finite task: report these and stop instead of restarting
    extraNoAutoRestartExitCodes: [
      1,
      AUTO_CHAT_ERROR_EXIT_CODE.ACCESS_IS_DENIED,
      AUTO_CHAT_ERROR_EXIT_CODE.ERR_INTERNET_DISCONNECTED
    ]
  })
}

// when the scheduler last queued a poll; also stops retrying a failing poll every tick
let lastScheduledAt = 0

export function startJobStatusPollScheduler() {
  const tick = async () => {
    try {
      const settings = readJobStatusPollSettings(readStorageFile(JOB_STATUS_POLL_SETTINGS_FILE))
      if (!settings.enabled) return
      const lastFinishedAt = readStorageFile(JOB_STATUS_POLL_LAST_RUN_FILE)?.finishedAt ?? 0
      const interval = settings.intervalHours * 60 * 60 * 1000
      if (Date.now() - Math.max(lastFinishedAt, lastScheduledAt) < interval) return
      const { data } = (await countJobStatusPollTargets()) as { data: number }
      if (!data) return
      lastScheduledAt = Date.now()
      await startJobStatusPoll()
    } catch (error) {
      console.log('job status poll scheduler', error)
    }
  }
  setTimeout(tick, 60 * 1000)
  return setInterval(tick, SCHEDULER_TICK_MS)
}
