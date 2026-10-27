import { readRunSettings } from '@geekgeekrun/geek-auto-start-chat-with-boss/run-settings.mjs'

export function sourceRotationLabel(draft) {
  try {
    const settings = readRunSettings({ autoChatPerSourceSuccessLimit: draft.perSourceSuccessLimit, autoChatNoMatchStreakLimit: draft.noMatchStreakLimit })
    const rules = []
    if (settings.perSourceSuccessLimit > 0) rules.push(`每${draft.runMode === 'collect' ? '收集' : '成功打招呼'}${settings.perSourceSuccessLimit}个岗位后切换来源`)
    if (settings.noMatchStreakLimit > 0) rules.push(`连续不符合条件${settings.noMatchStreakLimit}个岗位后切换来源`)
    return rules.join('；') || '不按岗位数量提前切换'
  } catch { return '请检查来源切换数量' }
}
