// Keep both the subsets and their Cartesian product lazy. Counting must never build
// the subsets: a single dimension can already contain 2^n of them.
const dimensions = [
  ['cityList', 1], ['salaryList', 1], ['experienceList', Infinity],
  ['degreeList', Infinity], ['scaleList', Infinity], ['industryList', 3]
]

function filterValues(filters, key) {
  const values = Array.isArray(filters?.[key]) ? filters[key] : []
  return [...new Set(values.flatMap(value => {
    if (key === 'cityList') return typeof value === 'string' && value.trim() ? [value.trim()] : []
    const code = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN
    return Number.isSafeInteger(code) && code > 0 ? [code] : []
  }))]
}

function* combine(arr, max, preferSelected, min = 0) {
  const n = arr.length
  const largest = Math.min(max, n)
  for (let step = 0; step <= largest - min; step++) {
    const r = preferSelected ? largest - step : min + step
    const indices = Array(r)
      .fill(0)
      .map((_, i) => i)
    yield indices.map(i => arr[i])

    while (true) {
      let i = r - 1

      // 从后往前找第一个未到达上界的索引
      while (i >= 0 && indices[i] === i + n - r) {
        i--
      }

      // 没有更多组合时退出
      if (i < 0) break

      indices[i]++

      // 更新接下来的所有索引
      for (let j = i + 1; j < r; j++) {
        indices[j] = indices[j - 1] + 1
      }

      yield indices.map(j => arr[j])
    }
  }
}

export function* combineFiltersWithConstraintsGenerator(selectedFilters = {}, { limit = Infinity, skipEmpty = false, preferSelected = false } = {}) {
  const values = dimensions.map(([key]) => filterValues(selectedFilters, key))
  const hasConditions = values.some(items => items.length)
  // Give selected cities/salary bands a turn before relaxing the other dimensions.
  const order = preferSelected ? [2, 3, 4, 5, 0, 1] : [0, 1, 2, 3, 4, 5]
  function* product(index, condition, enabledDimensions = null) {
    if (index === dimensions.length) {
      if (!skipEmpty || !hasConditions || Object.values(condition).some(items => items.length)) yield condition
      return
    }
    const dimensionIndex = order[index]
    const [key, max] = dimensions[dimensionIndex]
    const choices = enabledDimensions === null ? combine(values[dimensionIndex], max, false)
      : enabledDimensions.has(dimensionIndex) ? combine(values[dimensionIndex], max, true, 1) : [[]]
    for (const items of choices) {
      yield* product(index + 1, { ...condition, [key]: items }, enabledDimensions)
    }
  }
  function* schedule() {
    if (!preferSelected) { yield* product(0, {}); return }
    // Exhaust combinations using all configured dimensions before introducing 不限.
    const enabled = order.filter(index => values[index].length)
    for (const mask of combine(enabled, enabled.length, true)) yield* product(0, {}, new Set(mask))
  }
  if (limit <= 0) return
  let count = 0
  for (const condition of schedule()) {
    yield condition
    if (++count >= limit) return
  }
}

export function countFilterCombinations(filters = {}, skipEmpty = false) {
  let total = 1n, hasConditions = false
  for (const [key, max] of dimensions) {
    const n = BigInt(filterValues(filters, key).length)
    hasConditions ||= n > 0n
    if (max === Infinity) total *= 2n ** n
    else {
      let choices = 1n, term = 1n
      for (let r = 1n; r <= BigInt(max) && r <= n; r++) {
        term = term * (n - r + 1n) / r
        choices += term
      }
      total *= choices
    }
  }
  return { total: total - (skipEmpty && hasConditions ? 1n : 0n), hasConditions }
}

// Numeric compatibility for the legacy editor; the new editor uses the exact bigint.
export function calculateTotalCombinations(selectedFilters, includeEmptyCondition) {
  const { total } = countFilterCombinations(selectedFilters, !includeEmptyCondition)
  return Number(total > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : total)
}

export function checkAnyCombineBossRecommendFilterHasCondition(value) {
  return dimensions.some(([key]) => filterValues(value, key).length)
}

export function getStaticCombineFilterKey(condition) {
  const kAsO = {}
  for (const key of Object.keys(condition ?? []).sort()) {
    if (condition[key] === null || condition[key] === undefined) {
      continue
    }
    kAsO[key] = condition[key]
  }
  return JSON.stringify(kAsO)
}

export function formatStaticCombineFilters(rawStaticCombineRecommendJobFilterConditions) {
  rawStaticCombineRecommendJobFilterConditions = JSON.parse(JSON.stringify(rawStaticCombineRecommendJobFilterConditions))
  const map = new Map()
  for (const condition of rawStaticCombineRecommendJobFilterConditions ?? []) {    
    const key = getStaticCombineFilterKey(condition)
    map.set(key, condition)
  }
  const conditions = Array.from(map.values())
  const result = conditions.map((condition) => {
    return {
      cityList: condition.city ? [condition.city] : [],
      salaryList: condition.salary ? [condition.salary] : [],
      experienceList: condition.experience ? [condition.experience] : [],
      degreeList: condition.degree ? [condition.degree] : [],
      scaleList: condition.scale ? [condition.scale] : [],
      industryList: condition.industry ? [condition.industry] : []
    }
  })
  if (!result.length) {
    result.push({
      cityList: [],
      salaryList: [],
      experienceList: [],
      degreeList: [],
      scaleList: [],
      industryList: []
    })
  }
  return result
}
