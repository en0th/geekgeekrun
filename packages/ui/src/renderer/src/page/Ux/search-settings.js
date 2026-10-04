// The editor keeps all saved search rows. Single-search mode disables additional
// rows for execution without deleting their text from the user's draft/template.
export function isSearchRotationEnabled(draft) {
  if (typeof draft.searchRotation === 'boolean') return draft.searchRotation
  const search = draft.sourceList?.find((source) => source.type === 'search')
  return (search?.children || []).slice(1).some((row) => row.enabled && row.keyword?.trim())
}

export function searchOptionsForRun(draft, search) {
  const rotate = isSearchRotationEnabled(draft)
  return (search?.children || []).map((row, index) => ({
    ...row,
    enabled: Boolean(row.enabled && (index === 0 || rotate)),
    keyword: String(row.keyword || '').trim()
  }))
}

// Same combination rules as combineCalculator.mjs, without enumerating the
// potentially large Cartesian product just to explain its size in the editor.
export function countPlatformCombinations(filters = {}, skipEmpty = false) {
  const count = (key) => BigInt((filters[key] || []).filter((value) => value !== 0).length)
  const city = count('cityList'),
    salary = count('salaryList')
  const experience = count('experienceList'),
    degree = count('degreeList')
  const scale = count('scaleList'),
    industry = count('industryList')
  const industryCombinations =
    1n +
    industry +
    (industry * (industry - 1n)) / 2n +
    (industry * (industry - 1n) * (industry - 2n)) / 6n
  const total =
    (city + 1n) *
    (salary + 1n) *
    2n ** experience *
    2n ** degree *
    2n ** scale *
    industryCombinations
  const hasConditions = city + salary + experience + degree + scale + industry > 0n
  return { total: total - (skipEmpty && hasConditions ? 1n : 0n), hasConditions }
}
