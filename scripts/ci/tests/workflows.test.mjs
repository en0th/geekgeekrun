import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { repositoryRoot, discoverTests } from '../test-suite.mjs'

const read = file => yaml.load(fs.readFileSync(path.join(repositoryRoot, file), 'utf8'))
const quality = read('.github/workflows/quality-checks.yml')
const reusable = './.github/workflows/quality-checks.yml'

test('PRs, merge queues and protected-branch pushes all invoke the same read-only quality checks', () => {
  const ci = read('.github/workflows/ci.yml')
  for (const event of ['pull_request', 'push', 'merge_group', 'workflow_dispatch']) assert.ok(Object.hasOwn(ci.on, event))
  assert.equal(ci.jobs.checks.uses, reusable)
  assert.equal(ci.jobs.checks.with.ref, '${{ github.sha }}')
  assert.deepEqual(ci.permissions, { contents: 'read' })
  assert.deepEqual(quality.permissions, { contents: 'read' })
  assert.equal(Object.hasOwn(quality, 'concurrency'), false)
})

test('SQLite compilation precedes both type checks and full regression, and native checks cannot silently skip', () => {
  const steps = quality.jobs.node_checks.steps
  const index = command => steps.findIndex(step => step.run?.includes(command))
  const build = index('pnpm build:sqlite')
  assert.ok(build >= 0)
  for (const check of ['typecheck:node', 'typecheck:web', 'pnpm test:ci']) assert.ok(index(check) > build)
  assert.ok(index('geekgeekrun-ui build') > index('pnpm test:ci'))
  assert.ok(quality.jobs.electron_native.steps.some(step => step.run?.includes('pnpm test:electron')))
  assert.deepEqual(quality.jobs.quality_gate.needs.sort(), ['electron_native', 'node_checks'])
  assert.equal(quality.jobs.quality_gate.if, 'always()')
  const pkg = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json')))
  assert.match(pkg.scripts['test:ci'], /--require-native/)
  assert.match(pkg.scripts['test:electron'], /--electron/)
  const setup = read('.github/actions/setup-checks/action.yml')
  assert.ok(setup.runs.steps.some(step => step.run?.includes('--frozen-lockfile --ignore-scripts')))
})

test('the full regression command includes configuration durability and task execution contracts', () => {
  const files = new Set(discoverTests().map(file => path.relative(repositoryRoot, file).split(path.sep).join('/')))
  for (const file of ['packages/ui/tests/json-persistence.test.mjs', 'packages/ui/tests/json-storage-errors.test.mjs',
    'packages/ui/tests/task-contracts.test.mjs', 'packages/ui/tests/task-completion.test.mjs',
    'packages/geek-auto-start-chat-with-boss/tests/runtime-files.test.mjs',
    'packages/utils/tests/atomic-file.test.mjs', 'packages/pm/tests/daemon-queue.test.cjs']) assert.ok(files.has(file), file)
})

test('version bumps and all release builds require the checked commit or tag first', () => {
  const auto = read('.github/workflows/auto-release.yml'), release = read('.github/workflows/release-ui.yml')
  assert.equal(auto.jobs.prepare.needs, 'verify')
  assert.equal(auto.jobs.verify.uses, reusable)
  assert.equal(auto.jobs.verify.with.ref, '${{ github.sha }}')
  assert.equal(auto.jobs.prepare.steps.find(step => step.name === 'Checkout source').with.ref, '${{ github.sha }}')
  assert.equal(release.jobs.verify.uses, reusable)
  assert.equal(release.jobs.verify.with.ref, '${{ inputs.tag || github.ref }}')
  for (const job of ['build_on_windows', 'build_on_macos', 'build_on_linux']) assert.equal(release.jobs[job].needs, 'verify')
  assert.notEqual(auto.jobs.verify.with.artifact_prefix, release.jobs.verify.with.artifact_prefix)
})
