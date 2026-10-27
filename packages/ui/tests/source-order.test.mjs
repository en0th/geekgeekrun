import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { reorderEnabledSources } from '../src/common/source-order.mjs'

test('dragging enabled sources preserves disabled slots, settings and object identity without mutating the input', () => {
  const sources = [{ type: 'search', enabled: false, children: [{ keyword: '产品' }] }, { type: 'expect', enabled: true }, { type: 'company', enabled: false }, { type: 'recommend', enabled: true }]
  const before = structuredClone(sources), result = reorderEnabledSources(sources, ['recommend', 'expect'])
  assert.deepEqual(result.map(s => s.type), ['search', 'recommend', 'company', 'expect'])
  assert.equal(result[0], sources[0]); assert.equal(result[1], sources[3]); assert.deepEqual(sources, before)
  for (const order of [[], ['recommend', 'recommend'], ['search', 'expect']]) assert.throws(() => reorderEnabledSources(sources, order))
})

test('running, compact and paused end actions share one red outlined button without link/text variants', () => {
  const source = fs.readFileSync(new URL('../src/renderer/src/page/Ux/index.js', import.meta.url), 'utf8')
  const body = source.slice(source.indexOf('    function endTaskButton('), source.indexOf('    /** buttons for a task', source.indexOf('    function endTaskButton(')))
  const calls = [], context = vm.createContext({ stopping: { value: false }, button: (label, action, props) => ({ label, action, props }), terminateTask: task => calls.push(task) })
  vm.runInContext(body, context)
  for (const options of [{}, { size: 'small', link: true }, { text: true, class: 'ux-task-curtain-end' }]) {
    const result = context.endTaskButton('auto', options)
    assert.equal(result.label, '结束任务'); assert.equal(result.props.type, 'danger'); assert.equal(result.props.plain, true)
    assert.equal(result.props.text, false); assert.equal(result.props.link, false); result.action()
  }
  assert.deepEqual(calls, ['auto', 'auto', 'auto'])
})
