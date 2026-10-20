import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import fs from 'node:fs'
import { applyCityFilter, normalizeCitySelection, matchesCitySelection } from '../city-filter.mjs'
import { listSkipReason } from '../auto-chat-navigation.mjs'

function browser({ selected = '上海', hot = ['上海', '全国'], lateCity = '赣州', missingTrigger = false, ignoreClick = false, formCity } = {}) {
  const clicks = []
  let dialogVisible = false, loaded = false, pending = false
  const trigger = {
    textContent: selected,
    classList: { contains: () => !['城市', '不限', ''].includes(trigger.textContent) },
    getAttribute: () => null,
    click() { clicks.push('open'); dialogVisible = true }
  }
  const element = (name, action, visible = true) => ({ textContent: name,
    getClientRects: () => visible && dialogVisible ? [{}] : [], click: action })
  const choose = name => { clicks.push(name); if (!ignoreClick) trigger.textContent = name }
  const hotOptions = hot.map(name => element(name, () => choose(name)))
  const hiddenDuplicate = element(lateCity, () => { throw new Error('hidden option clicked') }, false)
  const city = element(lateCity, () => choose(lateCity))
  const letter = element('G', () => { clicks.push('G'); pending = true })
  const clear = { click() { clicks.push('clear'); trigger.textContent = '城市' } }
  const ctx = vm.createContext({ getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
    document: {
      querySelector(selector) {
        if (selector === '.page-jobs-main') return { __vue__: { formData: { city: formCity } } }
        if (selector.includes('switch_city_dialog_open')) return missingTrigger ? null : trigger
        if (selector.includes('empty-filter')) return clear
        if (selector === '.city-select-dialog') return { getClientRects: () => dialogVisible ? [{}] : [] }
        return null
      },
      querySelectorAll(selector) {
        if (selector.includes('city-char-list')) return [letter]
        return [...hotOptions, hiddenDuplicate, ...(loaded ? [city] : [])]
      }
    } })
  const evaluate = (fn, args) => { ctx.args = args; return vm.runInContext('(' + fn.toString() + ')(...args)', ctx) }
  const handle = value => ({ asElement: () => typeof value === 'object' && value ? handle(value) : null,
    click: async () => value.click(), dispose: async () => {} })
  const page = {
    evaluate: async (fn, ...args) => evaluate(fn, args),
    evaluateHandle: async (fn, ...args) => handle(evaluate(fn, args)),
    $: async selector => { const value = ctx.document.querySelector(selector); return value ? handle(value) : null },
    waitForFunction: async (fn, options, ...args) => {
      if (pending) { loaded = true; pending = false }
      const value = evaluate(fn, args)
      if (!value) throw new Error('timeout')
      return handle(value)
    }
  }
  return { page, clicks, trigger }
}

test('nationwide is unrestricted in both list and final city semantics', () => {
  assert.deepEqual(normalizeCitySelection([' 深圳 ', '深圳']), ['深圳'])
  assert.deepEqual(normalizeCitySelection(['全国', '深圳']), [])
  assert.equal(matchesCitySelection(['全国'], '上海'), true)
  assert.equal(matchesCitySelection(['全国'], undefined), true)
  assert.equal(matchesCitySelection(['深圳'], '上海'), false)
  assert.equal(listSkipReason({ cityName: '上海' }, { cities: ['全国'], cityStrategy: 3 }), '')
  // The main flow normalizes before its list, missing-field and detail checks.
  const source = fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8')
  const code = source.slice(source.indexOf('const expectCityList ='), source.indexOf('const strategyScopeOptionWhenMarkJobCityNotMatch'))
  const ctx = vm.createContext({ normalizeCitySelection, fieldsForUseCommonConfig: {},
    readConfigFile: () => ({ expectCityList: ['全国'] }), commonJobConditionConfig: {} })
  vm.runInContext(code, ctx)
  assert.equal(vm.runInContext('expectCityList.length', ctx), 0)
})

test('explicit nationwide is selected and read back from the city trigger', async () => {
  const fixture = browser()
  await applyCityFilter(fixture.page, ['全国'])
  assert.deepEqual(fixture.clicks, ['open', '全国'])
  assert.equal(fixture.trigger.textContent, '全国')
})

test('non-hot cities wait for their alphabet section and ignore hidden duplicates', async () => {
  const fixture = browser()
  await applyCityFilter(fixture.page, ['赣州'], { cityCatalog: [{ name: '赣州', firstChar: 'g' }] })
  assert.deepEqual(fixture.clicks, ['open', 'G', '赣州'])
})

test('an unchanged city performs no browser mutation and clearing a stale city is verified', async () => {
  const fixture = browser()
  await applyCityFilter(fixture.page, ['上海'])
  assert.deepEqual(fixture.clicks, [])
  await applyCityFilter(fixture.page, [])
  assert.deepEqual(fixture.clicks, ['clear'])
  await applyCityFilter(fixture.page, [])
  assert.deepEqual(fixture.clicks, ['clear'])
})

test('missing controls/options and clicks that fail to change the city stop before reviewing jobs', async () => {
  for (const fixture of [browser({ missingTrigger: true }), browser({ hot: [] }), browser({ ignoreClick: true }), browser({ formCity: '101020100' })]) {
    await assert.rejects(applyCityFilter(fixture.page, ['全国']), error =>
      error.message === 'AUTO_CHAT_CITY_FILTER_NOT_APPLIED' && error.detail.includes('全国'))
  }
  const fixture = browser({ hot: [] })
  await assert.rejects(applyCityFilter(fixture.page, ['赣州']), /CITY_FILTER_NOT_APPLIED/)
})
