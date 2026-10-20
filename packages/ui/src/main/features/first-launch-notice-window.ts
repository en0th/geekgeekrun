import fs from 'fs'
import path from 'path'
import buildInfo from '../../common/build-info.json'
import {
  ensureStorageFileExist,
  storageFilePath
} from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { createFirstLaunchNoticeWindow } from '../window/firstLaunchNoticeWindow'
import { ipcMain } from 'electron'

export const firstLaunchNoticeApproveFlagPath = path.join(
  storageFilePath,
  'ui-first-launch-notice-flag'
)

export const isFirstLaunchNoticeApproveFlagExist = () =>
  fs.existsSync(firstLaunchNoticeApproveFlagPath)
export const createFirstLaunchNoticeApproveFlag = () => {
  ensureStorageFileExist()
  fs.writeFileSync(firstLaunchNoticeApproveFlagPath, buildInfo.version)
}
export async function waitForUserApproveAgreement({ windowOption }: {
  windowOption?: Electron.BrowserWindowConstructorOptions
} = {}): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const window = createFirstLaunchNoticeWindow({ ...windowOption })
    let processDone = false
    function handler() {
      processDone = true
      window.close()
    }
    ipcMain.once('first-launch-notice-approve', handler)
    window.once('closed', () => {
      ipcMain.off('first-launch-notice-approve', handler)
      if (processDone) {
        resolve(true)
      } else {
        reject(new Error('USER_CANCELLED'))
      }
    })
  })
}
