import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

// Run the shipped render functions, not copies. Native actions are isolated stubs.
const source = fs.readFileSync(new URL('../src/renderer/src/page/Ux/index.js', import.meta.url), 'utf8')
const h = (tag, props, children) => {
  if (children === undefined && (typeof props !== 'object' || Array.isArray(props))) return { tag, props: {}, children: props }
  return { tag, props: props || {}, children }
}
function renderFooter({ at = 0, mode = 'chat', skipped = false, rail = false, errors = [], running = false } = {}) {
  const steps = [{ id: 'mode', label: '运行方式' }, { id: 'filters', label: '职位筛选与来源' }, { id: 'policy', label: '处理方式', skipped }]
  const context = vm.createContext({ h, button: (label, action, props) => ({ tag: 'button', label, action, props: props || {} }),
    autoSteps: () => steps, currentStepId: () => steps[at].id, otherTaskBusy: () => false,
    draft: { value: { runMode: mode } }, railCollapsed: { value: !rail }, preparing: { value: false }, starting: { value: false }, stopping: { value: false },
    running: { value: { auto: running } }, queued: { value: {} }, draftSaveError: { value: '' }, draftSaveState: { value: '已保存' }, errors: { value: errors },
    attachWorkflowFooter: () => {}, begin: () => {}, moveStep: () => {}, focusError: () => {}, save: () => {}, ArrowRight: 'ArrowRight' })
  vm.runInContext(source.slice(source.indexOf('    function footer(task)'), source.indexOf('    // another BOSS task')), context)
  return context.footer('auto')
}
const flatten = node => !node ? [] : Array.isArray(node) ? node.flatMap(flatten) : [node, ...flatten(node.children)]
const buttons = tree => flatten(tree).filter(node => node.tag === 'button')
test('every wizard step has exactly one forward primary action', () => {
  for (let at = 0; at < 3; at++) {
    const b = buttons(renderFooter({ at }))
    assert.equal(b.filter(x => x.props.type === 'primary').length, 1)
    assert.equal(b.some(x => x.label === '开始打招呼'), at === 2)
    assert.equal(b.some(x => x.props['aria-label'] === '下一步'), at < 2)
    assert.equal(b.some(x => x.label === '上一步'), at > 0)
  }
})
test('collect-all skips policy and starts from its final applicable step', () => {
  const b = buttons(renderFooter({ at: 1, mode: 'collect', skipped: true }))
  assert.equal(b.find(x => x.props.type === 'primary').label, '开始收集')
})
test('footer alignment follows the expanded progress rail', () => {
  assert.ok(renderFooter({ rail: true }).props.class.includes('ux-workflow-footer--with-rail'))
  assert.ok(renderFooter({ rail: false }).props.class.includes('ux-workflow-footer--rail-collapsed'))
})
test('missing configuration has an actionable warning rather than a silent disabled start', () => {
  const b = buttons(renderFooter({ at: 2, errors: [{ text: '请选择来源', field: 'source-selection' }] }))
  assert.ok(b.some(x => x.props['aria-label'] === '定位到第一个未完成项'))
  assert.equal(b.find(x => x.label === '开始打招呼').props.disabled, false)
})
test('a running task explains why another start is unavailable', () => {
  const b = buttons(renderFooter({ at: 2, running: true }))
  const start = b.find(x => x.label === '开始打招呼')
  assert.equal(start.props.disabled, true)
  assert.match(start.props.title, /运行或排队/)
})
