import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { normalizePositionCodes, hasSearchCriteria, describeSearchSource, positionOptions } from '../../geek-auto-start-chat-with-boss/search-source.mjs'
import { isSearchRotationEnabled, searchOptionsForRun, potentialSourceCount, positionCascaderProps, emptyPositionCodes } from '../src/renderer/src/page/Ux/search-settings.js'
import { exportTemplates, parseTemplateFile } from '../src/renderer/src/page/Ux/template-io.js'

const source = fs.readFileSync(new URL('../src/renderer/src/page/Ux/index.js', import.meta.url), 'utf8')
const search = (rows, enabled = true) => ({ type: 'search', enabled, children: rows })
const draftFor = rows => ({ sourceList: [search(rows), { type: 'recommend', enabled: false }], platformFilters: {}, platformCombos: [], platformMode: 1 })
function issues(draft) {
  const context = vm.createContext({ searchOptionsForRun, hasSearchCriteria, normalizePositionCodes })
  const start = source.indexOf('    function sourceIssues(')
  vm.runInContext(source.slice(start, source.indexOf('    function focusError(', start)), context)
  const result = []
  context.sourceIssues(draft, result)
  return result
}

test('the real editor validation accepts category-only search and rejects empty or retired codes', () => {
  assert.deepEqual(issues(draftFor([{ enabled: true, keyword: '', positionCodes: ['100109'] }])), [])
  assert.match(issues(draftFor([{ enabled: true, keyword: '' }]))[0].text, /搜索内容或选择平台职位类目/)
  assert.match(issues(draftFor([{ enabled: true, keyword: '', positionCodes: ['retired'] }]))[0].text, /重新选择/)
})
test('category-only rows participate in rotation and source counts', () => {
  const draft = draftFor([{ enabled: true, keyword: 'Java' }, { enabled: true, keyword: '', positionCodes: ['100109'] }])
  assert.equal(isSearchRotationEnabled(draft), true)
  assert.equal(potentialSourceCount(draft), 2)
  assert.equal(searchOptionsForRun(draft, draft.sourceList[0])[1].enabled, true)
  draft.searchRotation = false
  assert.equal(potentialSourceCount(draft), 1)
  const rows = searchOptionsForRun(draft, draft.sourceList[0])
  assert.equal(rows[1].enabled, false)
  assert.deepEqual(rows[1].positionCodes, ['100109'])
  assert.deepEqual(draft.sourceList[0].children[1].positionCodes, ['100109'])
})
test('exported templates retain category-only sources through an import round trip', () => {
  const draft = draftFor([{ enabled: true, keyword: '', positionCodes: ['100101', '100109'] }])
  const imported = parseTemplateFile(exportTemplates([{ name: '后端', snapshot: draft }])).templates[0].snapshot
  assert.deepEqual(imported.sourceList, draft.sourceList)
})

const h = (tag, props, children) => children === undefined && Array.isArray(props)
  ? { tag, props: {}, children: props } : { tag, props: props || {}, children }
const flatten = value => !value ? [] : Array.isArray(value) ? value.flatMap(flatten) :
  typeof value === 'object' ? [value, ...flatten(value.children)] : []
test('the actual source form binds its cascader to persisted positionCodes', () => {
  const draft = draftFor([{ type: 'search-kw', enabled: true, keyword: '', positionCodes: ['100109'] }])
  let edits = 0
  const context = vm.createContext({ h, ElCascader: 'Cascader', draft: { value: draft },
    positionOptions, normalizePositionCodes, hasSearchCriteria, describeSearchSource, positionCascaderProps, emptyPositionCodes,
    isSearchRotationEnabled, searchOptionsForRun, potentialSourceCount,
    sourceInfo: { search: ['搜索结果', ''], recommend: ['推荐职位', ''] },
    field: (label, children) => ({ tag: 'field', label, children }),
    disclosure: (label, _open, _key, children) => ({ tag: 'disclosure', label, children }),
    check: () => null, input: () => null, tip: () => null, withTip: node => node,
    platformControls: () => [], platformFiltersOpen: {}, searchRotationOpen: {}, platformOpen: {},
    changed: () => { edits++ }, update: (obj, key, value) => { obj[key] = value; edits++ }
  })
  const start = source.indexOf('    function sourceControls()')
  vm.runInContext(source.slice(start, source.indexOf('    function platformControls()', start)), context)
  const cascader = flatten(context.sourceControls()).find(node => node.tag === 'Cascader')
  assert.ok(cascader)
  assert.deepEqual(cascader.props.modelValue, ['100109'])
  assert.equal(cascader.props.props.multiple, true)
  assert.equal(cascader.props.props.emitPath, false)
  const nextRender = flatten(context.sourceControls()).find(node => node.tag === 'Cascader')
  assert.equal(nextRender.props.props, cascader.props.props)
  cascader.props['onUpdate:modelValue'](['100109', '100101'])
  assert.deepEqual(draft.sourceList[0].children[0].positionCodes, ['100101', '100109'])
  cascader.props['onUpdate:modelValue'](null)
  assert.deepEqual(draft.sourceList[0].children[0].positionCodes, [])
  assert.equal(edits, 2)
  delete draft.sourceList[0].children[0].positionCodes
  const emptyFirst = flatten(context.sourceControls()).find(node => node.tag === 'Cascader')
  const emptyNext = flatten(context.sourceControls()).find(node => node.tag === 'Cascader')
  assert.equal(emptyFirst.props.modelValue, emptyNext.props.modelValue)
})
