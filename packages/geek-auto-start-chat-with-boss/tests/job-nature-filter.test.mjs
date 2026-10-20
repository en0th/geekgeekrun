import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { applyJobNatureFilter } from '../job-nature-filter.mjs'

function browser({ label = '实习', code = '1902', opensOnHover = false, missing = false } = {}) {
  let visible = false
  const clicks = [], form = { jobType: '1901' }
  const option = { textContent: label, getClientRects: () => visible ? [{}] : [],
    classList: { contains: () => false }, getAttribute: name => name === 'ka' ? `sel-job-rec-jobType-${code}` : null,
    click() { clicks.push('option'); form.jobType = code === '0' ? '' : code } }
  const trigger = { querySelectorAll: () => [option], hover() { if (opensOnHover) visible = true },
    click() { clicks.push('trigger'); visible = true } }
  const ctx = vm.createContext({ getComputedStyle: () => ({ visibility: 'visible' }), document: {
    querySelector: selector => selector === '.page-jobs-main' ? { __vue__: { formData: form } }
      : { __vue__: { $children: missing ? [] : [{ placeholder: '求职类型', $el: trigger }] } }
  } })
  const evaluate = (fn, args) => { ctx.args = args.map(value => value && Object.hasOwn(value, 'rawValue') ? value.rawValue : value); return vm.runInContext('(' + fn.toString() + ')(...args)', ctx) }
  const handle = value => ({ rawValue: value, asElement: () => value && typeof value === 'object' ? handle(value) : null,
    hover: async () => value.hover(), click: async () => value.click(),
    evaluate: async (fn, ...args) => evaluate(fn, [value, ...args]), dispose: async () => {} })
  const page = { evaluateHandle: async (fn, ...args) => handle(evaluate(fn, args)),
    waitForFunction: async (fn, options, ...args) => {
      const value = evaluate(fn, args); if (!value) throw new Error('timeout'); return handle(value)
    }, mouse: { move: async () => {} } }
  return { page, form, clicks }
}

test('click-only dropdowns open before selecting a visible job-nature option', async () => {
  const fixture = browser()
  assert.equal(await applyJobNatureFilter(fixture.page, ['实习']), true)
  assert.deepEqual(fixture.clicks, ['trigger', 'option'])
  assert.equal(fixture.form.jobType, '1902')
})

test('hover dropdowns and different option codes still select the visible label', async () => {
  const fixture = browser({ code: '3', opensOnHover: true })
  assert.equal(await applyJobNatureFilter(fixture.page, ['实习']), true)
  assert.deepEqual(fixture.clicks, ['option'])
  assert.equal(fixture.form.jobType, '3')
})

test('multiple allowed types clear the web filter while the hard detail check remains responsible', async () => {
  const fixture = browser({ label: '不限', code: '0' })
  assert.equal(await applyJobNatureFilter(fixture.page, ['全职', '兼职']), true)
  assert.equal(fixture.form.jobType, '')
  assert.equal(await applyJobNatureFilter(browser({ missing: true }).page, ['实习']), false)
})
