import test from 'node:test'
import assert from 'node:assert/strict'
import { ensureCompanySource, potentialSourceCount } from '../src/renderer/src/page/Ux/search-settings.js'
import { normalizeCache } from '../src/common/ux-validation.mjs'
import { exportTemplates, parseTemplateFile } from '../src/renderer/src/page/Ux/template-io.js'
import { jobConfigSnapshot } from '../../geek-auto-start-chat-with-boss/task-config-snapshot.mjs'
import { normalizeJobSources } from '../../geek-auto-start-chat-with-boss/search-source.mjs'
import { describeCompanySource } from '../../geek-auto-start-chat-with-boss/company-source.mjs'
const brand = '0123456789abcdef1nRz'
const draft = () => ({ ...Object.fromEntries(['titles', 'cities', 'companies', 'excluded', 'experience', 'categories',
  'description', 'inheritedFields', 'moreSources', 'sourceWords'].map(key => [key, []])), overrides: {}, scopes: {},
  sourceList: [{ type: 'search', enabled: false, children: [] }] })

test('legacy drafts and templates get an editable disabled company source once without changing existing choices', () => {
  const d = draft(); ensureCompanySource(d); ensureCompanySource(d)
  assert.equal(d.sourceList.length, 2)
  assert.equal(d.sourceList[1].enabled, false)
  assert.equal(d.sourceList[1].children[0].brandId, '')
  assert.equal(normalizeCache({ draft: d }).draft.sourceList.length, 2)
  assert.deepEqual(normalizeJobSources(d.sourceList), [])
})

test('company draft, template export/import and queued snapshots retain ID, search word and notes independently of live edits', () => {
  const d = ensureCompanySource(draft()), group = d.sourceList[1]
  group.enabled = true; Object.assign(group.children[0], { brandId: brand, keyword: ' Java ', label: '备注公司' })
  const { templates } = parseTemplateFile(exportTemplates([{ name: '公司任务', snapshot: d }]))
  const cached = normalizeCache({ draft: d, templates: [{ id: 't', ...templates[0] }], templateDrafts: { t: d } })
  assert.deepEqual(cached.templates[0].snapshot.sourceList, d.sourceList)
  assert.deepEqual(cached.templateDrafts.t.sourceList, d.sourceList)
  const queued = jobConfigSnapshot({ 'boss.json': { jobSourceList: d.sourceList } })
  group.children[0].brandId = 'fedcba98765432101nRz'
  const saved = queued['boss.json'].jobSourceList[1].children[0]
  assert.equal(saved.brandId, brand)
  assert.match(describeCompanySource(saved), /备注公司.*0123456789abcdef1nRz.*Java/)
  assert.deepEqual(normalizeJobSources(queued['boss.json'].jobSourceList), [{ type: 'company', brandId: brand, keyword: 'Java' }])
})

test('rotation counts distinct company/keyword identities and does not count presentation duplicates', () => {
  const d = draft()
  d.sourceList.push({ type: 'company', enabled: true, children: [
    { enabled: true, brandId: brand }, { enabled: true, brandId: `https://www.zhipin.com/gongsi/${brand}.html?ka=ignored`, label: '重复' },
    { enabled: true, brandId: brand, keyword: 'Java' }, { enabled: false, brandId: 'bad' }] })
  assert.equal(potentialSourceCount(d), 2)
  assert.equal(normalizeJobSources(d.sourceList).length, 2)
  const malformed = structuredClone(d); malformed.sourceList[1].children[0].brandId = {}
  assert.equal(normalizeCache({ draft: malformed }).draft, undefined)
})
