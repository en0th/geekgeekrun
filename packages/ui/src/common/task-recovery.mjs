import { isResumableTaskExit } from '@geekgeekrun/pm/task-exit.cjs'

const AUTO = 'geekAutoStartWithBossMain'
const knownSetupExits = new Set([81, 82, 83, 84, 85, 98])
const codeOf = value => Number.isSafeInteger(value) && value >= 0 ? value : null

// A checkpoint is not, by itself, permission to repeat an unfinished send.
// History also protects checkpoints written by versions without confirmation metadata.
export function checkpointRecovery(checkpoint, { history = [] } = {}) {
  const id = Number(checkpoint?.runRecordId)
  if (!['number', 'string'].includes(typeof checkpoint?.runRecordId) || !Number.isSafeInteger(id) || id <= 0)
    return { canResume: false, reason: 'missing', code: null }
  if (!['chat', 'collect'].includes(checkpoint.runMode) ||
    (checkpoint.messageSendPending !== undefined && typeof checkpoint.messageSendPending !== 'boolean') ||
    (checkpoint.recoveryReason !== undefined && !['source-missing', 'safety-guard'].includes(checkpoint.recoveryReason)) ||
    (checkpoint.exitCode != null && codeOf(checkpoint.exitCode) === null))
    return { canResume: false, reason: 'unconfirmed-checkpoint', code: null }
  const startedAt = checkpoint.progress?.startedAt
  const last = history.find(entry => entry.workerId === AUTO && Number(entry.runRecordId) === id &&
    (!Number.isFinite(startedAt) || !Number.isFinite(entry.startedAt) || entry.startedAt >= startedAt))
  const savedCode = codeOf(checkpoint.exitCode)
  const historyCode = codeOf(last?.code)
  const code = savedCode !== null && (!last?.endedAt || Number(checkpoint.savedAt) >= last.endedAt)
    ? savedCode : historyCode ?? savedCode
  if (checkpoint.messageSendPending === true || code === 87)
    return { canResume: false, reason: 'send-unconfirmed', code: 87 }
  if (checkpoint.recoveryReason === 'safety-guard')
    return { canResume: false, reason: 'safety-guard', code }
  if (code === 92) return { canResume: false, reason: 'completed', code }
  const canResume = code === 0 || code === 90 || knownSetupExits.has(code) || isResumableTaskExit(AUTO, code)
    || (code === null && (checkpoint.messageSendPending === false || checkpoint.runMode === 'collect'))
  return { canResume, reason: canResume ? 'paused' : 'unconfirmed-checkpoint', code }
}

export function assertCheckpointCanResume(checkpoint, { runRecordId, runMode, history = [] } = {}) {
  const recovery = checkpointRecovery(checkpoint, { history })
  if (!checkpoint || Number(checkpoint.runRecordId) !== Number(runRecordId) || recovery.reason === 'missing')
    throw new Error('没有可以继续的找岗位任务，请重新加载任务列表。')
  if (!recovery.canResume)
    throw new Error(recovery.reason === 'safety-guard' ? '保护检查已阻止不应发生的操作，此任务不能直接继续。请保留数据并反馈问题。' : recovery.reason === 'send-unconfirmed'
      ? '上次发送结果尚未确认，请先在BOSS会话中核对。此任务不能直接继续；已保存的数据会保留。'
      : '无法确认这次任务是否可以安全继续。请查看任务详情，保留现有数据，确认后新建任务。')
  if (!['chat', 'collect'].includes(checkpoint.runMode) || (runMode && checkpoint.runMode !== runMode))
    throw new Error('继续任务需要保持原来的只收集或打招呼方式，请切回原方式，或新建任务。')
  return recovery
}
