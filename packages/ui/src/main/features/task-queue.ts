// Worker side of the daemon's serial BOSS task queue (packages/pm/daemon.js).
import { sendToDaemon } from '../flow/OPEN_SETTING_WINDOW/connect-to-daemon'
import { TASK_YIELD_EXIT_CODE } from '../../common/enums/auto-start-chat'

/**
 * Called at a safe point between units of work. When another task is queued, the daemon
 * asks long-running tasks to make way; this one then cleans up and exits with
 * TASK_YIELD_EXIT_CODE, and the daemon restarts it once its turn comes round again.
 */
export async function yieldIfRequested(beforeExit: () => Promise<unknown> | unknown) {
  const response = (await Promise.resolve(
    sendToDaemon(
      { type: 'check-should-yield', workerId: process.env.GEEKGEEKRUND_WORKER_ID },
      { needCallback: true }
    )
  ).catch(() => null)) as { shouldYield?: boolean } | null
  if (!response?.shouldYield) return
  try {
    await beforeExit()
  } finally {
    process.exit(TASK_YIELD_EXIT_CODE)
  }
}

const QUEUED_TASK_NAMES: Record<string, string> = {
  geekAutoStartWithBossMain: '自动化',
  readNoReplyAutoReminderMain: '消息跟进',
  jobStatusPollMain: '检查收藏职位状态'
}

/** names of BOSS tasks running or waiting; data-folder changes must wait for them */
export async function getBusyTaskNames(): Promise<string[]> {
  const status = (await sendToDaemon({ type: 'get-status' }, { needCallback: true })) as {
    workers?: { workerId: string }[]
    queue?: { workerId: string }[]
  } | null
  return [...(status?.workers ?? []), ...(status?.queue ?? [])]
    .map((it) => QUEUED_TASK_NAMES[it.workerId])
    .filter(Boolean)
}
