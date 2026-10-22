import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { requiredPlatforms } from './validate-package-reports.mjs'

export async function verifyPublication({ request, repository, ref, workflowSha, sha, runId }) {
  assert.match(repository, /^[\w.-]+\/[\w.-]+$/)
  for (const hash of [workflowSha, sha]) assert.match(hash, /^[a-f\d]{40}$/)
  assert.match(String(runId), /^[1-9]\d{0,14}$/)
  const base = '/repos/' + repository
  const repo = await request(base)
  assert.equal(ref, 'refs/heads/' + repo.default_branch, 'Publication must run on the default branch')
  const branch = await request(base + '/branches/' + encodeURIComponent(repo.default_branch))
  assert.equal(branch.commit.sha, workflowSha, 'Default branch moved; validate its current revision first')
  const comparison = await request(base + '/compare/' + sha + '...' + workflowSha)
  assert.equal(comparison.merge_base_commit.sha, sha, 'Candidate is not merged into the default branch')
  assert.deepEqual(comparison.files, [], 'Default branch must have the identical validated source tree')
  const checks = await request(base + '/commits/' + workflowSha + '/check-runs?per_page=100')
  assert.ok(checks.check_runs.some(check => check.name === 'checks / Quality gate' &&
    check.app?.slug === 'github-actions' && check.status === 'completed' && check.conclusion === 'success'), 'Default branch Quality gate is required')
  const run = await request(base + '/actions/runs/' + runId)
  assert.equal(run.repository.full_name, repository)
  assert.equal(run.head_repository.full_name, repository)
  assert.equal(run.path, '.github/workflows/release-ui.yml')
  assert.equal(run.event, 'workflow_dispatch')
  assert.equal(run.head_sha, sha)
  assert.equal(run.status, 'completed'); assert.equal(run.conclusion, 'success')
  const jobs = await request(base + '/actions/runs/' + runId + '/jobs?per_page=100')
  for (const name of ['verify / Quality gate', 'Installer and upgrade gate'])
    assert.ok(jobs.jobs.some(job => job.name === name && job.conclusion === 'success'), 'Missing successful ' + name)
  const artifacts = await request(base + '/actions/runs/' + runId + '/artifacts?per_page=100')
  const expected = requiredPlatforms.flatMap(platform => ['binary-geekgeekrun-ui-' + platform, 'package-validation-' + platform])
  for (const name of expected) {
    const matches = artifacts.artifacts.filter(artifact => artifact.name === name)
    assert.equal(matches.length, 1, 'Missing or duplicate artifact: ' + name)
    assert.equal(matches[0].expired, false, 'Expired artifact: ' + name)
    assert.equal(matches[0].workflow_run.head_sha, sha, 'Artifact from another commit: ' + name)
  }
  return { sha, runId: String(runId), url: run.html_url }
}

async function main() {
  const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_REF, GITHUB_SHA, VALIDATED_SHA, VALIDATED_RUN_ID, GITHUB_OUTPUT } = process.env
  assert.ok(GITHUB_TOKEN, 'GitHub authentication is required')
  const request = async endpoint => {
    const response = await fetch('https://api.github.com' + endpoint, { headers: {
      Authorization: 'Bearer ' + GITHUB_TOKEN, Accept: 'application/vnd.github+json',
      'User-Agent': 'geekgeekrun-validated-publication', 'X-GitHub-Api-Version': '2022-11-28'
    }, signal: AbortSignal.timeout(45000) })
    if (!response.ok) throw Error('Publication verification API failed: ' + response.status)
    return response.json()
  }
  const verified = await verifyPublication({ request, repository: GITHUB_REPOSITORY, ref: GITHUB_REF,
    workflowSha: GITHUB_SHA, sha: VALIDATED_SHA, runId: VALIDATED_RUN_ID })
  fs.appendFileSync(GITHUB_OUTPUT, `sha=${verified.sha}\nrun_id=${verified.runId}\nurl=${verified.url}\n`)
  console.log(JSON.stringify(verified))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
