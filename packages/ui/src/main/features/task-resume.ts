// The last 找岗位 run's position, skipped jobs and progress, kept so 任务列表 → 继续任务 can go
// on with that run instead of starting over. Written synchronously: it is also saved on exit.
import fs from 'node:fs'
import path from 'node:path'
import { storageFilePath } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { writeJsonAtomicSync } from '@geekgeekrun/utils/atomic-json.mjs'

const FILE_NAME = 'auto-chat-resume.json'
const filePath = () => path.join(storageFilePath, FILE_NAME)
// runs the user terminated: their saved state is never offered or resumed again, even if a
// late write from the exiting task or an older copy of the data folder brings the file back
const TERMINATED_FILE_NAME = 'auto-chat-terminated.json'
const terminatedFilePath = () => path.join(storageFilePath, TERMINATED_FILE_NAME)
const TERMINATED_KEEP = 200

function terminatedRunIds(folder = storageFilePath, { strict = false } = {}): number[] {
  let text: string
  try {
    text = fs.readFileSync(path.join(folder, TERMINATED_FILE_NAME), 'utf8')
  } catch (error) {
    if (strict && (error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw Object.assign(new Error('暂时无法确认任务结束记录，请检查数据目录；原文件已保留。'), { code: 'GGR_FILE_READ_FAILED' })
    return []
  }
  try {
    const list = JSON.parse(text)
    if (strict && (!Array.isArray(list) || list.some(value =>
      !['number', 'string'].includes(typeof value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0)))
      throw new Error('invalid termination record')
    return Array.isArray(list) ? list.map(Number).filter((n) => n > 0) : []
  } catch {
    if (strict) throw Object.assign(new Error('任务结束记录无法确认，请保留原文件并检查数据目录。'), { code: 'GGR_JSON_INVALID' })
    return []
  }
}

export function isAutoChatRunTerminated(runRecordId: unknown, { strict = false } = {}) {
  const id = Number(runRecordId)
  return id > 0 && terminatedRunIds(storageFilePath, { strict }).includes(id)
}

/** remember that this run was terminated */
export function markAutoChatRunTerminated(runRecordId: unknown) {
  const id = Number(runRecordId)
  if (!(id > 0)) return
  const ids = terminatedRunIds().filter((it) => it !== id)
  ids.push(id)
  try {
    writeJsonAtomicSync(terminatedFilePath(), ids.slice(-TERMINATED_KEEP))
  } catch (err) {
    console.error('cannot save the terminated run', err)
  }
}

export interface AutoChatResumeState {
  runRecordId: number
  runMode: string
  savedAt: number
  exitCode?: number
  // Written before the actual click and cleared only after confirmed storage.
  messageSendPending?: boolean
  recoveryReason?: 'source-missing' | 'safety-guard'
  // the run stopped because its filter combination had nothing usable: go on after it
  skipCurrentFilter?: boolean
  // from exportRunState() of the worker core
  runState: unknown
  progress: Record<string, unknown>
}

// Freeze a zero-progress checkpoint before dispatch, including tasks that only queue or
// whose worker has not imported its browser code yet. Resume never calls this initializer.
export function initializeAutoChatResume(runRecordId: number, runMode: string, folder = storageFilePath) {
  if (!Number.isSafeInteger(runRecordId) || runRecordId <= 0 || !['chat', 'collect'].includes(runMode))
    throw new Error('无法初始化任务检查点：运行编号或方式无效')
  const now = Date.now()
  writeJsonAtomicSync(path.join(folder, FILE_NAME), {
    runRecordId, runMode, savedAt: now, runState: {}, messageSendPending: false,
    progress: { startedAt: now, viewed: 0, collected: 0, sent: 0, skipped: 0, marked: 0,
      state: 'queued', detail: '等待任务启动', runRecordId }
  })
  // A database restore can reuse an ID. Only an explicitly new run replaces its old
  // termination marker, after the fresh checkpoint has been safely written.
  const ids = terminatedRunIds(folder)
  if (ids.includes(runRecordId)) writeJsonAtomicSync(path.join(folder, TERMINATED_FILE_NAME), ids.filter(id => id !== runRecordId))
}

export function readAutoChatResume({ strict = false } = {}): AutoChatResumeState | null {
  let text: string
  try {
    text = fs.readFileSync(filePath(), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    if (strict) throw Object.assign(new Error('任务进度暂时无法读取，请检查数据目录后重试；原文件已保留。'), { code: 'GGR_FILE_READ_FAILED' })
    return null
  }
  try {
    const state = JSON.parse(text)
    if (!state || typeof state !== 'object' || Array.isArray(state) ||
      !['number', 'string'].includes(typeof state.runRecordId) || !Number.isSafeInteger(Number(state.runRecordId)) ||
      Number(state.runRecordId) <= 0 || !['chat', 'collect'].includes(state.runMode)) throw new Error('invalid checkpoint')
    const record = (value: unknown) => value !== null && typeof value === 'object' && !Array.isArray(value)
    if ((state.progress !== undefined && !record(state.progress)) ||
      (state.runState !== undefined && !record(state.runState))) throw new Error('invalid checkpoint')
    // a leftover of a terminated run: clean it up
    if (isAutoChatRunTerminated(state.runRecordId, { strict })) {
      discardAutoChatResume()
      return null
    }
    return state
  } catch {
    // Never forward JSON.parse messages: they can contain private file contents.
    if (strict) throw Object.assign(new Error('任务进度文件无法确认，原文件已保留。请保留现有数据，检查后重新读取。'), { code: 'GGR_JSON_INVALID' })
    return null
  }
}

/** the run was terminated, or a new run replaces it: it can no longer be resumed */
export function discardAutoChatResume() {
  try {
    fs.rmSync(filePath(), { force: true })
  } catch (err) {
    console.error('cannot remove the resume state', err)
  }
}

export function writeAutoChatResume(state: AutoChatResumeState, { required = false } = {}) {
  if (isAutoChatRunTerminated(state.runRecordId, { strict: required })) {
    if (required) throw new Error('AUTO_CHAT_TASK_STOPPING')
    return
  }
  try {
    writeJsonAtomicSync(filePath(), state)
  } catch (err) {
    if (required) throw Object.assign(new Error('无法确认任务进度已保存，已停止后续操作。请检查数据目录的空间和读写权限。'), {
      code: 'GGR_FILE_WRITE_FAILED', atomicCommitted: Boolean((err as { atomicCommitted?: boolean }).atomicCommitted)
    })
    console.error('cannot save the resume state', err)
  }
}
