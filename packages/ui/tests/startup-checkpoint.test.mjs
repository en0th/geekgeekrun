import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Module } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
const built = await build({ entryPoints: [path.join(here,'../src/main/features/task-resume.ts')],
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false, logLevel: 'silent', plugins: [{
    name: 'isolated-resume-folder', setup(builder) {
      builder.onResolve({ filter: /runtime-file-utils\.mjs$/ }, () => ({ path: 'runtime', namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: "export const storageFilePath='/unused-fixture-folder'" }))
    }
  }] })
const loaded = new Module(path.join(here,'startup-checkpoint.generated.cjs'))
loaded.filename = path.join(here,'startup-checkpoint.generated.cjs'); loaded.paths = Module._nodeModulePaths(here)
loaded._compile(built.outputFiles[0].text,loaded.filename)
const { initializeAutoChatResume } = loaded.exports

test('newly queued or initializing runs have a durable zero-progress checkpoint before their worker starts', t => {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ggr-startup-checkpoint-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}))
  fs.writeFileSync(path.join(folder,'auto-chat-terminated.json'),JSON.stringify([88,99]))
  initializeAutoChatResume(88,'collect',folder)
  const saved=JSON.parse(fs.readFileSync(path.join(folder,'auto-chat-resume.json'),'utf8'))
  assert.equal(saved.runRecordId,88);assert.equal(saved.runMode,'collect');assert.equal(saved.progress.collected,0)
  assert.deepEqual(saved.runState,{})
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder,'auto-chat-terminated.json'),'utf8')),[99])
  assert.throws(()=>initializeAutoChatResume(0,'collect',folder),/检查点/)
})

test('a failed initial checkpoint cannot revive an old terminated snapshot or start a task', t => {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ggr-checkpoint-fail-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}))
  fs.mkdirSync(path.join(folder,'auto-chat-resume.json'))
  fs.writeFileSync(path.join(folder,'auto-chat-terminated.json'),'[88,99]')
  assert.throws(()=>initializeAutoChatResume(88,'collect',folder))
  assert.equal(fs.readFileSync(path.join(folder,'auto-chat-terminated.json'),'utf8'),'[88,99]')
})
