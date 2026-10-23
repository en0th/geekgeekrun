import { checkpointRecovery } from './task-recovery.mjs'
import { normalizeRunBudget } from '@geekgeekrun/geek-auto-start-chat-with-boss/run-settings.mjs'

export function runBudgetHasRoom(limits, usage) {
  if (!usage || !['requests', 'detailRequests', 'activeMs'].every(key => Number.isFinite(usage[key]) && usage[key] >= 0)) return false
  try {
    const budget = normalizeRunBudget(limits)
    return (!budget.requests || usage.requests < budget.requests) &&
      (!budget.detailRequests || usage.detailRequests < budget.detailRequests) &&
      (!budget.activeMinutes || usage.activeMs < budget.activeMinutes * 60000)
  } catch { return false }
}

const plans = {
  0: ['已暂停，随时可以继续', '这次查找已经停下，已保存的岗位、进度和累计用量保留。', '准备好后继续运行，将按当前条件接着查找。', 'continue', '继续运行'],
  81: ['先重新登录BOSS', '登录凭证已失效，查找已停下。', '用这次任务原来的BOSS账号登录，再回来继续。', 'login', '重新登录BOSS'],
  82: ['先重新登录BOSS', 'BOSS登录已失效，查找已停下。', '用这次任务原来的BOSS账号登录，再回来继续。', 'login', '重新登录BOSS'],
  83: ['先检查网络连接', '任务无法连接BOSS，已暂停。', '确认网络可以打开BOSS后，再继续运行。', 'boss-site', '打开BOSS检查'],
  84: ['先检查BOSS页面', 'BOSS暂时拒绝访问，任务已停止。', '打开BOSS查看登录或验证提示，处理后再继续。', 'boss-site', '打开BOSS检查'],
  85: ['先检查浏览器', '任务浏览器未能启动，查找已停下。', '选择可以正常打开的浏览器，再回来继续。', 'browser', '检查浏览器设置'],
  86: ['先检查AI服务', '消息服务暂时不可用，任务已停止。', '检查模型连接和配置，确认可用后重新开始。', 'ai', '检查AI设置'],
  88: ['先核对查找条件', '连续多批没有可处理的岗位，任务已暂停。', '核对求职条件和职位来源，再继续；系统不会替你放宽筛选。', 'preferences', '核对条件与来源'],
  89: ['先检查岗位页面', '岗位列表或详情暂时无法确认，任务已暂停。', '确认BOSS页面可以正常加载，再继续；未确认的岗位不会继续处理。', 'boss-site', '打开BOSS检查'],
  91: ['重新打开任务浏览器', '上次验证窗口已关闭，任务进度已保留。', '继续后会重新打开任务浏览器；如需验证，请在该窗口完成。', 'continue', '重新打开任务浏览器'],
  93: ['先检查BOSS访问状态', '暂时无法确认BOSS页面状态，登录凭证仍保留。', '打开BOSS检查登录与验证提示，处理后再回来继续。', 'boss-site', '打开BOSS检查'],
  94: ['先切回原来的BOSS账号', '当前账号与这次任务开始时的账号不同，已暂停。', '切回原账号后继续；如要使用新账号，请结束这次任务并新建。', 'login', '检查BOSS账号'],
  95: ['先核对页面城市筛选', 'BOSS页面上的城市选择未能确认，已暂停。', '核对页面城市筛选后继续；原有求职条件仍然生效。', 'filters', '核对页面筛选'],
  97: ['先检查运行数据', '暂时无法确认累计用量，任务已暂停。', '检查原数据目录和浏览器是否可用，再继续；已用额度不会清零。', 'data', '检查数据目录'],
  98: ['先检查数据目录', '任务暂时无法读写数据，已停止。', '检查可用空间和读写权限，保留原文件；无法自行处理时可反馈问题。', 'data', '检查数据目录'],
  99: ['先检查浏览器显示方式', '后台窗口状态未能确认，任务已暂停。', '可以改为显示普通浏览器窗口，再继续；不会改变筛选和运行方式。', 'display', '检查显示方式'],
  100: ['先核对BOSS页面筛选', '页面筛选没有得到确认，任务已暂停。', '核对薪资、经验、学历等页面条件，再继续；系统不会自动放宽范围。', 'filters', '核对页面筛选'],
  101: ['先检查浏览器和网络', '任务浏览器、页面或连接中断，查找已暂停。', '确认浏览器和网络可用后继续；如页面已关闭，继续会重新打开它。', 'browser', '检查浏览器设置'],
}

