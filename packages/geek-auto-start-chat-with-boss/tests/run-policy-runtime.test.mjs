import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { writeTaskConfigSnapshot } from '../task-config-snapshot.mjs'
import { policyRunConfig } from '../run-policy.mjs'

const runtimeUrl = new URL('../runtime-file-utils.mjs', import.meta.url).href
const restUrl = new URL('../sage-time.mjs', import.meta.url).href
function runtime(t, policy, boss = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-run-policy-runtime-'))
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }))
  fs.mkdirSync(path.join(folder, 'config'))
  fs.writeFileSync(path.join(folder, 'config/boss.json'), JSON.stringify({ autoChatRunMode: 'collect',
    collectOnlyMatchingJobs: true, autoChatRunBudget: { requests: 17, detailRequests: 9, activeMinutes: 5 },
    expectCityList: ['深圳'], requiredJobConditions: { degrees: ['本科'] }, autoChatFilterCombinationLimit: 7, ...boss }))
  if (policy !== undefined) fs.writeFileSync(path.join(folder, 'config/run-policy.json'), JSON.stringify(policy))
  return folder
}
function child(folder, body, snapshot = '') {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
    const r=await import(${JSON.stringify(runtimeUrl)});const folder=process.env.GEEKGEEKRUN_RUNTIME_DIR;${body}`], {
    env: { ...process.env, GEEKGEEKRUN_RUNTIME_DIR: folder, GEEKGEEKRUN_TASK_CONFIG_FILE: snapshot }, encoding: 'utf8', timeout: 15000,
  })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
}

test('explicit global policy applies to standalone reads without replacing filters, mode or raw config', t => {
  for (const profile of ['safe', 'deep', 'fast']) {
    const folder = runtime(t, { profile, rest: { enabled: false } })
    const expected = policyRunConfig({ profile, rest: { enabled: false } })
    child(folder, `const raw=r.readConfigFile('boss.json'),actual=r.readRunConfigFile('boss.json');
      assert.equal(raw.autoChatRunBudget.requests,17);assert.equal(raw.autoChatRunPolicy,undefined);
      assert.deepEqual(actual.autoChatRunBudget,${JSON.stringify(expected.autoChatRunBudget)});
      assert.equal(actual.autoChatRunPolicy.profile,${JSON.stringify(profile)});
      assert.equal(actual.autoChatTimedRest.enabled,false);assert.equal(actual.isSageTimeEnabled,false);
      assert.equal(actual.autoChatRunMode,'collect');assert.equal(actual.collectOnlyMatchingJobs,true);
      assert.deepEqual(actual.expectCityList,['深圳']);assert.deepEqual(actual.requiredJobConditions,{degrees:['本科']});
      assert.equal(actual.autoChatFilterCombinationLimit,7);assert.deepEqual(r.readConfigFile('boss.json'),raw);`)
  }
})

test('a standalone task captures its policy once and only the next process uses later settings', t => {
  const folder = runtime(t, { profile: 'deep' })
  child(folder, `assert.equal(r.readRunConfigFile('boss.json').autoChatRunPolicy.profile,'deep');
    await r.writeConfigFile('run-policy.json',{profile:'fast'});
    assert.equal(r.readRunConfigFile('boss.json').autoChatRunPolicy.profile,'deep');`)
  child(folder, `assert.equal(r.readRunConfigFile('boss.json').autoChatRunPolicy.profile,'fast');`)
})

test('legacy CLI configuration remains unchanged until an explicit policy is saved for a new task', t => {
  const folder = runtime(t)
  child(folder, `const raw=r.readConfigFile('boss.json');assert.deepEqual(r.readRunConfigFile('boss.json'),raw);
    await r.writeConfigFile('run-policy.json',{profile:'deep'});
    assert.deepEqual(r.readRunConfigFile('boss.json'),raw);`)
  child(folder, `assert.equal(r.readRunConfigFile('boss.json').autoChatRunPolicy.profile,'deep');`)
})

test('frozen queued task configuration takes priority over changed or invalid global policy', t => {
  const folder = runtime(t, { profile: 'fast' })
  const boss = { ...JSON.parse(fs.readFileSync(path.join(folder, 'config/boss.json'), 'utf8')), ...policyRunConfig({ profile: 'deep' }) }
  const file = writeTaskConfigSnapshot(path.join(folder, 'snapshots'), 1, { 'boss.json': boss })
  fs.writeFileSync(path.join(folder, 'config/run-policy.json'), '{invalid policy')
  child(folder, `const actual=r.readRunConfigFile('boss.json');assert.equal(actual.autoChatRunPolicy.profile,'deep');
    assert.deepEqual(actual.autoChatRunBudget,{requests:1000,detailRequests:400,activeMinutes:240});
    assert.equal(actual.autoChatRunMode,'collect');assert.equal(actual.collectOnlyMatchingJobs,true);`, file)
})

test('invalid explicit policies stop configuration loading and preserve their original bytes', t => {
  for (const value of ['{invalid JSON', '{"profile":"unsupported"}', '{"profile":"safe","rest":{"enabled":"yes"}}']) {
    const folder = runtime(t), file = path.join(folder, 'config/run-policy.json')
    fs.writeFileSync(file, value)
    child(folder, `assert.throws(()=>r.readRunConfigFile('boss.json'),e=>e.code==='GGR_JSON_INVALID');`)
    assert.equal(fs.readFileSync(file, 'utf8'), value)
  }
})

test('standalone rest honors the global minute policy instead of obsolete per-operation settings', t => {
  const folder = runtime(t, { profile: 'safe', rest: { enabled: false } },
    { isSageTimeEnabled: true, sageTimeOpTimes: 1, sageTimePauseMinute: 1 })
  child(folder, `const {waitForSageTimeOrJustContinue:wait}=await import(${JSON.stringify(restUrl)});
    const hooks={sageTimeEnter:{promise:async()=>{throw Error('Obsolete operation-count rest must not run')}}};
    for(let n=0;n<4;n++)await wait({hooks});`)
})

test('CLI exposes persisted daily seeding and stops rest continuation when identity recheck fails', async () => {
  const { SyncHook, AsyncSeriesHook, AsyncSeriesWaterfallHook } = createRequire(import.meta.url)('tapable')
  const source = fs.readFileSync(new URL('../../run-core-of-geek-auto-start-chat-with-boss/main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('  const hooks = {'), end = source.indexOf('  initPlugins(hooks,', start)
  assert.ok(start > 0 && end > start)
  let checked = 0, continued = false
  const context = vm.createContext({ SyncHook, AsyncSeriesHook, AsyncSeriesWaterfallHook,
    recheckAfterRest: async () => { checked++; throw Error('account changed') } })
  vm.runInContext(source.slice(start, end) + ';globalThis.fixtureHooks=hooks', context)
  const hooks = context.fixtureHooks
  hooks.dailyQuotaSeed.tapPromise('PersistedDailyCount', async (seed, identity) => {
    assert.equal(identity.accountId, 'fixture'); return Math.max(seed, 12)
  })
  assert.equal(await hooks.dailyQuotaSeed.promise(0, { accountId: 'fixture', day: '2026-10-27' }), 12)
  hooks.sageTimeExit.tapPromise('NextOperation', async () => { continued = true })
  await assert.rejects(hooks.sageTimeExit.promise(), /account changed/)
  assert.equal(checked, 1); assert.equal(continued, false)
})
