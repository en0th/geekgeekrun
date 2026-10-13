import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isSearchRotationEnabled,
  searchOptionsForRun,
  potentialSourceCount
} from '../src/renderer/src/page/Ux/search-settings.js'

const draftWith = (sources, extra = {}) => ({
  sourceList: sources,
  ...extra
})
const search = (children) => ({ type: 'search', enabled: true, children })

test('rotation is off until a second row with a keyword exists', () => {
  assert.equal(isSearchRotationEnabled(draftWith([search([{ enabled: true, keyword: 'a' }, { enabled: true, keyword: 'b' }])])), true)
  assert.equal(isSearchRotationEnabled(draftWith([search([{ enabled: true, keyword: 'a' }, { enabled: true, keyword: '' }])])), false)
  assert.equal(isSearchRotationEnabled(draftWith([search([{ enabled: true, keyword: 'a' }])])), false)
  assert.equal(isSearchRotationEnabled(draftWith([search([{ enabled: true, keyword: 'a' }, { enabled: false, keyword: 'b' }])])), false)
  assert.equal(isSearchRotationEnabled(draftWith([search([{ enabled: true, keyword: 'a' }])], { searchRotation: true })), true)
  assert.equal(isSearchRotationEnabled(draftWith([search([{ enabled: true, keyword: 'a' }])], { searchRotation: false })), false)
})

test('single-search mode keeps only the first keyword enabled', () => {
  const src = search([
    { enabled: true, keyword: ' a ' },
    { enabled: true, keyword: '' },
    { enabled: false, keyword: 'c' }
  ])
  const rows = searchOptionsForRun(draftWith([src]), src)
  assert.deepEqual(rows.map((r) => [r.enabled, r.keyword]), [
    [true, 'a'],
    [false, ''],
    [false, 'c']
  ])
})

test('rotation mode keeps later enabled keywords enabled', () => {
  const src = search([
    { enabled: true, keyword: 'a' },
    { enabled: true, keyword: 'b' },
    { enabled: false, keyword: 'c' }
  ])
  const rows = searchOptionsForRun(draftWith([src]), src)
  assert.deepEqual(rows.map((r) => [r.enabled, r.keyword]), [
    [true, 'a'],
    [true, 'b'],
    [false, 'c']
  ])
})

test('every enabled keyword counts as its own rotatable source', () => {
  assert.equal(potentialSourceCount(draftWith([
    search([{ enabled: true, keyword: 'a' }, { enabled: true, keyword: 'b' }, { enabled: false, keyword: 'c' }])
  ])), 2)
  assert.equal(potentialSourceCount(draftWith([
    search([{ enabled: true, keyword: 'a' }]),
    { type: 'expect', enabled: true }
  ])), 2)
  assert.equal(potentialSourceCount(draftWith([
    search([{ enabled: true, keyword: 'a' }]),
    { type: 'expect', enabled: false },
    { type: 'recommend', enabled: false }
  ])), 1)
  assert.equal(potentialSourceCount(draftWith([])), 0)
  assert.equal(potentialSourceCount(null), 0)
})
