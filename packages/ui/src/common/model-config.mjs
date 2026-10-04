const copy = value => JSON.parse(JSON.stringify(value))
export function blankModel(role = 'primary') {
  return { id: 'model-' + role, role, enabled: role === 'primary', model: '', providerCompleteApiUrl: '', providerApiSecret: '', preset: 'custom' }
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
    delete result.serveWeight
    result.role = index === 0 ? 'primary' : 'backup'
    result.enabled = index === 0 || Boolean(model.enabled)
    result.id = result.id || 'model-' + result.role
    return result
  })
  if (pair[0].id === pair[1].id) pair[1].id = pair[0].id + '-backup'
  return pair
}
export function pickModel(list, blocked = new Set(), allowedIds) {
  const candidates = modelPair(list)
  return candidates.find(m => m.enabled && m.model?.trim() && m.providerCompleteApiUrl?.trim() && (!allowedIds?.length || allowedIds.includes(m.id)) && !blocked.has(m.id)) || null
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
