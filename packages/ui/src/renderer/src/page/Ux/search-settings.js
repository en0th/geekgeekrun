import { countFilterCombinations } from '@geekgeekrun/geek-auto-start-chat-with-boss/combineCalculator.mjs'

// The editor keeps all saved search rows. Single-search mode disables additional
// rows for execution without deleting their text from the user's draft/template.
import { hasSearchCriteria } from '@geekgeekrun/geek-auto-start-chat-with-boss/search-source.mjs'
import { normalizeCompanyBrandId } from '@geekgeekrun/geek-auto-start-chat-with-boss/company-source.mjs'
// The cascader rebuilds its node store when this object changes identity.
export const positionCascaderProps = Object.freeze({ multiple: true, emitPath: false })
export const emptyPositionCodes = Object.freeze([])
export function ensureCompanySource(draft) {
  if (Array.isArray(draft.sourceList) && !draft.sourceList.some(source => source.type === 'company'))
    draft.sourceList.push({ type: 'company', enabled: false, children: [{ enabled: true, brandId: '', keyword: '', label: '' }] })
  return draft
}
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
// own source, as does every distinct company/keyword pair. Used to decide whether the rotation
// settings (and their facts) are worth showing at all.
export function potentialSourceCount(draft) {
  let total = 0
  for (const source of draft?.sourceList || []) {
    if (!source?.enabled) continue
    if (source.type === 'search') {
      const words = searchOptionsForRun(draft, source).filter((row) => row.enabled && hasSearchCriteria(row)).length
      total += Math.max(words, 1)
    } else if (source.type === 'company') {
      const keys = new Set()
      for (const row of source.children || []) if (row.enabled) {
        try { keys.add(JSON.stringify([normalizeCompanyBrandId(row.brandId), String(row.keyword || '').trim()])) } catch {}
      }
      total += Math.max(keys.size, 1)
    } else {
      total += 1
    }
  }
  return total
}

export function countPlatformCombinations(filters = {}, skipEmpty = false) {
  return countFilterCombinations(filters, skipEmpty)
}
