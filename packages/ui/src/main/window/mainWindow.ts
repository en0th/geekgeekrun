import { BrowserWindow, shell, type BrowserWindowConstructorOptions } from 'electron'
import path from 'path'
import os from 'os'
import { nativeWindowMaterial } from '../../common/window-material.mjs'
import { openDevTools } from '../commands'
import { daemonEE } from '../flow/OPEN_SETTING_WINDOW/connect-to-daemon'
export let mainWindow: BrowserWindow | null = null

// tells the renderer that the window has a native glass material behind transparent areas
const NATIVE_GLASS_ARG = '--ggr-native-glass'

export function createMainWindow(): BrowserWindow {
  const material = nativeWindowMaterial(process.platform, os.release()) as BrowserWindowConstructorOptions
  const nativeGlass = material.backgroundColor === '#00000000'
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1280,
    show: false,
    autoHideMenuBar: true,
    frame: true,
    ...(process.platform === 'linux'
      ? {
          /* icon */
        }
      : {}),
    // Unsupported native materials (including Win10) use in-app renderer glass.
    ...material,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      additionalArguments: nativeGlass ? [NATIVE_GLASS_ARG] : []
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })
  mainWindow.on('ready-to-show', async () => {
    process.env.NODE_ENV === 'development' &&
      setTimeout(() => {
        mainWindow && openDevTools(mainWindow)
      }, 500)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (process.env.NODE_ENV === 'development' && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow!.once('closed', () => {
    mainWindow = null
  })
  daemonEE.on('message', (message) => {
    if (message.type === 'worker-to-gui-message') {
      mainWindow?.webContents?.send('worker-to-gui-message', message)
    }
  })
  daemonEE.on('error', (err) => {
    console.log(err)
  })
  return mainWindow!
}
