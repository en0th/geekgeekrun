// Log storage settings, shared by every process's console override and the settings UI.

export const LOG_SETTINGS_FILE = 'log.json'
// lowest to highest; a level keeps itself and everything above it
export const LOG_LEVELS = ['trace', 'debug', 'info', 'warning', 'error']
export const LOG_LEVEL_LABELS = {
  trace: '跟踪（trace）',
  debug: '调试（debug）',
  info: '信息（info）',
  warning: '警告（warning）',
  error: '错误（error）'
}
export const DEFAULT_LOG_SETTINGS = { enabled: true, level: 'info' }
// daily files older than this are removed
export const LOG_RETENTION_DAYS = 14

export function readLogSettings(saved) {
  saved = saved && typeof saved === 'object' ? saved : {}
  return {
    enabled: typeof saved.enabled === 'boolean' ? saved.enabled : DEFAULT_LOG_SETTINGS.enabled,
    level: LOG_LEVELS.includes(saved.level) ? saved.level : DEFAULT_LOG_SETTINGS.level
  }
}

/** whether a message of `level` is written when the threshold is `threshold` */
export function shouldWriteLog(settings, level) {
  return settings.enabled && LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(settings.level)
}

const pad = (n) => String(n).padStart(2, '0')
export const logFileName = (date) =>
  `app-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.log`

/** daily log files past the retention period, given today's date */
export function expiredLogFiles(names, today, days = LOG_RETENTION_DAYS) {
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days)
  const keepFrom = logFileName(cutoff)
  return names.filter((n) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(n) && n < keepFrom)
}
