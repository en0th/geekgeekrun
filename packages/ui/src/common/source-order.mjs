// Disabled sources keep their slots and settings; only enabled sources are reordered.
export function reorderEnabledSources(sources, order) {
  const enabled = sources.filter(source => source.enabled)
  if (order.length !== enabled.length || new Set(order).size !== enabled.length || order.some(type => !enabled.some(source => source.type === type)))
    throw new Error('来源顺序已变化，请重新拖动')
  const byType = new Map(enabled.map(source => [source.type, source]))
  let index = 0
  return sources.map(source => source.enabled ? byType.get(order[index++]) : source)
}
