import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Module } from 'node:module'
import { parse, compileScript } from '@vue/compiler-sfc'
import { build } from 'esbuild'

const filename = fileURLToPath(new URL('../src/renderer/src/page/MainLayout/GeekAutoStartChatWithBoss/components/CityChooser.vue', import.meta.url))
const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
const script = compileScript(descriptor, { id: 'city-selection-fixture' })
const compiled = await build({ stdin: { contents: script.content, resolveDir: path.dirname(filename), loader: 'ts' },
  bundle: true, format: 'cjs', platform: 'node', packages: 'external', write: false, logLevel: 'silent',
  plugins: [{ name: 'no-renderer-dom', setup(builder) {
    builder.onResolve({ filter: /^element-plus$/ }, () => ({ path: 'element-plus', namespace: 'city-fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'city-fixture' }, () => ({ contents: 'export const ElRadioGroup={};' }))
  } }] })
const loaded = new Module(filename + '.cjs')
loaded.filename = filename + '.cjs'
loaded.paths = Module._nodeModulePaths(path.dirname(filename))
loaded._compile(compiled.outputFiles[0].text, loaded.filename)
function city(props) {
  const emitted = []
  const state = loaded.exports.default.setup(props, { expose() {}, emit: (...args) => emitted.push(args) })
  return { ...state, emitted }
}

test('actual multi-city chooser keeps cancellation, confirmation and clearing isolated from saved settings', () => {
  const saved = ['全国', '深圳'], f = city({ modelValue: saved, multiple: true })
  f.handleDialogOpen()
  f.selectedCityList.value.push('上海')
  f.handleCancelClicked()
  assert.deepEqual(saved, ['全国', '深圳'])
  assert.equal(f.emitted.length, 0)
  f.handleDialogOpen()
  f.selectedCityList.value.push('杭州')
  f.handleConfirmClicked()
  assert.deepEqual(f.emitted[0], ['update:modelValue', ['全国', '深圳', '杭州']])
  f.handleClearSelectedCitiesInModelValue()
  assert.deepEqual(f.emitted[1], ['update:modelValue', []])
  assert.ok([...f.cityGroupsByAlphabetMap.value.keys()].every(key => typeof key === 'string'))
})

test('actual single-city chooser clears to null and multi-city mode never splits a string into characters', () => {
  const single = city({ modelValue: '深圳', multiple: false })
  single.handleDialogOpen()
  assert.equal(single.selectedCity.value, '深圳')
  single.selectedCity.value = undefined
  single.handleConfirmClicked()
  assert.deepEqual(single.emitted, [['update:modelValue', null]])
  const multiple = city({ modelValue: '深圳', multiple: true })
  multiple.handleDialogOpen()
  assert.deepEqual(multiple.selectedCityList.value, [])
})
