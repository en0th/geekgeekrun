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

function terminatedRunIds(folder = storageFilePath): number[] {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(folder, TERMINATED_FILE_NAME), 'utf8'))
    return Array.isArray(list) ? list.map(Number).filter((n) => n > 0) : []
  } catch {
    return []
  }
}

export function isAutoChatRunTerminated(runRecordId: unknown) {
  const id = Number(runRecordId)
  return id > 0 && terminatedRunIds().includes(id)
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
    runRecordId, runMode, savedAt: now, runState: {},
    progress: { startedAt: now, viewed: 0, collected: 0, sent: 0, skipped: 0, marked: 0,
      state: 'queued', detail: '等待任务启动', runRecordId }
  })
  // A database restore can reuse an ID. Only an explicitly new run replaces its old
  // termination marker, after the fresh checkpoint has been safely written.
  const ids = terminatedRunIds(folder)
  if (ids.includes(runRecordId)) writeJsonAtomicSync(path.join(folder, TERMINATED_FILE_NAME), ids.filter(id => id !== runRecordId))
}

export function readAutoChatResume(): AutoChatResumeState | null {
  try {
    const state = JSON.parse(fs.readFileSync(filePath(), 'utf8'))
    if (!state || !Number(state.runRecordId)) return null
    // a leftover of a terminated run: clean it up
    if (isAutoChatRunTerminated(state.runRecordId)) {
      discardAutoChatResume()
      return null
    }
    return state
  } catch {
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

export function writeAutoChatResume(state: AutoChatResumeState) {
  if (isAutoChatRunTerminated(state.runRecordId)) return
  try {
    writeJsonAtomicSync(filePath(), state)
  } catch (err) {
    console.error('cannot save the resume state', err)
  }
}
