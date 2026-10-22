// Verify the shutdown channel in full Electron main-process mode, not only Node mode.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { repositoryRoot } from './test-suite.mjs'
import { requestGracefulStop } from '../../packages/utils/worker-shutdown-protocol.cjs'
const require = createRequire(path.join(repositoryRoot, 'packages/ui/package.json'))
const executable = require('electron'), folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-electron-stop-'))
const source = path.join(folder, 'main.cjs'), result = path.join(folder, 'result.json')
const shutdownUrl = pathToFileURL(path.join(repositoryRoot, 'packages/utils/worker-shutdown.mjs')).href
fs.writeFileSync(source, `const fs=require('node:fs');const {app}=require('electron');app.dock?.hide();
app.setPath('userData',${JSON.stringify(path.join(folder, 'profile'))});
(async()=>{const {installWorkerShutdown}=await import(${JSON.stringify(shutdownUrl)});
let saves=0,closed=false;installWorkerShutdown({save:()=>{saves++;fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({saves,closed}))},
close:async()=>{await new Promise(r=>setTimeout(r,200));closed=true}});
await app.whenReady();if(typeof process.send!=='function')throw Error('Electron IPC unavailable');process.send({ready:true})})().catch(e=>{console.error(e);process.exit(1)})`)
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
let child, timer
try {
  child = spawn(executable, [source], { env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  let stderr = ''; child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000) })
  await new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(Error('Full Electron IPC readiness timed out: ' + stderr)), 30000)
    child.once('message', message => { clearTimeout(timer); message.ready ? resolve() : reject(Error('Unexpected Electron message')) })
    child.once('error', reject); child.once('exit', code => reject(Error('Electron exited before readiness: ' + code + ' ' + stderr)))
  })
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  assert.equal(requestGracefulStop(child), true)
  const stopped = await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Electron did not stop gracefully')), 10000) })])
  clearTimeout(timer); assert.equal(stopped.code, 0); assert.equal(stopped.signal, null)
  assert.deepEqual(JSON.parse(fs.readFileSync(result, 'utf8')), { saves: 2, closed: true })
  const report = { platform: process.platform, electronVersion: require('electron/package.json').version, checkpoints: 2, closed: true, success: true }
  const output = path.join(repositoryRoot, '.ci-reports/electron-stop-smoke.json')
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report))
} finally {
  clearTimeout(timer)
  if (child?.pid && child.exitCode == null && child.signalCode == null) { child.kill('SIGKILL'); await new Promise(resolve => child.once('exit', resolve)) }
  fs.rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
}
