import test from 'node:test'
import assert from 'node:assert/strict'
import {
  exportTemplates,
  parseTemplateFile,
  uniqueName
} from '../src/renderer/src/page/Ux/template-io.js'

test('exported templates import back unchanged', () => {
  const items = [{ id: 'x', name: '前端', snapshot: { titles: ['前端'], runMode: 'chat' } }]
  const { templates, skipped } = parseTemplateFile(exportTemplates(items, new Date(0)))
  assert.deepEqual(templates, [{ name: '前端', snapshot: { titles: ['前端'], runMode: 'chat' } }])
  assert.equal(skipped, 0)
})

test('a single template object is accepted; broken entries are skipped', () => {
  assert.equal(parseTemplateFile('{"name":"a","snapshot":{}}').templates.length, 1)
  const r = parseTemplateFile(
    JSON.stringify({ templates: [{ name: 'ok', snapshot: {} }, { name: '', snapshot: {} }, { name: 'x' }] })
  )
  assert.deepEqual(r.templates.map((t) => t.name), ['ok'])
  assert.equal(r.skipped, 2)
})

test('files that are not templates are refused with a reason', () => {
  assert.throws(() => parseTemplateFile('not json'), /JSON/)
  assert.throws(() => parseTemplateFile('{"foo":1}'), /没有找到/)
  assert.throws(() => parseTemplateFile('{"format":"other","templates":[]}'), /不是本程序/)
  assert.throws(
    () => parseTemplateFile('{"format":"geekgeekrun-config-templates","version":99,"templates":[]}'),
    /升级/
  )
  assert.throws(() => parseTemplateFile('{"templates":[{"name":"a","snapshot":[]}]}'), /缺少/)
})

test('imported names never clash with existing ones', () => {
  assert.equal(uniqueName('前端', ['后端']), '前端')
  assert.equal(uniqueName('前端', ['前端']), '前端（2）')
  assert.equal(uniqueName('前端', ['前端', '前端（2）']), '前端（3）')
})
