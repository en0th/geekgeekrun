import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { openDevTools } from '../../commands'

const isMac = process.platform === 'darwin'

const appMenu: MenuItemConstructorOptions = {
  label: app.name,
  submenu: [
    { role: 'about' },
    { type: 'separator' },
    { role: 'services' },
    { type: 'separator' },
    { role: 'hide' },
    { role: 'hideOthers' },
    { role: 'unhide' },
    { type: 'separator' },
    { role: 'quit' }
  ]
}
const editItems: MenuItemConstructorOptions[] = isMac
  ? [
      { role: 'pasteAndMatchStyle' },
      { role: 'delete' },
      { role: 'selectAll' },
      { type: 'separator' },
      { label: 'Speech', submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] }
    ]
  : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }]

const template: MenuItemConstructorOptions[] = [
  // { role: 'appMenu' }
  ...(isMac ? [appMenu] : []),
  {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      ...editItems,
      { type: 'separator' }
    ]
  },
  {
    role: 'help',
    submenu: [
      {
        label: '为当前窗口打开调试工具',
        accelerator: 'CommandOrControl+Shift+I',
        click(_, win) {
          if (win instanceof BrowserWindow) openDevTools(win)
        }
      }
    ]
  }
]
const menu = Menu.buildFromTemplate(template)
Menu.setApplicationMenu(menu)
