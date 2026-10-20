import { countFilterCombinations } from '@geekgeekrun/geek-auto-start-chat-with-boss/combineCalculator.mjs'

// The editor keeps all saved search rows. Single-search mode disables additional
// rows for execution without deleting their text from the user's draft/template.
import { hasSearchCriteria } from '@geekgeekrun/geek-auto-start-chat-with-boss/search-source.mjs'
// The cascader rebuilds its node store when this object changes identity.
export const positionCascaderProps = Object.freeze({ multiple: true, emitPath: false })
export const emptyPositionCodes = Object.freeze([])
export function isSearchRotationEnabled(draft) {
  if (typeof draft.searchRotation === 'boolean') return draft.searchRotation
  const search = draft.sourceList?.find((source) => source.type === 'search')
  return (search?.children || []).slice(1).some((row) => row.enabled && hasSearchCriteria(row))
}

export function searchOptionsForRun(draft, search) {
  const rotate = isSearchRotationEnabled(draft)
  return (search?.children || []).map((row, index) => ({
    ...row,
    enabled: Boolean(row.enabled && (index === 0 || rotate)),
    keyword: String(row.keyword || '').trim(),
    positionCodes: row.positionCodes == null ? [] : Array.isArray(row.positionCodes) ? [...row.positionCodes] : [row.positionCodes]
  }))
}

// How many sources the run will rotate through: every enabled search keyword is its
// own source, plus one per other enabled source. Used to decide whether the rotation
// settings (and their facts) are worth showing at all.
export function potentialSourceCount(draft) {
  let total = 0
  for (const source of draft?.sourceList || []) {
    if (!source?.enabled) continue
    if (source.type === 'search') {
      const words = searchOptionsForRun(draft, source).filter((row) => row.enabled && hasSearchCriteria(row)).length
      total += Math.max(words, 1)
    } else {
      total += 1
    }
  }
  return total
}

export function countPlatformCombinations(filters = {}, skipEmpty = false) {
  return countFilterCombinations(filters, skipEmpty)
}
