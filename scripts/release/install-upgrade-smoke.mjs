// Installs the actual distributables in disposable locations on their native hosts.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { verifyInstalledGui } from './packaged-gui-smoke.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const previousTag = process.env.GGR_PREVIOUS_TAG || 'ui-v0.22.2'
assert.match(previousTag, /^ui-v\d+\.\d+\.\d+$/)
const version = JSON.parse(fs.readFileSync(path.join(root, 'packages/ui/package.json'))).version
const extension = { darwin: 'dmg', win32: 'exe', linux: 'deb' }[process.platform]
assert.ok(extension, 'Unsupported installer host')
const installerName = v => `geekgeekrun-ui_${v}_${process.platform === 'linux' ? 'amd64' : process.arch}${process.platform === 'win32' ? '_setup' : ''}.${extension}`
const candidate = path.join(root, 'packages/ui/dist', installerName(version))
assert.ok(fs.existsSync(candidate), 'Candidate installer is missing: ' + candidate)
const reportDirectory = path.join(root, '.ci-reports')
fs.mkdirSync(reportDirectory, { recursive: true })
const identity = process.platform + '-' + process.arch
const reportFile = path.join(reportDirectory, 'package-' + identity + '.json')
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-package-'))
const installDirectory = path.join(folder, 'Applications')
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const report = { success: false, version, platform: process.platform, arch: process.arch,
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  installer: { name: path.basename(candidate), sha256: digest(candidate), bytes: fs.statSync(candidate).size },
  previousTag, data: [], gui: [], sent: 0, marked: 0, bossRequests: 0 }

function run(executable, args, { env = process.env, timeout = 180000, name = 'command' } = {}) {
  return new Promise((resolve, reject) => {
    const log = fs.createWriteStream(path.join(reportDirectory, `${identity}-${name}.log`))
    const child = spawn(executable, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false })
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error(name + ' timed out')) }, timeout)
    child.once('error', error => { clearTimeout(timer); log.end(); reject(error) })
    child.once('exit', (code, signal) => { clearTimeout(timer); log.end()
      code === 0 && !signal ? resolve() : reject(Error(`${name} failed: ${code ?? signal}; inspect ${identity}-${name}.log`)) })
  })
}

async function oldInstaller() {
  const name = installerName(previousTag.slice(4))
  if (process.env.GGR_PREVIOUS_INSTALLER) {
    const local = path.resolve(process.env.GGR_PREVIOUS_INSTALLER)
    assert.equal(path.basename(local), name); assert.ok(fs.existsSync(local))
    return local
  }
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'geekgeekrun-package-validation' }
  if (process.env.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN
  const response = await fetch(`https://api.github.com/repos/en0th/geekgeekrun/releases/tags/${previousTag}`, { headers, signal: AbortSignal.timeout(45000) })
  assert.ok(response.ok, 'Previous release metadata failed: ' + response.status)
  const release = await response.json()
  assert.equal(release.tag_name, previousTag); assert.equal(release.draft, false); assert.equal(release.prerelease, false)
  const asset = release.assets.find(item => item.name === name)
  assert.ok(asset, 'Previous native installer is missing: ' + name)
  assert.equal(new URL(asset.browser_download_url).hostname, 'github.com')
  const binary = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(240000) })
  assert.ok(binary.ok, 'Previous installer download failed: ' + binary.status)
  const destination = path.join(folder, name)
  fs.writeFileSync(destination, Buffer.from(await binary.arrayBuffer()))
  assert.equal(fs.statSync(destination).size, asset.size)
  if (asset.digest) assert.equal('sha256:' + digest(destination), asset.digest)
  return destination
}

function fixture(runtime) {
  fs.mkdirSync(path.join(runtime, 'config'), { recursive: true })
  fs.mkdirSync(path.join(runtime, 'storage'), { recursive: true })
  for (const name of ['boss.json', 'common-job-condition-config.json', 'dingtalk.json', 'llm.json', 'target-company-list.json']) {
    const content = execFileSync('git', ['show', `${previousTag}:packages/geek-auto-start-chat-with-boss/default-config-file/${name}`], { cwd: root })
    fs.writeFileSync(path.join(runtime, 'config', name), content)
  }
  fs.writeFileSync(path.join(runtime, 'config/update.json'), JSON.stringify({ autoCheck: false, ignoredVersions: ['0.22.1'] }))
  fs.writeFileSync(path.join(runtime, 'storage/boss-cookies.json'), '[]')
  fs.writeFileSync(path.join(runtime, 'storage/boss-local-storage.json'), '{}')
  fs.writeFileSync(path.join(runtime, 'storage/job-status-poll-settings.json'), JSON.stringify({ enabled: false, intervalHours: 6 }))
  fs.writeFileSync(path.join(runtime, 'storage/ui-first-launch-notice-flag'), previousTag.slice(4))
  const chrome = process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : process.platform === 'linux' ? '/usr/bin/google-chrome'
      : [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean)
        .map(base => path.join(base, 'Google/Chrome/Application/chrome.exe')).find(file => fs.existsSync(file))
  assert.ok(chrome && fs.existsSync(chrome), 'Real Chrome is required for the GUI prerequisite')
  fs.writeFileSync(path.join(runtime, 'storage/last-used-browser-record'), `${chrome}\nchrome\n2`)
  return Object.fromEntries(['config', 'storage'].flatMap(sub => fs.readdirSync(path.join(runtime, sub))
    .map(name => [path.join(sub, name), digest(path.join(runtime, sub, name))])))
}

