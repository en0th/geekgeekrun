import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyPublication } from '../../release/verify-publication.mjs'
import { requiredPlatforms } from '../../release/validate-package-reports.mjs'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { repositoryRoot } from '../test-suite.mjs'

const sha = 'a'.repeat(40), workflowSha = 'b'.repeat(40), repository = 'owner/repo'
function fixture() {
  const values = { repo: { default_branch: 'master' }, branch: { commit: { sha: workflowSha } },
    comparison: { merge_base_commit: { sha }, files: [] },
    checks: { check_runs: [{ name: 'checks / Quality gate', app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success' }] },
    run: { repository: { full_name: repository }, head_repository: { full_name: repository }, path: '.github/workflows/release-ui.yml',
      event: 'workflow_dispatch', head_sha: sha, status: 'completed', conclusion: 'success', html_url: 'https://example.test/run' },
    jobs: { jobs: ['verify / Quality gate', 'Installer and upgrade gate'].map(name => ({ name, conclusion: 'success' })) },
    artifacts: { artifacts: requiredPlatforms.flatMap(platform => ['binary-geekgeekrun-ui-', 'package-validation-']
      .map(prefix => ({ name: prefix + platform, expired: false, workflow_run: { head_sha: sha } }))) } }
  const request = async endpoint => {
    if (endpoint === '/repos/' + repository) return values.repo
    if (endpoint.includes('/branches/')) return values.branch
    if (endpoint.includes('/compare/')) return values.comparison
    if (endpoint.includes('/check-runs')) return values.checks
    if (endpoint.includes('/jobs?')) return values.jobs
    if (endpoint.includes('/artifacts?')) return values.artifacts
    return values.run
  }
  return { values, options: { request, repository, sha, workflowSha, ref: 'refs/heads/master', runId: '123' } }
}

test('a checked, merged candidate can promote the already-tested artifacts without rebuilding', async () => {
  const { options } = fixture()
  assert.deepEqual(await verifyPublication(options), { sha, runId: '123', url: 'https://example.test/run' })
})

test('publication permission maintenance can preserve tested binaries while application changes and renames cannot', async () => {
  const f = fixture()
  f.values.comparison.files = [{ filename: '.github/workflows/publish-validated-release.yml' },
    { filename: 'scripts/release/verify-publication.mjs' }]
  assert.equal((await verifyPublication(f.options)).sha, sha)
  f.values.comparison.files[0].previous_filename = 'packages/ui/package.json'
  await assert.rejects(verifyPublication(f.options))
  const workflow = yaml.load(fs.readFileSync(path.join(repositoryRoot, '.github/workflows/publish-validated-release.yml'), 'utf8'))
  assert.equal(workflow.jobs.publish.permissions.checks, 'read')
  assert.equal(workflow.jobs.publish.permissions.actions, 'read')
})

test('publication refuses another branch, source tree, commit, workflow or untrusted check', async () => {
  for (const change of [f => { f.options.ref = 'refs/heads/feature' }, f => { f.values.branch.commit.sha = sha },
    f => { f.values.comparison.merge_base_commit.sha = workflowSha }, f => { f.values.comparison.files = [{ filename: 'packages/ui/package.json' }] },
    f => { f.values.run.head_sha = workflowSha }, f => { f.values.run.head_repository.full_name = 'fork/repo' },
    f => { f.values.run.path = '.github/workflows/ci.yml' }, f => { f.values.checks.check_runs[0].app.slug = 'another-app' }]) {
    const f = fixture(); change(f); await assert.rejects(verifyPublication(f.options))
  }
})

test('failed, skipped, stale or incomplete validation cannot publish a formal release', async () => {
  for (const change of [f => { f.values.run.conclusion = 'failure' }, f => { f.values.run.status = 'in_progress' },
    f => { f.values.checks.check_runs[0].conclusion = 'skipped' }, f => { f.values.jobs.jobs[1].conclusion = 'skipped' },
    f => { f.values.artifacts.artifacts.pop() }, f => { f.values.artifacts.artifacts[0].expired = true },
    f => { f.values.artifacts.artifacts[0].workflow_run.head_sha = workflowSha }]) {
    const f = fixture(); change(f); await assert.rejects(verifyPublication(f.options))
  }
})
