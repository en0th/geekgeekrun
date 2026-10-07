// Rows of the 任务列表 table: one per run, running / queued / paused ones and the ended ones.
// They live in a temporary table rebuilt from the daemon's state before each query, so the
// table gets the same search, filters, statistics and export as the data tables.
import { readAutoChatResume } from '../../../../../features/task-resume'
import {
  AUTO_CHAT_WORKER_ID,
  EXIT_CODE_LABELS,
  OUTCOME_LABELS,
  TASK_NAMES,
  taskModeLabel
} from '../../../../../../common/task-labels'
import type { Db } from './run-data'

interface DaemonTask {
  workerId: string
  args?: string[]
  uptime?: number
  position?: number
  queuedAt?: number
  reason?: string
  yielding?: boolean
}
interface HistoryEntry {
  id: string
  workerId: string
  startedAt: number
  endedAt: number
  outcome: string
  code: number | null
  runRecordId?: number | null
  runMode?: string | null
}
/** what the main process knows from the daemon (get-status) */
export interface TaskRunsContext {
  workers?: DaemonTask[]
  queue?: DaemonTask[]
  history?: HistoryEntry[]
}

const argOf = (args: string[] | undefined, name: string) =>
  (args ?? []).find((a) => String(a).startsWith(`--${name}=`))?.split('=')[1]
// dates are stored like the rest of the database: UTC "YYYY-MM-DD HH:mm:ss.SSS"
const dbDate = (ms?: number | null) =>
  ms ? new Date(ms).toISOString().replace('T', ' ').replace('Z', '') : null
const firstPart = (text: string) => text.split('；')[0]

