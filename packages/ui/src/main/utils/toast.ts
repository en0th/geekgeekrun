// Shows a notice in the app's notification stack (renderer features/Toast) of every window.
import { BrowserWindow } from 'electron'

export interface AppToast {
  type: 'success' | 'info' | 'warning' | 'error'
  title?: string
  message: string
  duration?: number
}

export function sendToast(toast: AppToast) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('toast-message', toast)
  }
}
