import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { normalizeCitySelection } from '../../geek-auto-start-chat-with-boss/city-filter.mjs'

const source = fs.readFileSync(new URL('../src/renderer/src/page/Ux/index.js', import.meta.url), 'utf8')
const shipped = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)))
const ref = value => ({ value })
const h = (tag, props, children) => children === undefined
  ? { tag, props: {}, children: props } : { tag, props, children }
const flatten = node => !node ? [] : Array.isArray(node) ? node.flatMap(flatten) : [node, ...flatten(node.children)]

test('both collection scopes skip marking policy while greeting keeps its policy step and saved choices', () => {
  const ctx = vm.createContext({ draft: ref({}), autoStep: ref('job-policy') })
  vm.runInContext(shipped('    function autoSteps(', '    // the step a validation'), ctx)
  vm.runInContext(shipped('    function currentStepId(', '    function goStep('), ctx)
  for (const collectOnlyMatchingJobs of [true, false]) {
    const draft = { runMode: 'collect', collectOnlyMatchingJobs, strategy: 1, overrides: { city: 1 } }
    ctx.draft.value = draft
    assert.deepEqual(Array.from(ctx.autoSteps(), step => step.id), ['job-run-mode', 'job-preferences'])
    assert.equal(ctx.currentStepId(), 'job-preferences')
    assert.deepEqual(draft, { runMode: 'collect', collectOnlyMatchingJobs, strategy: 1, overrides: { city: 1 } })
  }
  ctx.draft.value.runMode = 'chat'
  assert.equal(ctx.autoSteps().at(-1).id, 'job-policy')
  assert.equal(ctx.currentStepId(), 'job-policy')
})

test('collecting matched jobs does not require a company list for dormant marking rules', () => {
  const ctx = vm.createContext({ normalizeCitySelection })
  vm.runInContext(shipped('    function needsCompanyList(', '    function taskErrors('), ctx)
  for (const condition of [{ cities: ['深圳'] }, { salary: true }, { experience: ['应届生'] }]) {
    const draft = { cities: [], salary: false, experience: [], overrides: {}, scopes: {}, strategy: 1, ...condition }
    assert.equal(ctx.needsCompanyList({ ...draft, runMode: 'collect' }), false)
    assert.equal(ctx.needsCompanyList({ ...draft, runMode: 'chat' }), true)
    assert.equal(ctx.needsCompanyList({ ...draft, runMode: 'chat', strategy: 3 }), false)
  }
})

test('future steps wait until validation is attempted, then missing fields are visible', () => {
  const ctx = vm.createContext({ h, E: (tag, props, children) => ({ tag, props, children: typeof children === 'function' ? children() : children }),
    validationAttempted: ref(false), goStep() {} })
  vm.runInContext(shipped('    function stepBar(', '    function stepContent('), ctx)
  const steps = [{ id: 'mode', label: '运行方式' }, { id: 'filters', label: '筛选' }]
  const sections = [{ id: 'mode', checks: [] }, { id: 'filters', checks: [{ done: false }] }]
  const statuses = () => ctx.stepBar(steps, 'mode', sections).children.map(step => step.props.status)
  assert.deepEqual(Array.from(statuses()), ['process', 'wait'])
  ctx.validationAttempted.value = true
  assert.deepEqual(Array.from(statuses()), ['process', 'error'])
})

test('validation expands the folded section before focusing an invalid setting', () => {
  const ctx = vm.createContext({ runBudgetOpen: ref(false), extraConditionsOpen: ref(false), companyConditionsOpen: ref(false),
    route: ref('auto'), autoStep: ref('job-run-mode'), activeAutoSection: ref(''),
    stepOfField: () => 'job-preferences', R: { nextTick() {} } })
  vm.runInContext(shipped('    function focusError(', '    // Marks the field'), ctx)
  for (const field of ['requiredConditions', 'hrRule', 'regexType', 'regexDesc', 'categories', 'description']) {
    ctx.extraConditionsOpen.value = false
    ctx.focusError({ field })
    assert.equal(ctx.extraConditionsOpen.value, true, field)
    assert.equal(ctx.autoStep.value, 'job-preferences')
  }
  ctx.focusError({ field: 'excluded' })
  assert.equal(ctx.companyConditionsOpen.value, true)
  ctx.focusError({ field: 'run-budget' })
  assert.equal(ctx.runBudgetOpen.value, true)
})

test('confirmation exposes the job scope and marking policy without opening technical settings', () => {
  const ctx = vm.createContext({ h, checks: ref('auto'), checkFactRows: () => [
    ['职位来源', '搜索：工程师'], ['工作城市', '深圳'], ['期望薪资', '10000–20000元/月'],
    ['默认处理方式', '略过'], ['运行预算', '500次'], ['学历要求', '本科'],
  ] })
  vm.runInContext(shipped('    function checkFacts(', '    const strategies ='), ctx)
  const tree = ctx.checkFacts(), visible = flatten(tree.children[0])
  assert.ok(visible.some(node => node.children === '深圳'))
  assert.ok(visible.some(node => node.children === '略过'))
  assert.ok(!visible.some(node => node.children === '500次'))
  const more = flatten(tree).find(node => node.tag === 'details')
  assert.ok(flatten(more).some(node => node.children === '本科'))
})

test('an invalid stored run limit remains repairable without breaking the setup page', () => {
  const defaults = { requests: 500, detailRequests: 200, activeMinutes: 120 }
  let changes = 0
  const ctx = vm.createContext({ h, draft: ref({ runBudget: 'invalid' }), DEFAULT_RUN_BUDGET: defaults,
    hint: text => h('p', text), button: (label, action) => ({ tag: 'button', label, action }), changed: () => { changes++ } })
  vm.runInContext(shipped('    function budgetControls(', '    function platformControls('), ctx)
  const tree = ctx.budgetControls()
  assert.equal(tree.props.role, 'alert')
  const reset = flatten(tree).find(node => node.tag === 'button')
  reset.action()
  assert.equal(ctx.draft.value.runBudget.requests, defaults.requests)
  assert.notEqual(ctx.draft.value.runBudget, defaults)
  assert.equal(changes, 1)
})

test('switching to real greetings still requires the existing explicit confirmation', async () => {
  let approved = false, confirmations = 0, confirmed = false
  const ctx = vm.createContext({ readFlag: () => confirmed, writeFlag: () => { confirmed = true },
    runModeSelectionKey: ref(0),
    confirmBox: async () => { confirmations++; return approved }, update: (draft, key, value) => { draft[key] = value },
    isCollectAll: draft => draft.runMode === 'collect' && draft.collectOnlyMatchingJobs === false, R: { message() {} } })
  vm.runInContext(shipped('    async function switchRunMode(', '    function runModeCard('), ctx)
  const draft = { runMode: 'collect', collectOnlyMatchingJobs: true, cities: ['深圳'], strategy: 1 }
  await ctx.switchRunMode(draft, 'chat')
  assert.equal(draft.runMode, 'collect')
  assert.equal(confirmed, false)
  assert.equal(ctx.runModeSelectionKey.value, 1)
  approved = true
  await ctx.switchRunMode(draft, 'chat')
  assert.equal(draft.runMode, 'chat')
  await ctx.switchRunMode(draft, 'collect')
  await ctx.switchRunMode(draft, 'chat')
  assert.equal(confirmations, 2)
  assert.deepEqual(draft.cities, ['深圳'])
  assert.equal(draft.strategy, 1)
})
