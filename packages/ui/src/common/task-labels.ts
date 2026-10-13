// Names and outcome texts of the BOSS tasks, shared by the task page (renderer) and the
// 任务列表 table (run-data worker).
export const AUTO_CHAT_WORKER_ID = 'geekAutoStartWithBossMain'
export const FOLLOW_WORKER_ID = 'readNoReplyAutoReminderMain'
export const JOB_STATUS_POLL_WORKER_ID = 'jobStatusPollMain'

export const TASK_NAMES: Record<string, string> = {
  [AUTO_CHAT_WORKER_ID]: '找岗位',
  [FOLLOW_WORKER_ID]: '消息跟进',
  [JOB_STATUS_POLL_WORKER_ID]: '收藏检查'
}

/** 打招呼 / 只收集 for 找岗位, otherwise the task's own name */
export function taskModeLabel(workerId: string, runMode?: string | null) {
  if (workerId === AUTO_CHAT_WORKER_ID) return runMode === 'collect' ? '只收集' : '打招呼'
  return TASK_NAMES[workerId] ?? workerId
}

// why a task process ended, by exit code (see common/enums/auto-start-chat.ts)
export const EXIT_CODE_LABELS: Record<number, string> = {
  81: '登录凭证已失效',
  82: '登录状态已失效',
  83: '网络已断开',
  84: '平台拒绝访问或需要人工验证',
  85: '浏览器不可执行',
  86: 'AI服务不可用',
  87: '发送结果未确认，请先在BOSS中核对，避免重复发送',
  88: '连续检查5批岗位没有可处理岗位；调整条件后可恢复',
  89: '岗位列表或详情未能确认，已停止，未继续发送；请检查BOSS页面',
  91: '安全验证未完成（验证窗口已关闭）；可恢复任务后重新验证',
  92: '所有职位来源已轮换完成，任务正常结束'
}

export const OUTCOME_LABELS: Record<string, string> = {
  finished: '已完成',
  stopped: '已停止',
  failed: '出错结束',
  restarting: '出错，自动重启',
  yielded: '已让出'
}
