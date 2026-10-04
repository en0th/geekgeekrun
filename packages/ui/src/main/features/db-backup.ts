// Scheduled and manual database backups, the backup list and restoring one on next start.
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import {
  getPublicDbFilePath,
  readConfigFile,
  readStorageFile,
  storageFilePath,
  writeConfigFile,
  writeStorageFile
} from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import {
  DB_BACKUP_INTERVAL_HOURS,
  DB_BACKUP_KEEP_RANGE,
  DB_BACKUP_LAST_RUN_FILE,
  DB_BACKUP_SETTINGS_FILE,
  DB_RESTORE_PENDING_FILE,
  isBackupDue,
  isBackupFileName,
  readDbBackupSettings
} from '../../common/db-backup.mjs'
import { backupDatabase } from '../flow/OPEN_SETTING_WINDOW/utils/db'
import { getBusyTaskNames } from './task-queue'

const SCHEDULER_TICK_MS = 10 * 60 * 1000

export const defaultBackupDir = () => path.join(storageFilePath, 'backups')

export function getDbBackupSettings() {
  return readDbBackupSettings(readConfigFile(DB_BACKUP_SETTINGS_FILE))
}
const backupDirOf = (settings: { dir: string }) =>
  settings.dir && path.isAbsolute(settings.dir) ? settings.dir : defaultBackupDir()

export async function saveDbBackupSettings(payload: unknown) {
  const settings = readDbBackupSettings(payload)
  if (settings.dir && !path.isAbsolute(settings.dir)) throw new Error('备份目录必须是完整路径')
  await writeConfigFile(DB_BACKUP_SETTINGS_FILE, settings)
  return settings
}

interface LastRun {
  at: number
  ok: boolean
  name?: string
  size?: number
  error?: string
  trigger: 'manual' | 'schedule'
}

let running: Promise<LastRun> | null = null
export function runDbBackup(trigger: LastRun['trigger']) {
  // one backup at a time; a second request waits for the first one's result
  running ??= (async () => {
    const settings = getDbBackupSettings()
    let result: LastRun
    try {
      const { data } = await backupDatabase({
        dir: backupDirOf(settings),
        mode: settings.mode,
        keep: settings.keep
      })
      result = { at: Date.now(), ok: true, name: data.name, size: data.size, trigger }
    } catch (error) {
      result = {
        at: Date.now(),
        ok: false,
        error: (error as Error)?.message ?? String(error),
        trigger
      }
    }
    await writeStorageFile(DB_BACKUP_LAST_RUN_FILE, result)
    return result
  })().finally(() => {
    running = null
  })
  return running
}

export function listDbBackups() {
  const dir = backupDirOf(getDbBackupSettings())
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter(isBackupFileName)
    .map((name) => {
      const stat = fs.statSync(path.join(dir, name))
      return { name, size: stat.size, modifiedAt: stat.mtimeMs }
    })
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
}

export function getDbBackupInfo() {
  const settings = getDbBackupSettings()
  return {
    settings,
    dir: backupDirOf(settings),
    defaultDir: defaultBackupDir(),
    intervalOptions: DB_BACKUP_INTERVAL_HOURS,
    keepRange: DB_BACKUP_KEEP_RANGE,
    lastRun: (readStorageFile(DB_BACKUP_LAST_RUN_FILE) as LastRun | null) || null,
    backups: listDbBackups(),
    // set once, on the start that applied a restore
    restoreResult
  }
}

export function startDbBackupScheduler() {
  const tick = async () => {
    try {
      const settings = getDbBackupSettings()
      const last = readStorageFile(DB_BACKUP_LAST_RUN_FILE) as LastRun | null
      // a failed attempt also waits for the next interval instead of retrying every tick
      if (isBackupDue(settings, last?.at ?? 0)) await runDbBackup('schedule')
    } catch (error) {
      console.log('db backup scheduler', error)
    }
  }
  setTimeout(tick, 2 * 60 * 1000)
  return setInterval(tick, SCHEDULER_TICK_MS)
}

const SQLITE_HEADER = 'SQLite format 3\0'
function isSqliteFile(file: string) {
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(SQLITE_HEADER.length)
    fs.readSync(fd, buf, 0, buf.length, 0)
    return buf.toString('latin1') === SQLITE_HEADER
  } finally {
    fs.closeSync(fd)
  }
}

/** the database is open while the app runs, so the copy happens on the next start */
export async function scheduleDbRestore(name: string) {
  if (!isBackupFileName(name)) throw new Error('只能恢复本程序生成的备份文件')
  const file = path.join(backupDirOf(getDbBackupSettings()), name)
  if (!fs.existsSync(file)) throw new Error('备份文件不存在，可能已被删除')
  if (!isSqliteFile(file)) throw new Error('备份文件已损坏，不是有效的数据库文件')
  const busy = await getBusyTaskNames()
  if (busy.length) throw new Error(`请先停止正在运行或排队的任务：${busy.join('、')}`)
  await writeStorageFile(DB_RESTORE_PENDING_FILE, { file, requestedAt: Date.now() })
  setTimeout(() => {
    app.relaunch()
    app.exit(0)
  }, 300)
  return { file }
}

/**
 * Runs at start, before anything opens the database. The current database is kept next to
 * the backups as public-before-restore-*.db so a restore can be undone by hand.
 */
let restoreResult: { ok: boolean; file: string; error?: string; at: number } | null = null

export function applyPendingDbRestore() {
  restoreResult = restore()
  return restoreResult
}

function restore() {
  const pendingPath = path.join(storageFilePath, DB_RESTORE_PENDING_FILE)
  if (!fs.existsSync(pendingPath)) return null
  let file = ''
  try {
    file = JSON.parse(fs.readFileSync(pendingPath, 'utf8'))?.file ?? ''
  } catch {
    //
  }
  fs.rmSync(pendingPath, { force: true })
  try {
    if (!file || !fs.existsSync(file) || !isSqliteFile(file)) throw new Error('备份文件不可用')
    const dbPath = getPublicDbFilePath()
    if (fs.existsSync(dbPath)) {
      const keepDir = path.dirname(file)
      fs.copyFileSync(dbPath, path.join(keepDir, `public-before-restore-${Date.now()}.db`))
    }
    fs.copyFileSync(file, dbPath + '.restoring')
    for (const suffix of ['-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true })
    fs.renameSync(dbPath + '.restoring', dbPath)
    return { ok: true, file, at: Date.now() }
  } catch (error) {
    console.error('db restore failed', error)
    return { ok: false, file, error: (error as Error)?.message, at: Date.now() }
  }
}
