import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { applyPageFilters as apply } from '../page-filters.mjs'
import { useBackgroundTaskInput } from '../task-page-input.mjs'
const applyPageFilters = (page, selected, options) => apply(page, selected, { settle: async () => {}, ...options })

const specs = [
  ['salaryList', 'salary', '薪资待遇', 'sel-job-rec-salary-', [[0, '不限'], [404, '5-10K'], [405, '10-20K']]],
  ['experienceList', 'experience', '工作经验', 'sel-job-rec-exp-', [[0, '不限'], [103, '1年以内'], [104, '1-3年']]],
  ['degreeList', 'degree', '学历要求', 'sel-job-rec-degree-', [[0, '不限'], [202, '大专'], [203, '本科']]],
  ['industryList', 'industry', '公司行业', 'sel-industry-', [[100020, '互联网'], [100021, '计算机软件']]],
  ['scaleList', 'scale', '公司规模', 'sel-job-rec-scale-', [[0, '不限'], [302, '20-99人'], [303, '100-499人']]],
]
const catalogs = Object.fromEntries(specs.map(([key,,,, rows]) => [key, rows.map(([code, name]) => ({ code, name }))]))
const selected = { salaryList: [404], experienceList: [104], degreeList: [203], industryList: [100021], scaleList: [303] }

function fixture({ missing, staleScope, clickOnly = false, hiddenDuplicate = false, mountedHidden = false, duplicateMounted = false, unavailable, resetsSalaryOnScale = false } = {}) {
  const form = {}, sets = {}, open = {}, children = [], calls = []; let handles = 0
  for (const [,field,label,prefix,rows] of specs) {
    form[field] = field === 'salary' ? '' : []; sets[field] = new Set(); open[field] = false
    const options = rows.map(([code, name], index) => ({
      isConnected: true, field,
      textContent: name, getAttribute: key => key === 'ka' ? prefix + (field === 'industry' ? index : code) : null,
      getClientRects: () => open[field] || mountedHidden ? [{}] : [],
      classList: { contains: name => name === 'active' && (code === 0 ? !sets[field].size : sets[field].has(String(code))) },
      click() {
        calls.push([field, code])
        if (code === 0) sets[field].clear()
        else if (field === 'salary') sets[field] = new Set([String(code)])
        else if (sets[field].has(String(code))) sets[field].delete(String(code))
        else sets[field].add(String(code))
        if (staleScope !== field) form[field] = field === 'salary' ? [...sets[field]].join(',') : [...sets[field]]
        if (resetsSalaryOnScale && field === 'scale') { sets.salary.clear(); form.salary = '' }
      },
    }))
    if (hiddenDuplicate) options.unshift({ ...options.at(-1), getClientRects: () => duplicateMounted ? [{}] : [], click: () => { throw Error('hidden duplicate clicked') } })
    const control = { isConnected: true, getAttribute: () => null, getClientRects: () => [{}],
      querySelectorAll: () => options, click: () => { open[field] = true }, hover: () => { if (!clickOnly) open[field] = true } }
    if (missing !== field && unavailable !== field) children.push({ placeholder: label, $el: control })
    if (unavailable === field) delete form[field]
  }
  const context = vm.createContext({ URL, location: { href: 'https://www.zhipin.com/web/geek/jobs' }, document: { querySelector: selector => selector === '.page-jobs-main'
    ? { __vue__: { formData: form } } : { __vue__: { $children: children } } },
    getComputedStyle: node => ({ visibility: mountedHidden && node.field && !open[node.field] ? 'hidden' : 'visible', display: 'block' }) })
  const execute = (fn, args) => { context.args = args; return vm.runInContext('(' + fn.toString() + ')(...args)', context) }
  const handle = value => { handles++; return { asElement: () => value ? {
    click: async () => value.click(), hover: async () => value.hover(),
    evaluate: async (fn,...args) => execute(fn,[value,...args]), scrollIntoView: async () => {}, clickablePoint: async () => ({ x: 10, y: 10 }),
  } : null, dispose: async () => { handles-- } } }
  const page = { evaluate: async (fn, ...args) => execute(fn, args),
    evaluateHandle: async (fn, ...args) => handle(execute(fn, args)),
    waitForFunction: async (fn, options, ...args) => {
      assert.equal(options.polling, 100)
      if (!execute(fn, args)) throw Error('not visible')
      return handle(true)
    }, mouse: { move: async () => {} } }
  return { page, calls, form, handles: () => handles }
}

