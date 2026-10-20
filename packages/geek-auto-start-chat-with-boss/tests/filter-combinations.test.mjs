import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import vm from 'node:vm'
import { combineFiltersWithConstraintsGenerator as generate, countFilterCombinations, calculateTotalCombinations } from '../combineCalculator.mjs'

const filters = { cityList: ['上海', '深圳', '杭州'], salaryList: [1, 2, 3], experienceList: [1, 2, 3, 4],
  degreeList: [1, 2, 3], scaleList: [1, 2, 3], industryList: [1, 2, 3, 4, 5] }

test('exact combination count agrees with enumeration and preserves the empty-list fallback', () => {
  for (const selected of [{}, { salaryList: [0] }, { cityList: ['上海', '上海'], experienceList: [0, 1, '1', 2] },
    { industryList: [1, 2, 3, 4], degreeList: [1, 2], scaleList: [1] }]) {
    for (const skipEmpty of [false, true]) {
      const rows = [...generate(selected, { skipEmpty })]
      assert.equal(BigInt(rows.length), countFilterCombinations(selected, skipEmpty).total)
      assert.equal(new Set(rows.map(row => JSON.stringify(row))).size, rows.length)
      assert.equal(calculateTotalCombinations(selected, !skipEmpty), rows.length)
      assert.ok(rows.length >= 1)
    }
  }
  assert.equal(countFilterCombinations(filters).total, 425984n)
  assert.equal(countFilterCombinations(filters, true).total, 425983n)
})

test('budget prioritizes selected filters and visits every selected city/salary before relaxing them', () => {
  const rows = [...generate(filters, { limit: 9, preferSelected: true, skipEmpty: true })]
  assert.equal(rows.length, 9)
  assert.deepEqual(new Set(rows.map(row => row.cityList[0])), new Set(filters.cityList))
  assert.deepEqual(new Set(rows.map(row => row.salaryList[0])), new Set(filters.salaryList))
  for (const row of rows) {
    assert.deepEqual(row.experienceList, filters.experienceList)
    assert.deepEqual(row.degreeList, filters.degreeList)
    assert.deepEqual(row.scaleList, filters.scaleList)
    assert.equal(row.industryList.length, 3)
  }
  const small = { cityList: ['上海'], degreeList: [1, 2], industryList: [1, 2] }
  const all = [...generate(small, { preferSelected: true })]
  assert.equal(all.length, Number(countFilterCombinations(small).total))
  assert.ok(Object.values(all.at(-1)).every(values => !values.length))
  assert.deepEqual([...generate(small, { limit: 2, preferSelected: true })], all.slice(0, 2))
})

test('large imported selections count and produce a bounded prefix in a small heap', () => {
  const moduleUrl = new URL('../combineCalculator.mjs', import.meta.url).href
  const output = execFileSync(process.execPath, ['--max-old-space-size=64', '--input-type=module', '-e', `
    import { combineFiltersWithConstraintsGenerator as generate, countFilterCombinations } from ${JSON.stringify(moduleUrl)};
    const filters = { experienceList: Array.from({length: 60}, (_, i) => i + 1) };
    const rows = [...generate(filters, {limit: 100, preferSelected: true})];
    if (rows.length !== 100 || countFilterCombinations(filters).total !== 2n ** 60n) process.exit(1);
    console.log(rows.length);
  `], { encoding: 'utf8', timeout: 10000 })
  assert.equal(output.trim(), '100')
  assert.equal(calculateTotalCombinations({ experienceList: Array.from({ length: 60 }, (_, i) => i + 1) }, true), Number.MAX_SAFE_INTEGER)
})

test('shipped source loop resumes within the same budget and fixed combinations remain complete', () => {
  const source = fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('    const filterConditions =')
  const end = source.indexOf('      runPosition =', start)
  const ctx = vm.createContext({ combineRecommendJobFilterType: 1, CombineRecommendJobFilterType: { STATIC_COMBINE: 2, ANY_COMBINE: 1 },
    anyCombineRecommendJobFilter: filters, staticCombineRecommendJobFilterConditions: [1, 2, 3, 4],
    formatStaticCombineFilters: rows => rows, combineFiltersWithConstraintsGenerator: generate, countFilterCombinations,
    filterCombinationLimit: 3, isSkipEmptyConditionForCombineRecommendJobFilter: true, skipFilterConditions: 2,
    hasReachedSourceRotationLimit: () => false, autoStartChatEventBus: { emit() {} }, visited: [] })
  const run = () => vm.runInContext('(function () {' + source.slice(start, end) + ' visited.push(filterConditionIndex) } })()', ctx)
  run()
  assert.deepEqual(Array.from(ctx.visited), [2])
  ctx.visited = []; ctx.skipFilterConditions = 3; run()
  assert.deepEqual(Array.from(ctx.visited), [])
  ctx.visited = []; ctx.combineRecommendJobFilterType = 2; ctx.skipFilterConditions = 0; run()
  assert.deepEqual(Array.from(ctx.visited), [0, 1, 2, 3])
})