export function taskRecoveryGuidance({ checkpoint = null, history = [], code = null, progress = {},
  active = false, readError = false, currentMode, runBudget, task = 'auto' } = {}) {
  if (readError === 'service') return {
    kind: 'read-error', title: '暂时无法连接任务服务',
    message: '最新运行状态尚未确认，保留上次已知信息。',
    nextStep: '先重新读取；如仍无法连接，可退出并重新打开应用。重新读取不会清空已有数据。',
    primaryAction: 'reload', primaryLabel: '重新读取状态', secondaryAction: 'feedback', secondaryLabel: '反馈问题', canContinue: false,
  }
  if (active) return progress.state === 'paused' ? {
    kind: 'verification', title: '请在任务浏览器中完成验证',
    message: '任务正在等你完成BOSS安全验证，已有进度保留。',
    nextStep: '切换到自动打开的BOSS窗口完成验证，完成后自动继续，无需重新开始。',
    primaryAction: null, canContinue: false,
  } : null
  const recovery = checkpointRecovery(checkpoint, { history })
  const exitCode = recovery.code ?? code
  if (recovery.reason === 'send-unconfirmed' || exitCode === 87) return {
    kind: 'send-unconfirmed', title: '先核对上次发送结果',
    message: '上次消息是否发送成功还不能确认，任务保持停止。',
    nextStep: '先在BOSS会话核对结果。此任务不能直接继续；核对后可结束本次任务，再按需新建。已有数据保留。',
    primaryAction: 'boss-chat', primaryLabel: '去BOSS核对', canContinue: false,
  }
  if (readError) return {
    kind: 'read-error', title: '暂时读不到任务进度',
    message: '暂时无法读取最新任务信息，正在保留上次已知的状态。',
    nextStep: '先重新读取；如仍失败，请检查数据目录。暂不开始或继续任务，避免替换原有进度。',
    primaryAction: 'reload', primaryLabel: '重新读取进度', canContinue: false,
    secondaryAction: 'data', secondaryLabel: '检查数据目录',
  }
  if (recovery.reason === 'safety-guard') return {
    kind: 'safety-guard', title: '保护检查已拦住一次操作',
    message: '任务已停止，没有继续这次不符合运行方式或筛选条件的操作。',
    nextStep: '已有数据保留。请反馈问题供排查，本次任务不能直接继续。',
    primaryAction: 'feedback', primaryLabel: '反馈问题', canContinue: false,
  }
  if (checkpoint && !recovery.canResume) return {
    kind: recovery.reason, title: '这次任务需要先检查',
    message: '恢复信息不足，暂时不能确认是否可以安全继续。',
    nextStep: '保留现有数据和原文件，查看问题详情后反馈；也可在确认结果后结束本次任务。',
    primaryAction: 'feedback', primaryLabel: '反馈问题', canContinue: false,
  }
  if (checkpoint && currentMode && checkpoint.runMode !== currentMode) return {
    kind: 'mode-changed', title: '先切回这次任务的运行方式',
    message: `这次任务原来是${checkpoint.runMode === 'collect' ? '只收集岗位' : '自动打招呼'}，当前选择已不同。`,
    nextStep: '切回原方式后再继续；如想改用另一种方式，请结束这次任务并新建。',
    primaryAction: 'restore-mode', primaryLabel: checkpoint.runMode === 'collect' ? '切回只收集' : '切回自动打招呼', canContinue: false,
  }
  if (checkpoint?.recoveryReason === 'source-missing') return {
    kind: 'source-missing', title: '先选择可用的职位来源',
    message: '当前来源没有可用内容，任务已暂停。',
    nextStep: '核对已选来源；如BOSS没有求职期望，可在BOSS添加，或自行选择搜索、推荐等来源后继续。',
    primaryAction: 'sources', primaryLabel: '检查职位来源', canContinue: recovery.canResume,
  }
  if (task === 'follow' && exitCode === 91) return {
    kind: 'paused', title: '验证窗口已关闭', message: '消息跟进已停止，已保存的记录保留。',
    nextStep: '重新开始时会再次检查会话状态；如需安全验证，请在新打开的任务窗口完成。',
    primaryAction: 'restart', primaryLabel: '重新开始跟进', canContinue: false,
  }
  if (task === 'follow' && ![81, 82, 83, 84, 85, 86, 87, 91, 93, 94, 98, 101, null, 0].includes(exitCode)) return {
    kind: 'unknown', title: '消息跟进已停止', message: '这次任务的状态暂时无法确认。',
    nextStep: '请保留已有记录并查看问题详情；需要帮助时可反馈问题。',
    primaryAction: 'feedback', primaryLabel: '反馈问题', canContinue: false,
  }
  if (exitCode === 96) {
    const room = runBudgetHasRoom(runBudget, progress.budget?.usage ?? checkpoint?.progress?.budget?.usage)
    return {
      kind: 'budget', title: room ? '上限已调整，可以继续' : '本次查找已达到上限',
      message: '已保存的岗位、进度和累计用量保留。',
      nextStep: room ? '继续后用量接着累计，不会重新从零开始。' : '先调整本次上限，再继续运行；已用额度不会清零。',
      primaryAction: room ? 'continue' : 'limits', primaryLabel: room ? '继续运行' : '调整运行上限',
      canContinue: Boolean(checkpoint && recovery.canResume && room),
    }
  }
  if (exitCode === 92 || (!checkpoint && (exitCode === null || exitCode === 0))) return null
  const row = plans[exitCode] ?? (checkpoint && recovery.canResume ? plans[0] : null)
  if (!row) return {
    kind: 'unknown', title: '任务已停止，需要检查', message: '任务遇到暂时无法确认的异常。',
    nextStep: '先查看问题详情，保留已有数据；无法自行处理时可反馈问题。',
    primaryAction: 'feedback', primaryLabel: '反馈问题', canContinue: false,
  }
  return { kind: 'paused', title: row[0], message: task === 'follow' ? row[1].replaceAll('查找', '消息跟进') : row[1], nextStep: row[2],
    primaryAction: row[3], primaryLabel: row[4], canContinue: Boolean(checkpoint && recovery.canResume),
    canRestart: task === 'follow',
    continueLabel: task === 'auto' ? '处理后继续运行' : '重新开始',
  }
}
