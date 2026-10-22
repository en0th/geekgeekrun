import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'

export const requiredPlatforms = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64']
const zeroActions = item => {
  for (const field of ['sent', 'marked', 'bossRequests']) assert.equal(item[field], 0, field + ' must be zero')
}
const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  assert.equal(entry.isSymbolicLink(), false, 'Artifact symlinks are not supported')
  const file = path.join(directory, entry.name)
  return entry.isDirectory() ? walk(file) : [file]
})

export function validatePackageReports(reports, { version, sha, installersDirectory, reportsOnly = false }) {
  assert.match(version, /^\d+\.\d+\.\d+$/)
  assert.match(sha, /^[a-f\d]{40}$/)
  assert.equal(reports.length, requiredPlatforms.length, 'Exactly four native reports are required')
  assert.deepEqual(reports.map(item => item.platform + '-' + item.arch).sort(), requiredPlatforms)
  const files = reportsOnly ? [] : walk(installersDirectory)
  const installers = []
  for (const report of reports) {
    const identity = report.platform + '-' + report.arch
    assert.equal(report.success, true, identity)
    assert.equal(report.version, version, identity + ' version')
    assert.equal(report.sourceSha, sha, identity + ' commit')
    assert.equal(report.previousTag, 'ui-v0.22.2', identity + ' upgrade baseline')
    assert.equal(report.configurationPreserved, true, identity + ' configuration')
    assert.equal(report.uninstallPreservesData, true, identity + ' uninstall')
    zeroActions(report)
    assert.deepEqual(report.data.map(item => item.phase), ['fresh', 'seed', 'upgrade', 'reopen'])
    for (const item of report.data) {
      assert.equal(item.success, true)
      assert.equal(item.platform + '-' + item.arch, identity)
      assert.equal(item.electron, '39.2.7'); assert.equal(item.abi, '140')
      assert.equal(item.version, item.phase === 'seed' ? '0.22.2' : version)
      assert.equal(item.migrations, item.phase === 'seed' ? 9 : 15)
      assert.equal(item.jobs, item.phase === 'fresh' ? 0 : 3)
      assert.equal(item.historicalChats, item.phase === 'fresh' ? 0 : 1)
      zeroActions(item)
    }
    assert.equal(report.gui.length, 3)
    report.gui.forEach((item, index) => {
      for (const flag of ['success', 'rendererLoaded', 'lazyPages', 'normalExit']) assert.equal(item[flag], true, identity + ' ' + flag)
      assert.equal(item.version, version); assert.equal(item.jobs, index === 0 ? 0 : 3)
      zeroActions(item)
    })
    const installer = report.installer
    const expected = `geekgeekrun-ui_${version}_${report.platform === 'linux' ? 'amd64' : report.arch}${report.platform === 'win32' ? '_setup.exe' : report.platform === 'darwin' ? '.dmg' : '.deb'}`
    assert.equal(installer.name, expected)
    assert.match(installer.sha256, /^[a-f\d]{64}$/)
    assert.ok(Number.isSafeInteger(installer.bytes) && installer.bytes > 0)
    if (!reportsOnly) {
      const candidates = files.filter(file => path.basename(file) === installer.name)
      assert.equal(candidates.length, 1, 'Missing or duplicate installer: ' + installer.name)
      assert.equal(fs.statSync(candidates[0]).size, installer.bytes, installer.name + ' size')
      assert.equal(createHash('sha256').update(fs.readFileSync(candidates[0])).digest('hex'), installer.sha256, installer.name + ' checksum')
    }
    installers.push({ platform: identity, ...installer })
  }
  return { version, sourceSha: sha, success: true, installers: installers.sort((a, b) => a.platform.localeCompare(b.platform)) }
}

function main() {
  const args = process.argv.slice(2), directory = path.resolve(args[0] || '')
  assert.ok(args.length >= 1 && args.slice(1).every(arg => arg === '--reports-only'), 'Usage: validate-package-reports.mjs DIRECTORY [--reports-only]')
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const version = JSON.parse(fs.readFileSync(path.join(root, 'packages/ui/package.json'))).version
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const reports = walk(directory).filter(file => /^package-(darwin|linux|win32)-[\w]+\.json$/.test(path.basename(file)))
    .map(file => JSON.parse(fs.readFileSync(file, 'utf8')))
  const result = validatePackageReports(reports, { version, sha, installersDirectory: directory, reportsOnly: args.includes('--reports-only') })
  fs.writeFileSync(path.join(directory, 'validated-installers.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
