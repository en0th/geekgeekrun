import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { discoverTests, assertReport } from '../test-suite.mjs'

function folder(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-ci-contract-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}
function write(root, name, contents = '') {
  const file = path.join(root, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, contents)
  return file
}

test('discovery covers every workspace test, future suites, release helpers and CI itself', t => {
  const root = folder(t)
  const expected = ['packages/ui/tests/favorites.test.mjs', 'packages/sqlite-plugin/tests/native.test.cjs',
    'packages/new-feature/tests/nested/extra.test.mjs', '.github/scripts/release/tests/notes.test.mjs',
    'scripts/ci/tests/runner.test.mjs']
  for (const file of [...expected, 'packages/new-feature/tests/fake-worker.cjs']) write(root, file)
  const relative = file => path.relative(root, file).split(path.sep).join('/')
  assert.deepEqual(discoverTests(root).map(relative), expected.sort())
  assert.deepEqual(discoverTests(root, true).map(relative), [
    'packages/sqlite-plugin/tests/native.test.cjs', 'packages/ui/tests/favorites.test.mjs'
  ])
})

test('missing suites, empty reports, failures and skipped native cases cannot be green', t => {
  const root = folder(t)
  fs.mkdirSync(path.join(root, 'packages'))
  assert.throws(() => discoverTests(root), /未找到/)
  write(root, 'packages/ui/tests/favorites.test.mjs')
  assert.throws(() => discoverTests(root, true), /未找到 SQLite/)
  const file = write(root, 'report.xml', '<testsuites/>')
  assert.throws(() => assertReport(file), /为空或无效/)
  fs.writeFileSync(file, '<testsuites><testcase><failure/></testcase></testsuites>')
  assert.throws(() => assertReport(file), /包含失败/)
  fs.writeFileSync(file, '<testsuites><testcase><skipped/></testcase></testsuites>')
  assert.throws(() => assertReport(file, { requireNative: true }), /不允许跳过/)
  assert.doesNotThrow(() => assertReport(file))
})

function runFixture(t, body, options = [], native = 'ok') {
  const root = folder(t)
  write(root, 'packages/ui/package.json', '{}')
  write(root, 'packages/ui/node_modules/better-sqlite3/index.js', native === 'ok'
    ? 'module.exports=class Database{prepare(){return{get:()=>({ok:1})}}close(){}}'
    : 'module.exports=class Database{constructor(){throw Error("NATIVE_ABI_FIXTURE_FAILURE")}}')
  write(root, 'packages/fixture/tests/fixture.test.cjs', body)
  for (const name of ['run-tests.mjs', 'test-suite.mjs']) {
    write(root, 'scripts/ci/' + name, fs.readFileSync(new URL('../' + name, import.meta.url)))
  }
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/ci/run-tests.mjs'), ...options], {
    encoding: 'utf8', timeout: 15000
  })
  if (result.error) throw result.error
  return { root, ...result }
}

test('the real runner propagates test failures, writes a report, and preserves a normal successful run', t => {
  const failed = runFixture(t, "require('node:test').test('failure',()=>{throw Error('EXPECTED_TEST_FAILURE')})")
  assert.notEqual(failed.status, 0)
  assert.match(fs.readFileSync(path.join(failed.root, '.ci-reports/regression.xml'), 'utf8'), /<failure\b/)
  const passed = runFixture(t, "require('node:test').test('pass',()=>{})", ['--require-native'])
  assert.equal(passed.status, 0, passed.stderr)
  assertReport(path.join(passed.root, '.ci-reports/regression.xml'), { requireNative: true })
})

test('the real CI runner rejects an ABI preflight failure and an otherwise-successful skipped test', t => {
  const abi = runFixture(t, "throw Error('tests must not start')", ['--require-native'], 'broken')
  assert.notEqual(abi.status, 0)
  assert.match(abi.stderr, /NATIVE_ABI_FIXTURE_FAILURE/)
  assert.equal(fs.existsSync(path.join(abi.root, '.ci-reports/regression.xml')), false)
  const skipped = runFixture(t, "require('node:test').test('skip',{skip:'fixture'},()=>{})", ['--require-native'])
  assert.notEqual(skipped.status, 0)
  assert.match(skipped.stderr, /不允许跳过/)
})