test('all five controls verify active choices and their actual bound parameters, including industry UI indexes', async () => {
  const f = fixture({ clickOnly: true })
  const result = await applyPageFilters(f.page, selected, { catalogs })
  assert.equal(result.length, 5)
  for (const row of result) assert.deepEqual(row.requested, row.actual)
  assert.deepEqual(result.find(row => row.field === 'industry').actual, ['100021'])
  assert.equal(f.handles(), 0)
})

test('reapplying a confirmed state performs no clicks and clearing removes every stale choice', async () => {
  const f = fixture()
  await applyPageFilters(f.page, selected, { catalogs })
  const count = f.calls.length
  await applyPageFilters(f.page, selected, { catalogs })
  assert.equal(f.calls.length, count)
  const cleared = await applyPageFilters(f.page, {}, { catalogs })
  for (const row of cleared) assert.deepEqual(row.actual, [])
  assert.equal(f.handles(), 0)
})

test('hidden duplicate options are ignored', async () => {
  const f = fixture({ hiddenDuplicate: true })
  await applyPageFilters(f.page, selected, { catalogs })
  assert.equal(f.handles(), 0)
})

test('background menus may use a unique mounted option without relying on hover visibility', async () => {
  const f = fixture({ mountedHidden: true })
  useBackgroundTaskInput(f.page)
  const result = await applyPageFilters(f.page, selected, { catalogs })
  for (const row of result) assert.deepEqual(row.actual, row.requested)
  assert.equal(f.handles(), 0)
})

test('ambiguous mounted hidden duplicates stop instead of guessing an option', async () => {
  const f = fixture({ mountedHidden: true, hiddenDuplicate: true, duplicateMounted: true })
  useBackgroundTaskInput(f.page)
  await assert.rejects(applyPageFilters(f.page, selected, { catalogs }), /PAGE_FILTER_NOT_APPLIED/)
  assert.equal(f.handles(), 0)
})

test('a missing control or option stops with its field instead of silently dropping the condition', async () => {
  for (const field of ['salary', 'experience', 'degree', 'industry', 'scale']) {
    const f = fixture({ missing: field })
    await assert.rejects(applyPageFilters(f.page, selected, { catalogs }), error =>
      error.message === 'AUTO_CHAT_PAGE_FILTER_NOT_APPLIED' && error.field === field)
    assert.equal(f.handles(), 0)
  }
  await assert.rejects(applyPageFilters(fixture().page, { degreeList: [999] }, { catalogs }), /PAGE_FILTER_NOT_APPLIED/)
})

test('selected appearance cannot override disagreeing page parameters', async () => {
  const f = fixture({ staleScope: 'degree' })
  await assert.rejects(applyPageFilters(f.page, selected, { catalogs, timeoutMs: 20 }), error =>
    error.message === 'AUTO_CHAT_PAGE_FILTER_NOT_APPLIED' && error.field === 'degree')
  assert.equal(f.handles(), 0)
})

test('an inapplicable absent dimension is unrestricted only when no option was requested', async () => {
  const f = fixture({ unavailable: 'salary' })
  const result = await applyPageFilters(f.page, {}, { catalogs })
  assert.equal(result[0].unavailable, true)
  await assert.rejects(applyPageFilters(f.page, { salaryList: [404] }, { catalogs }), /PAGE_FILTER_NOT_APPLIED/)
})

test('a later control resetting an earlier condition stops before reporting successful application', async () => {
  const f = fixture({ resetsSalaryOnScale: true })
  const applied = [], failures = []
  await assert.rejects(applyPageFilters(f.page, selected, { catalogs,
    onApplied: result => applied.push(result), onFailure: result => failures.push(result) }),
    error => error.message === 'AUTO_CHAT_PAGE_FILTER_NOT_APPLIED' && error.field === 'salary')
  assert.equal(applied.length, 0)
  assert.equal(failures.at(-1).field, 'salary')
  assert.equal(f.handles(), 0)
})