function assertFixture(runtime, expected) {
  for (const [relative, sha] of Object.entries(expected)) assert.equal(digest(path.join(runtime, relative)), sha, relative)
}

async function install(file, runtime, label) {
  const env = { ...process.env, GEEKGEEKRUN_RUNTIME_DIR: runtime }
  delete env.ELECTRON_RUN_AS_NODE
  if (process.platform === 'darwin') {
    const mount = path.join(folder, 'mount-' + label)
    fs.mkdirSync(mount)
    await run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, file], { name: label + '-mount' })
    try {
      const app = fs.readdirSync(mount).filter(name => name.endsWith('.app'))
      assert.deepEqual(app, ['GeekGeekRun.app'])
      const destination = path.join(installDirectory, app[0])
      fs.rmSync(destination, { recursive: true, force: true })
      await run('ditto', [path.join(mount, app[0]), destination], { name: label + '-install' })
      return path.join(destination, 'Contents/MacOS/GeekGeekRun')
    } finally { await run('hdiutil', ['detach', mount], { name: label + '-unmount' }) }
  }
  if (process.platform === 'win32') {
    await run(file, ['/S', '/currentuser', '/D=' + installDirectory], { env, name: label + '-install' })
    return path.join(installDirectory, 'geekgeekrun.exe')
  }
  await run('sudo', ['apt-get', 'install', '--yes', '--no-install-recommends', file], { name: label + '-install', timeout: 300000 })
  const installed = execFileSync('dpkg-query', ['-L', 'geekgeekrun-ui'], { encoding: 'utf8' }).split('\n')
  const executable = installed.find(item => item.startsWith('/opt/') && path.basename(item) === 'geekgeekrun-ui')
  assert.ok(executable && fs.existsSync(executable), 'DEB installed executable missing')
  return executable
}

async function uninstall(runtime, label) {
  if (process.platform === 'darwin') fs.rmSync(installDirectory, { recursive: true, force: true })
  else if (process.platform === 'linux') await run('sudo', ['dpkg', '--remove', 'geekgeekrun-ui'], { name: label + '-uninstall' })
  else {
    const uninstaller = fs.readdirSync(installDirectory).find(name => /^Uninstall.+\.exe$/i.test(name))
    assert.ok(uninstaller, 'Installed NSIS uninstaller missing')
    await run(path.join(installDirectory, uninstaller), ['/S'], { env: { ...process.env, GEEKGEEKRUN_RUNTIME_DIR: runtime }, name: label + '-uninstall' })
    const deadline = Date.now() + 30000
    while (fs.existsSync(path.join(installDirectory, 'geekgeekrun.exe')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 250))
    assert.equal(fs.existsSync(path.join(installDirectory, 'geekgeekrun.exe')), false, 'NSIS did not uninstall')
  }
}

async function dataProbe(executable, runtime, phase, expectedVersion) {
  const output = path.join(folder, phase + '.json')
  await run(executable, [path.join(root, 'scripts/release/packaged-data-smoke.cjs'), phase, runtime, expectedVersion, output],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', GEEKGEEKRUN_RUNTIME_DIR: runtime }, name: phase + '-database' })
  const result = JSON.parse(fs.readFileSync(output, 'utf8'))
  assert.equal(result.success, true); report.data.push(result)
}

try {
  const previous = await oldInstaller()
  report.previousInstaller = { name: path.basename(previous), sha256: digest(previous) }
  const cleanRuntime = path.join(folder, 'fresh-runtime'), upgradeRuntime = path.join(folder, 'upgrade-runtime')
  const cleanFiles = fixture(cleanRuntime), upgradeFiles = fixture(upgradeRuntime)
  let executable = await install(candidate, cleanRuntime, 'fresh')
  await dataProbe(executable, cleanRuntime, 'fresh', version)
  report.gui.push(await verifyInstalledGui({ executable, runtime: cleanRuntime, version, jobs: 0,
    logFile: path.join(reportDirectory, identity + '-fresh-gui.log') }))
  assertFixture(cleanRuntime, cleanFiles)
  await uninstall(cleanRuntime, 'fresh')
  executable = await install(previous, upgradeRuntime, 'previous')
  await dataProbe(executable, upgradeRuntime, 'seed', previousTag.slice(4))
  executable = await install(candidate, upgradeRuntime, 'upgrade')
  await dataProbe(executable, upgradeRuntime, 'upgrade', version)
  for (const label of ['upgraded', 'restarted']) report.gui.push(await verifyInstalledGui({ executable,
    runtime: upgradeRuntime, version, jobs: 3, logFile: path.join(reportDirectory, identity + '-' + label + '-gui.log') }))
  await dataProbe(executable, upgradeRuntime, 'reopen', version)
  assertFixture(upgradeRuntime, upgradeFiles)
  await uninstall(upgradeRuntime, 'upgrade')
  assert.ok(fs.existsSync(path.join(upgradeRuntime, 'storage/public.db')), 'Uninstall removed user data')
  report.configurationPreserved = true; report.uninstallPreservesData = true
  report.success = true
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  report.error = error.message
  console.error(error)
  process.exitCode = 1
} finally {
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n')
  if (report.success) fs.rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
}
