const copy = value => JSON.parse(JSON.stringify(value))
// request settings live on each llm.json entry; the settings page edits them once for both models
export const AI_REQUEST_DEFAULTS = { requestTimeoutSeconds: 120, maxRetries: 3, thinkingEnabled: true }
export const AI_TIMEOUT_SECONDS_RANGE = [10, 600]
export const AI_MAX_RETRIES_RANGE = [0, 10]
const intInRange = (value, [min, max]) => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isInteger(n) && n >= min && n <= max ? n : null
}
export function aiRequestSettings(model = {}) {
  return {
    requestTimeoutSeconds:
      intInRange(model.requestTimeoutSeconds, AI_TIMEOUT_SECONDS_RANGE) ?? AI_REQUEST_DEFAULTS.requestTimeoutSeconds,
    maxRetries: intInRange(model.maxRetries, AI_MAX_RETRIES_RANGE) ?? AI_REQUEST_DEFAULTS.maxRetries,
    thinkingEnabled:
      typeof model.thinkingEnabled === 'boolean' ? model.thinkingEnabled : AI_REQUEST_DEFAULTS.thinkingEnabled
  }
}
// options for packages/utils/gpt-request.mjs completes()
export function completionOptions(model) {
  const settings = aiRequestSettings(model)
  return {
    baseURL: model.providerCompleteApiUrl,
    apiKey: model.providerApiSecret,
    model: model.model,
    timeout: settings.requestTimeoutSeconds * 1000,
    maxRetries: settings.maxRetries,
    thinking: settings.thinkingEnabled
  }
}
// a new model starts as DeepSeek's deepseek-v4-pro; only the API key needs filling in
export const DEFAULT_MODEL = { preset: 'deepseek', model: 'deepseek-v4-pro', providerCompleteApiUrl: 'https://api.deepseek.com/v1' }
export function blankModel(role = 'primary') {
  return { id: 'model-' + role, role, enabled: role === 'primary', providerApiSecret: '', ...DEFAULT_MODEL }
}
// Existing arrays are interpreted in saved order, with explicit roles taking precedence.
// Reading never overwrites the original file; excess legacy entries are backed up on save.
export function modelPair(list = []) {
  const models = (Array.isArray(list) ? list : []).filter(m => m && typeof m === 'object')
  const primary = models.find(m => m.role === 'primary') || models.find(m => m.enabled) || models[0]
  const remaining = models.filter(m => m !== primary)
  const backup = remaining.find(m => m.role === 'backup') || remaining.find(m => m.enabled) || remaining[0]
  const pair = [primary || blankModel(), backup || blankModel('backup')].map((model, index) => {
    const result = copy(model)
    // a filled-in default, not a saved model; never picked for requests (and never saved, since
    // ux-save-models only writes known fields)
    if (model !== primary && model !== backup) result.placeholder = true
    delete result.serveWeight
    result.role = index === 0 ? 'primary' : 'backup'
    result.enabled = index === 0 || Boolean(model.enabled)
    result.id = result.id || 'model-' + result.role
    Object.assign(result, aiRequestSettings(result))
    return result
  })
  if (pair[0].id === pair[1].id) pair[1].id = pair[0].id + '-backup'
  return pair
}
export function pickModel(list, blocked = new Set(), allowedIds) {
  const candidates = modelPair(list)
  return candidates.find(m => !m.placeholder && m.enabled && m.model?.trim() && m.providerCompleteApiUrl?.trim() && (!allowedIds?.length || allowedIds.includes(m.id)) && !blocked.has(m.id)) || null
}
export function validModels(list) {
  if (!Array.isArray(list) || !list.length) return '请填写首选模型。'
  if (list.length > 2) return '最多配置一个首选模型和一个备用模型。'
  if (!list[0]?.enabled) return '请启用首选模型。'
  if (list.length > 1 && list[0]?.id === list[1]?.id) return '首选与备用模型的标识不能重复。'
  for (const [index, model] of list.entries()) {
    if (!model || typeof model !== 'object') return '模型配置无效。'
    if (!model.enabled) continue
    const label = index === 0 ? '首选模型' : '备用模型'
    if (!String(model.model || '').trim()) return label + '需填写模型名称。'
    try {
      const url = new URL(model.providerCompleteApiUrl)
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw Error()
    } catch { return label + '需填写完整的 http(s) 接口地址。' }
    if (model.requestTimeoutSeconds != null && intInRange(model.requestTimeoutSeconds, AI_TIMEOUT_SECONDS_RANGE) === null)
      return `请求超时需为 ${AI_TIMEOUT_SECONDS_RANGE[0]}–${AI_TIMEOUT_SECONDS_RANGE[1]} 秒的整数。`
    if (model.maxRetries != null && intInRange(model.maxRetries, AI_MAX_RETRIES_RANGE) === null)
      return `重试次数需为 ${AI_MAX_RETRIES_RANGE[0]}–${AI_MAX_RETRIES_RANGE[1]} 的整数。`
  }
  return ''
}
export function parseAiMessage(content) {
  if (typeof content !== 'string') throw new Error('AI返回了空消息')
  const value = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))?.response
  if (typeof value !== 'string' || !value.trim()) throw new Error('AI返回了空消息')
  const text = value.trim().replace(/。$/, '')
  if (!text) throw new Error('AI返回了空消息')
  return text
}
