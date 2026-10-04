// Credentials stay in the main process. Config sent to a renderer has them blanked and
// replaced by a has* flag; a blank value coming back means "keep the saved one".
// Pure functions: callers pass the saved llm.json, which keeps this module free of file access.

type LlmModel = Record<string, unknown> & {
  id?: string
  model?: string
  providerCompleteApiUrl?: string
  providerApiSecret?: string
  hasProviderApiSecret?: boolean
}

const hostOf = (url: unknown) => {
  try {
    return new URL(String(url)).host
  } catch {
    return ''
  }
}

export function redactLlmConfigList(list: unknown): LlmModel[] {
  return (Array.isArray(list) ? list : []).map((model) => {
    if (!model || typeof model !== 'object') return model
    const { providerApiSecret, ...rest } = model as LlmModel
    return { ...rest, providerApiSecret: '', hasProviderApiSecret: Boolean(providerApiSecret) }
  })
}

function findSaved(model: LlmModel, saved: LlmModel[]) {
  return (
    (model.id && saved.find((it) => it?.id === model.id)) ||
    // legacy entries without an id get a fresh one on every load
    saved.find(
      (it) =>
        it?.providerCompleteApiUrl === model.providerCompleteApiUrl && it?.model === model.model
    )
  )
}

/**
 * Fill blank secrets from llm.json. The saved secret is reused only for the same API host,
 * so changing the provider address never sends the old provider's key to the new one.
 */
export function restoreLlmSecrets(list: LlmModel[], saved: unknown): LlmModel[] {
  const savedList = Array.isArray(saved) ? (saved as LlmModel[]) : []
  return list.map((model) => {
    const result = { ...model }
    delete result.hasProviderApiSecret
    if (result.providerApiSecret) return result
    const previous = findSaved(model, savedList)
    if (
      previous?.providerApiSecret &&
      hostOf(previous.providerCompleteApiUrl) === hostOf(model.providerCompleteApiUrl)
    ) {
      result.providerApiSecret = previous.providerApiSecret
    }
    return result
  })
}

/** Whether a blank secret would be dropped because the API host changed. */
export function llmSecretsLostByHostChange(list: LlmModel[], saved: unknown) {
  const restored = restoreLlmSecrets(list, saved)
  return list.some(
    (model, index) =>
      model.enabled !== false &&
      model.hasProviderApiSecret &&
      !model.providerApiSecret &&
      !restored[index].providerApiSecret
  )
}

type Obj = Record<string, unknown>
const asObj = (value: unknown): Obj | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : null

/** Config file contents as a renderer may see them. */
export function redactConfigForRenderer(config: Obj): Obj {
  const result: Obj = { ...config }
  if ('llm.json' in result) result['llm.json'] = redactLlmConfigList(result['llm.json'])
  const dingtalk = asObj(result['dingtalk.json'])
  if (dingtalk) {
    const { groupRobotAccessToken, ...rest } = dingtalk
    result['dingtalk.json'] = {
      ...rest,
      groupRobotAccessToken: '',
      hasGroupRobotAccessToken: Boolean(groupRobotAccessToken)
    }
  }
  const boss = asObj(result['boss.json'])
  const autoReminder = asObj(boss?.autoReminder)
  if (boss && autoReminder && 'geminiApiKey' in autoReminder) {
    const { geminiApiKey, ...rest } = autoReminder
    result['boss.json'] = {
      ...boss,
      autoReminder: { ...rest, hasGeminiApiKey: Boolean(geminiApiKey) }
    }
  }
  return result
}

/** autoReminder as written back by a page that only saw the redacted copy. */
export function keepAutoReminderSecrets(next: unknown, previous: unknown) {
  const value = asObj(next)
  if (!value) return next
  const result = { ...value }
  delete result.hasGeminiApiKey
  const saved = asObj(previous)?.geminiApiKey
  if (!result.geminiApiKey && saved) result.geminiApiKey = saved
  return result
}
