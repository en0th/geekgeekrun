import test from 'node:test'
import assert from 'node:assert/strict'
import { awaitReleaseChecks } from '../await-release-checks.mjs'

const identity = { repository: 'fixture/project', branch: 'automation/release-ui-v1.0.0-1-1', sha: 'a'.repeat(40) }
const completed = { id: 2, event: 'workflow_dispatch', head_sha: identity.sha,
  head_branch: identity.branch, status: 'completed', conclusion: 'success', html_url: 'https://github.com/fixture/project/actions/runs/2' }

function fixture({ runs = [[completed]], gate = 'success', conclusion = 'success' } = {}) {
  let clock = 0, reads = 0
  const calls = []
  const request = async (method, endpoint, body) => {
    calls.push({ method, endpoint, body })
    if (method === 'POST') return null
    if (endpoint.includes('/jobs?')) return { jobs: gate === null ? [] : [{ name: 'checks / Quality gate', conclusion: gate }] }
    const current = reads++ === 0 ? [] : runs[Math.min(reads - 2, runs.length - 1)]
    return { workflow_runs: current.map(run => ({ ...run, conclusion })) }
  }
  return { calls, options: { ...identity, request, now: () => clock, pause: async ms => { clock += ms }, timeoutMs: 45000 } }
}

test('release metadata advances only after a new CI run for the exact candidate and its gate succeed', async () => {
  const f = fixture({ runs: [[{ ...completed, head_sha: 'b'.repeat(40) }], [{ ...completed, status: 'in_progress' }], [completed]] })
  assert.deepEqual(await awaitReleaseChecks(f.options), { id: 2, url: completed.html_url, sha: identity.sha })
  assert.deepEqual(f.calls.find(call => call.method === 'POST').body, { ref: identity.branch })
})

test('a successful workflow with a missing, skipped or failed required gate is rejected', async () => {
  for (const gate of [null, 'skipped', 'failure']) {
    await assert.rejects(awaitReleaseChecks(fixture({ gate }).options), /CI did not pass/)
  }
  await assert.rejects(awaitReleaseChecks(fixture({ conclusion: 'failure' }).options), /CI did not pass/)
})

test('old successful runs and a different branch cannot satisfy the version commit check', async () => {
  const old = fixture()
  const request = old.options.request
  let first = true
  old.options.request = async (...args) => {
    const result = await request(...args)
    if (first) { first = false; return { workflow_runs: [completed] } }
    return result
  }
  await assert.rejects(awaitReleaseChecks(old.options), /Timed out/)
  await assert.rejects(awaitReleaseChecks(fixture({ runs: [[{ ...completed, head_branch: 'master' }]] }).options), /Timed out/)
})

test('dispatch failures and invalid identities stop before a successful release can be reported', async () => {
  const f = fixture()
  const request = f.options.request
  f.options.request = (method, ...args) => method === 'POST' ? Promise.reject(Error('dispatch denied')) : request(method, ...args)
  await assert.rejects(awaitReleaseChecks(f.options), /dispatch denied/)
  await assert.rejects(awaitReleaseChecks({ ...f.options, branch: 'master' }), /Invalid release candidate/)
})
