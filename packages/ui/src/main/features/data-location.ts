// Moving the data folder (database, login state, caches). Takes effect after a restart.
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import {
  NON_PORTABLE_STORAGE_FILES,
  defaultStorageFolderPath,
  readDataLocation,
  resolveStorageFolder,
  writeDataLocation
} from '@geekgeekrun/geek-auto-start-chat-with-boss/data-location.mjs'
import { copyDatabase } from '../flow/OPEN_SETTING_WINDOW/utils/db'
import { getBusyTaskNames } from './task-queue'

const DB_FILE = 'public.db'
// copied through the database backup API instead of as plain files
const DB_FILES = [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm', DB_FILE + '-journal']

// resolved once: the folder this run of the app actually uses
const inUse = resolveStorageFolder()

export function getDataLocationInfo() {
  return {
    current: inUse.path,
    defaultPath: defaultStorageFolderPath,
    isDefault: !inUse.custom,
    // a custom folder that was missing at start; the default one is in use meanwhile
    fallbackFrom: inUse.fallbackFrom,
    configured: readDataLocation().storageDir || defaultStorageFolderPath
  }
}

const isInside = (child: string, parent: string) => {
  const rel = path.relative(parent, child)
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * mode copy: copies the current data into `targetDir` and uses it from the next start.
 * mode use-existing: switches to data already in `targetDir` (e.g. moved there by hand).
 * The old folder is left as it is.
 */
export async function changeDataLocation({
  targetDir,
  mode
}: {
  targetDir: string
  mode: 'copy' | 'use-existing'
}) {
  const target = path.normalize(String(targetDir ?? '').trim())
  if (!target || !path.isAbsolute(target)) throw new Error('请选择一个完整的文件夹路径')
  if (target === inUse.path) throw new Error('这已经是当前使用的数据目录')
  if (mode === 'copy' && (isInside(target, inUse.path) || isInside(inUse.path, target)))
    throw new Error('新目录不能位于当前数据目录之内，也不能包含当前数据目录')
  const busy = await getBusyTaskNames()
  if (busy.length) throw new Error(`请先停止正在运行或排队的任务：${busy.join('、')}`)

  fs.mkdirSync(target, { recursive: true })
  fs.accessSync(target, fs.constants.W_OK)
  const targetHasDb = fs.existsSync(path.join(target, DB_FILE))
  if (mode === 'use-existing') {
    if (!targetHasDb)
      throw new Error('该目录中没有数据库文件 public.db；如需带上现有数据，请选择“复制当前数据”')
  } else {
    if (targetHasDb)
      throw new Error(
        '该目录中已有数据库文件，为避免覆盖，请选择“使用该目录中的已有数据”或换一个空目录'
      )
    // the database first: it is the part that must be consistent
    await copyDatabase({ destPath: path.join(target, DB_FILE) })
    for (const entry of fs.readdirSync(inUse.path)) {
      if (DB_FILES.includes(entry) || NON_PORTABLE_STORAGE_FILES.includes(entry)) continue
      // old backups can be large; they stay where they are
      if (entry === 'backups') continue
      fs.cpSync(path.join(inUse.path, entry), path.join(target, entry), {
        recursive: true,
        errorOnExist: false,
        force: false
      })
    }
  }
  writeDataLocation(target)
  return { target, restartRequired: true }
}

export function relaunchApp() {
  setTimeout(() => {
    app.relaunch()
    app.exit(0)
  }, 300)
}
