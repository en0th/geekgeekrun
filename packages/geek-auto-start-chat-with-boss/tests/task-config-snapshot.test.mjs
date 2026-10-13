import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { jobConfigSnapshot, readTaskConfigSnapshot, writeTaskConfigSnapshot } from '../task-config-snapshot.mjs'

const config = (extra = {}) => ({ 'boss.json': { autoChatRunMode: 'collect', expectCityList: ['深圳'], expectWorkExpList: [104],
  expectJobNameRegExpStr: '产品', jobSourceList: [{ type: 'recommend', enabled: true }],
  autoReminder: { geminiApiKey: 'DO_NOT_CAPTURE' }, groupRobotAccessToken: 'DO_NOT_CAPTURE', ...extra },
  'common-job-condition-config.json': { expectSalaryLow: 5, expectSalaryHigh: 10 },
  'target-company-list.json': ['ACME,Inc'] })
test('queued task retains submitted mode, sources and every condition after the live config changes', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-config-snapshot-'))
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }))
  const live = config()
  const file = writeTaskConfigSnapshot(folder, 94, live)
  live['boss.json'].autoChatRunMode = 'chat'
  live['boss.json'].expectCityList = ['北京']
  live['boss.json'].expectJobNameRegExpStr = '工程师'
  live['boss.json'].expectWorkExpList = [106]
  live['boss.json'].jobSourceList = [{ type: 'search', keyword: '工程师' }]
  const saved = readTaskConfigSnapshot(file)
  assert.equal(saved['boss.json'].autoChatRunMode, 'collect')
  assert.deepEqual(saved['boss.json'].expectCityList, ['深圳'])
  assert.equal(saved['boss.json'].expectJobNameRegExpStr, '产品')
  assert.deepEqual(saved['boss.json'].expectWorkExpList, [104])
  assert.deepEqual(saved['boss.json'].jobSourceList, [{ type: 'recommend', enabled: true }])
  assert.equal(JSON.stringify(saved).includes('DO_NOT_CAPTURE'), false)
  assert.deepEqual(saved['target-company-list.json'], ['ACME,Inc'])
})
test('only explicit resume updates conditions, and it cannot silently turn collection into outreach', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-resume-config-'))
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }))
  const file = writeTaskConfigSnapshot(folder, 95, config())
  assert.throws(() => writeTaskConfigSnapshot(folder, 95, config({ autoChatRunMode: 'chat' }), { resuming: true }), /不能切换/)
  writeTaskConfigSnapshot(folder, 95, config({ expectWorkExpList: [] }), { resuming: true })
  assert.deepEqual(readTaskConfigSnapshot(file)['boss.json'].expectWorkExpList, [])
})
test('no accidental credential capture and malformed snapshots fail closed', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-bad-config-'))
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }))
  assert.equal(Object.hasOwn(jobConfigSnapshot(config())['boss.json'], 'autoReminder'), false)
  const file = path.join(folder, 'invalid.json')
  fs.writeFileSync(file, '{}')
  assert.throws(() => readTaskConfigSnapshot(file), /快照无效/)
  assert.throws(() => writeTaskConfigSnapshot(folder, '../bad', config()), /编号无效/)
})
