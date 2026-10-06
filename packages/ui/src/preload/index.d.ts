import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: { nativeGlass: boolean }
  }
  declare const electron: Window['electron']
  declare const api: Window['api']
}
