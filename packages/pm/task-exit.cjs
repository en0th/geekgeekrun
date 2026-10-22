// Keep normal source exhaustion distinct from a failed worker process.
const AUTO_CHAT_WORKER = 'geekAutoStartWithBossMain'
exports.isSuccessfulTaskExit = (workerId, code) =>
  code === 0 || (workerId === AUTO_CHAT_WORKER && code === 92)

exports.isResumableTaskExit = (workerId, code) =>
  workerId === AUTO_CHAT_WORKER && [88, 89, 91, 93, 94, 95, 96, 97, 99, 100, 101].includes(code)

// A paused finding task, or an unconfirmed send, needs a person's decision.
// This policy must survive callers that omit their environment exit-code list.
exports.requiresManualTaskRestart = (workerId, code) =>
  exports.isResumableTaskExit(workerId, code) || (workerId === AUTO_CHAT_WORKER && code === 87)
