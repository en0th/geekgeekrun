import { app, ipcMain, globalShortcut, nativeTheme } from 'electron'
import { startJobStatusPollScheduler } from '../../features/job-status-poll'
import { startScheduledRuns } from '../../features/scheduled-runs'
import { applyPendingDbRestore, startDbBackupScheduler } from '../../features/db-backup'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow, mainWindow } from '../../window/mainWindow'
import './app-menu'
import initIpc from './ipc'
import initPublicIpc from '../../utils/initPublicIpc'
import { sendToDaemon, closeDaemonClient, stopOwnedWorkers } from './connect-to-daemon'
import { installGuiShutdown } from '@geekgeekrun/utils/gui-shutdown.mjs'

export function openSettingWindow() {
  installGuiShutdown({ app, stopOwned: stopOwnedWorkers, disconnect: closeDaemonClient })
  // a restore chosen in the backup settings is applied before anything opens the database
  applyPendingDbRestore()

  const whenReadyPromise = app.whenReady()

  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  whenReadyPromise.then(() => {
    // Set app user model id for windows
    electronApp.setAppUserModelId('com.electron')
    // the UI is designed for light only; keep native materials (sidebar glass, menus) light too
    nativeTheme.themeSource = 'light'

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    createMainWindow()

    // IPC test
    ipcMain.on('ping', () => console.log('pong'))
    initPublicIpc()
    initIpc()
    // queues a job status poll for favourited jobs on the configured interval
    startJobStatusPollScheduler()
    // database backups on the configured interval (off unless enabled)
    startDbBackupScheduler()
    startScheduledRuns()

    const showMainWindow = () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (!mainWindow) { createMainWindow(); return }
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
    app.on('activate', showMainWindow)
    app.on('second-instance', showMainWindow)

  })

  // Quit when all windows are closed, except on macOS. There, it's common
  // for applications and their menu bar to stay active until the user quits
  // explicitly with Cmd + Q.
  app.on('window-all-closed', () => {
    app.quit()
  })

  // In this file you can include the rest of your app"s specific main process
  // code. You can also put them in separate files and require them here.

  // short cut
  whenReadyPromise.then(() => {
    // Register a 'Command+Option+Shift+/' shortcut listener.
    globalShortcut.register('Command+Option+Shift+/', () => {
      console.log('Command+Option+Shift+/ is pressed')
      app.quit()
    })
    app.once('quit', () => {
      globalShortcut.unregister('Command+Option+Shift+/')
    })
  })

  whenReadyPromise.then(async () => {
    await sendToDaemon(
      {
        type: 'ping'
      },
      {
        needCallback: true
      }
    )
    await sendToDaemon(
      {
        type: 'user-process-register'
      },
      {
        needCallback: true
      }
    )
  })
}
