// The last 找岗位 run's position, skipped jobs and progress, kept so 任务列表 → 继续任务 can go
// on with that run instead of starting over. Written synchronously: it is also saved on exit.
import fs from 'node:fs'
import path from 'node:path'
import { storageFilePath } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'

const FILE_NAME = 'auto-chat-resume.json'
const filePath = () => path.join(storageFilePath, FILE_NAME)

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

export function readAutoChatResume(): AutoChatResumeState | null {
  try {
    const state = JSON.parse(fs.readFileSync(filePath(), 'utf8'))
    return state && Number(state.runRecordId) ? state : null
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
  try {
    fs.writeFileSync(filePath(), JSON.stringify(state))
  } catch (err) {
    console.error('cannot save the resume state', err)
  }
}
