import { sendToDaemon } from "../flow/OPEN_SETTING_WINDOW/connect-to-daemon"

export async function checkShouldExit () {
    const shouldExitResponse = await sendToDaemon<{ shouldExit: boolean }>(
      {
        type: 'check-should-exit',
        workerId: process.env.GEEKGEEKRUND_WORKER_ID,
      },
      {
        needCallback: true
      }
    )
    return shouldExitResponse?.shouldExit
  }
