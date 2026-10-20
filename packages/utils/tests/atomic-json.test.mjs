import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { writeJsonAtomicSync } from '../atomic-json.mjs'

const temporary = t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-atomic-'))
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }))
  return folder
}
test('atomic JSON writes are durable replacements and serialization failure preserves the old record', t => {
  const folder = temporary(t), file = path.join(folder, 'state/usage.json')
  writeJsonAtomicSync(file, { used: 5 })
  const circular = {}; circular.self = circular
  assert.throws(() => writeJsonAtomicSync(file, circular), /circular/i)
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { used: 5 })
  writeJsonAtomicSync(file, { used: 6 })
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { used: 6 })
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['usage.json'])
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600)
})

test('a failed replacement cleans up only its own temporary file', t => {
  const folder = temporary(t), destination = path.join(folder, 'occupied.json')
  fs.mkdirSync(destination)
  fs.writeFileSync(path.join(destination, 'keep'), 'old')
  fs.writeFileSync(path.join(folder, 'another-writer.tmp'), 'keep')
  assert.throws(() => writeJsonAtomicSync(destination, { used: 1 }))
  assert.equal(fs.readFileSync(path.join(destination, 'keep'), 'utf8'), 'old')
  assert.deepEqual(fs.readdirSync(folder).sort(), ['another-writer.tmp', 'occupied.json'])
})

test('concurrent writers never expose truncated JSON or reuse a shared temporary path', async t => {
  const folder = temporary(t), file = path.join(folder, 'shared.json')
  writeJsonAtomicSync(file, { writer: -1, text: 'x'.repeat(30000) })
  const source = `import fs from 'node:fs'; import { writeJsonAtomicSync } from ${JSON.stringify(new URL('../atomic-json.mjs', import.meta.url).href)};
    for(let i=0;i<12;i++){writeJsonAtomicSync(process.argv[1],{writer:process.argv[2],text:'x'.repeat(30000)});JSON.parse(fs.readFileSync(process.argv[1],'utf8'))}`
  const run = writer => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source, file, String(writer)], { stdio: ['ignore', 'ignore', 'pipe'] })
    let error = ''; child.stderr.on('data', data => { error += data })
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error(error)))
  })
  await Promise.all([run(1), run(2), run(3)])
  assert.equal(JSON.parse(fs.readFileSync(file)).text.length, 30000)
  assert.deepEqual(fs.readdirSync(folder), ['shared.json'])
})