export function taskRunRows(context: TaskRunsContext, now = Date.now()) {
  const rows: Record<string, unknown>[] = []
  const open = new Set<string>()
  const runKey = (workerId: string, runRecordId: unknown, fallback: string) =>
    Number(runRecordId) > 0 ? `${workerId}#${Number(runRecordId)}` : fallback
  const row = (r: {
    key: string
    phase: 'current' | 'history'
    workerId: string
    runRecordId?: unknown
    runMode?: string | null
    status: string
    startedAt?: number | null
    endedAt?: number | null
    note?: string
    code?: number | null
    position?: number | null
  }) => {
    const end = r.endedAt ?? now
    rows.push({
      key: r.key,
      phase: r.phase,
      workerId: r.workerId,
      runRecordId: Number(r.runRecordId) > 0 ? Number(r.runRecordId) : null,
      runMode: r.runMode ?? null,
      task: TASK_NAMES[r.workerId] ?? r.workerId,
      mode: taskModeLabel(r.workerId, r.runMode),
      status: r.status,
      startedAt: dbDate(r.startedAt),
      endedAt: dbDate(r.endedAt),
      // the same times in ms, for the run's data range in the details drawer
      startedMs: r.startedAt ?? null,
      endedMs: r.endedAt ?? null,
      durationMinutes: r.startedAt ? Math.max(0, Math.round((end - r.startedAt) / 60000)) : null,
      note: r.note ?? '',
      code: r.code ?? null,
      position: r.position ?? null
    })
  }

  for (const t of context.workers ?? []) {
    if (!(t.workerId in TASK_NAMES)) continue
    const id = argOf(t.args, 'run-record-id')
    const key = runKey(t.workerId, id, `run-${t.workerId}`)
    open.add(key)
    row({
      key,
      phase: 'current',
      workerId: t.workerId,
      runRecordId: id,
      runMode: argOf(t.args, 'run-mode'),
      status: t.yielding ? '准备让位' : '运行中',
      startedAt: now - (t.uptime ?? 0),
      endedAt: null
    })
  }
  for (const t of context.queue ?? []) {
    if (!(t.workerId in TASK_NAMES)) continue
    const id = argOf(t.args, 'run-record-id')
    const key = runKey(t.workerId, id, `queue-${t.workerId}`)
    open.add(key)
    row({
      key,
      phase: 'current',
      workerId: t.workerId,
      runRecordId: id,
      runMode: argOf(t.args, 'run-mode'),
      status:
        t.reason === 'yielded'
          ? '稍后继续'
          : t.reason === 'restarting'
            ? '出错，等待重启'
            : '排队中',
      startedAt: t.queuedAt,
      endedAt: null,
      note: `排第 ${t.position || 1} 位`,
      position: t.position
    })
  }

  // the history is newest first; a run that made way for another task has several parts
  const history = (context.history ?? []).filter((t) => t.workerId in TASK_NAMES)
  const resume = readAutoChatResume()
  const lastAuto = history.find((t) => t.workerId === AUTO_CHAT_WORKER_ID)
  // a 找岗位 run that is running or queued means nothing is paused
  const autoActive = [...(context.workers ?? []), ...(context.queue ?? [])].some(
    (t) => t.workerId === AUTO_CHAT_WORKER_ID
  )
  const pausedKey =
    resume &&
    !autoActive &&
    (!lastAuto || Number(lastAuto.runRecordId) === Number(resume.runRecordId))
      ? runKey(AUTO_CHAT_WORKER_ID, resume.runRecordId, '')
      : ''
  if (pausedKey && !open.has(pausedKey)) {
    open.add(pausedKey)
    const progress = (resume!.progress ?? {}) as { startedAt?: number }
    const code = lastAuto?.code ?? 0
    row({
      key: pausedKey,
      phase: 'current',
      workerId: AUTO_CHAT_WORKER_ID,
      runRecordId: resume!.runRecordId,
      runMode: resume!.runMode,
      status: '已暂停',
      startedAt: progress.startedAt ?? lastAuto?.startedAt,
      endedAt: resume!.savedAt,
      note: code ? firstPart(EXIT_CODE_LABELS[code] ?? `退出码 ${code}`) : '手动暂停',
      code
    })
  }
  const ended = new Map<string, HistoryEntry & { firstStartedAt: number }>()
  for (const t of history) {
    const key = runKey(t.workerId, t.runRecordId, t.id)
    if (open.has(key)) continue
    const run = ended.get(key)
    if (!run) ended.set(key, { ...t, firstStartedAt: t.startedAt })
    else run.firstStartedAt = Math.min(run.firstStartedAt, t.startedAt)
  }
  for (const [key, t] of ended) {
    // 找岗位 runs reach the history only by being terminated (a stop is a pause); a run that
    // rotated through every source finished successfully
    const auto = t.workerId === AUTO_CHAT_WORKER_ID
    const rotatedAll = auto && t.code === 92
    row({
      key,
      phase: 'history',
      workerId: t.workerId,
      runRecordId: t.runRecordId,
      runMode: t.runMode,
      status: rotatedAll ? '已完成' : auto ? '已终止' : OUTCOME_LABELS[t.outcome] ?? t.outcome,
      startedAt: t.firstStartedAt,
      endedAt: t.endedAt,
      note: t.code
        ? (auto && !rotatedAll ? '停下原因：' : '') + firstPart(EXIT_CODE_LABELS[t.code] ?? `退出码 ${t.code}`)
        : '',
      code: t.code
    })
  }
  return rows
}

const COLUMNS = [
  'key',
  'phase',
  'workerId',
  'runRecordId',
  'runMode',
  'task',
  'mode',
  'status',
  'startedAt',
  'endedAt',
  'startedMs',
  'endedMs',
  'durationMinutes',
  'note',
  'code',
  'position'
]

export function refreshTaskRuns(db: Db, context: TaskRunsContext = {}) {
  db.prepare(
    `CREATE TEMP TABLE IF NOT EXISTS task_runs (
      key TEXT PRIMARY KEY, phase TEXT, workerId TEXT, runRecordId INTEGER, runMode TEXT,
      task TEXT, mode TEXT, status TEXT, startedAt TEXT, endedAt TEXT, startedMs INTEGER, endedMs INTEGER, durationMinutes REAL,
      note TEXT, code INTEGER, position INTEGER)`
  ).run()
  const insert = db.prepare(
    `INSERT INTO temp.task_runs (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`
  )
  db.transaction(() => {
    db.prepare('DELETE FROM temp.task_runs').run()
    for (const r of taskRunRows(context)) insert.run(...COLUMNS.map((c) => r[c] ?? null))
  })()
}
