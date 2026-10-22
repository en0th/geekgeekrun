import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import yaml from 'js-yaml'
import { validatePackageReports, requiredPlatforms } from '../../release/validate-package-reports.mjs'
import { repositoryRoot } from '../test-suite.mjs'

const version = '0.23.0', sha = 'a'.repeat(40)
function fixtures() {
  return requiredPlatforms.map(identity => {
    const [platform, arch] = identity.split('-')
    const name = `geekgeekrun-ui_${version}_${platform === 'linux' ? 'amd64' : arch}${platform === 'win32' ? '_setup.exe' : platform === 'darwin' ? '.dmg' : '.deb'}`
    return { success: true, platform, arch, version, sourceSha: sha, previousTag: 'ui-v0.22.2',
      configurationPreserved: true, uninstallPreservesData: true, sent: 0, marked: 0, bossRequests: 0,
      installer: { name, bytes: 7, sha256: createHash('sha256').update('fixture').digest('hex') },
      data: ['fresh', 'seed', 'upgrade', 'reopen'].map(phase => ({ success: true, phase, platform, arch,
        version: phase === 'seed' ? '0.22.2' : version, migrations: phase === 'seed' ? 9 : 15,
        electron: '39.2.7', abi: '140', jobs: phase === 'fresh' ? 0 : 3, historicalChats: phase === 'fresh' ? 0 : 1,
        sent: 0, marked: 0, bossRequests: 0 })),
      gui: [0, 3, 3].map(jobs => ({ success: true, version, jobs, rendererLoaded: true, lazyPages: true,
        normalExit: true, sent: 0, marked: 0, bossRequests: 0 })) }
  })
}
const options = { version, sha, reportsOnly: true }

test('the release guard requires four native architectures and the exact checked commit', () => {
  const reports = fixtures()
  assert.equal(validatePackageReports(reports, options).success, true)
  assert.throws(() => validatePackageReports(reports.slice(1), options), /four native/)
  reports[0].sourceSha = 'b'.repeat(40)
  assert.throws(() => validatePackageReports(reports, options), /commit/)
  assert.throws(() => validatePackageReports([...fixtures().slice(1), fixtures()[1]], options))
})

test('missing install/restart evidence, changed data or messaging activity cannot pass publication', () => {
  for (const change of [r => { r[0].success = false }, r => { r[0].configurationPreserved = false },
    r => { r[0].gui.pop() }, r => { r[1].gui[2].normalExit = false },
    r => { r[2].data[3].historicalChats = 0 }, r => { r[3].data[2].migrations = 9 },
    r => { r[1].data[1].version = version }, r => { r[2].sent = 1 }, r => { r[3].gui[0].bossRequests = 1 }]) {
    const reports = fixtures(); change(reports)
    assert.throws(() => validatePackageReports(reports, options))
  }
})

test('publication checks the exact installer bytes rather than trusting a green report alone', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-package-guard-'))
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }))
  const reports = fixtures(), strict = { version, sha, installersDirectory: folder }
  for (const report of reports) fs.writeFileSync(path.join(folder, report.installer.name), 'fixture')
  assert.equal(validatePackageReports(reports, strict).installers.length, 4)
  fs.writeFileSync(path.join(folder, reports[0].installer.name), 'changed')
  assert.throws(() => validatePackageReports(reports, strict), /checksum/)
  fs.rmSync(path.join(folder, reports[0].installer.name))
  assert.throws(() => validatePackageReports(reports, strict), /Missing/)
})

test('manual candidates stay unpublished and release jobs require installation and byte verification', () => {
  const workflow = yaml.load(fs.readFileSync(path.join(repositoryRoot, '.github/workflows/release-ui.yml'), 'utf8'))
  assert.equal(workflow.on.workflow_dispatch.inputs.publish.default, false)
  assert.equal(workflow.jobs.release.needs, 'installation_gate')
  assert.match(workflow.jobs.release.if, /inputs.publish/)
  assert.deepEqual(workflow.jobs.installation_gate.needs, ['build_on_windows', 'build_on_macos', 'build_on_linux'])
  assert.ok(workflow.jobs.release.steps.some(step => step.run?.includes('validate-package-reports.mjs release-artifacts')))
  assert.equal(workflow.jobs.release.steps.find(step => step.name === 'Publish validated release').with.allowUpdates, false)
})
