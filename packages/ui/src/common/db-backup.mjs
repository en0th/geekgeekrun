// Database backup settings and file naming, shared by the main process and the settings UI.

export const DB_BACKUP_SETTINGS_FILE = 'db-backup.json'
export const DB_BACKUP_LAST_RUN_FILE = 'db-backup-last-run.json'
export const DB_RESTORE_PENDING_FILE = 'db-restore-pending.json'

export const DB_BACKUP_INTERVAL_HOURS = [6, 12, 24, 72, 168]
// rotate: a new dated file each time, the oldest beyond `keep` are removed
// overwrite: one file that each backup replaces
export const DB_BACKUP_MODES = ['rotate', 'overwrite']
export const DB_BACKUP_KEEP_RANGE = [1, 60]

export const DEFAULT_DB_BACKUP_SETTINGS = {
  enabled: false,
  intervalHours: 24,
  mode: 'rotate',
  keep: 7,
  // empty: the "backups" folder inside the data folder
  dir: ''
}

export function readDbBackupSettings(saved) {
  saved = saved && typeof saved === 'object' ? saved : {}
  const d = DEFAULT_DB_BACKUP_SETTINGS
  const keep = Number(saved.keep)
  return {
    enabled: typeof saved.enabled === 'boolean' ? saved.enabled : d.enabled,
    intervalHours: DB_BACKUP_INTERVAL_HOURS.includes(saved.intervalHours)
      ? saved.intervalHours
      : d.intervalHours,
    mode: DB_BACKUP_MODES.includes(saved.mode) ? saved.mode : d.mode,
    keep:
      Number.isInteger(keep) && keep >= DB_BACKUP_KEEP_RANGE[0] && keep <= DB_BACKUP_KEEP_RANGE[1]
        ? keep
        : d.keep,
    dir: typeof saved.dir === 'string' ? saved.dir.trim() : d.dir
  }
}

export const LATEST_BACKUP_FILE_NAME = 'public-latest.db'
const DATED_BACKUP_RE = /^public-(\d{8})-(\d{6})\.db$/

const pad = (n) => String(n).padStart(2, '0')
/** public-20261004-193000.db, in local time */
export function datedBackupFileName(date) {
  return (
    `public-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.db`
  )
}

/** backups this feature wrote; other files in the folder are never touched */
export function isBackupFileName(name) {
  return name === LATEST_BACKUP_FILE_NAME || DATED_BACKUP_RE.test(name)
}

/** dated backups beyond the newest `keep`, to delete after a rotate backup */
export function backupsToPrune(names, keep) {
  return names
    .filter((n) => DATED_BACKUP_RE.test(n))
    .sort()
    .reverse()
    .slice(Math.max(1, keep))
}

export function isBackupDue(settings, lastBackupAt, now = Date.now()) {
  if (!settings.enabled) return false
  if (!lastBackupAt) return true
  return now - lastBackupAt >= settings.intervalHours * 3600 * 1000
}
