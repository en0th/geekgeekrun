import { RUN_PROFILES } from '@geekgeekrun/geek-auto-start-chat-with-boss/run-policy.mjs'

// Read the execution presets directly so help cannot drift when a preset changes.
export function runProfileHelp(key) {
  const profile = RUN_PROFILES[key]
  if (!profile) throw new Error('无法识别运行模式')
  return [
    `加载下一批后等待：${profile.listSeconds}秒。`,
    `查看岗位详情后等待：${profile.detailSeconds}—${profile.detailSeconds + 1}秒，含0—1秒随机等待。`,
    `每轮最多读取${profile.budget.requests}次，其中详情最多${profile.budget.detailRequests}次；失败和重试也计入。`,
    `每轮累计运行最多${profile.budget.activeMinutes}分钟，含等待和定时休息，暂停、验证与断网重试等待不计。`,
    '读取次数不是成功打招呼人数。每日目标、定时休息按下方设置执行；网络或页面超时会自动重试，来源查完、平台限制或须核对的异常会停止。',
    key === 'deep' ? '与安全模式速度相同，允许查得更久、更多；筛选条件不变。'
      : key === 'fast' ? '间隔更短，更容易触发验证码、限流或账号限制。' : '适合日常使用，仍可能遇到平台验证。',
  ].join('\n')
}
