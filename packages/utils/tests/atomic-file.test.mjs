import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import atomic from '../atomic-file.cjs'
import { writeJsonAtomic, writeJsonAtomicSync } from '../atomic-json.mjs'

function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-file-fault-'))
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }))
  const file = path.join(folder, 'state.json')
  fs.writeFileSync(file, '{"old":true}')
  return { folder, file }
}
const fault = code => Object.assign(Error('injected filesystem error'), { code })

test('a Windows-style sharing violation is retried without deleting the old target', t => {
  const { folder, file } = fixture(t), delays = []
  let attempts = 0
  const io = atomic.createAtomicFileIO({ pause: ms => delays.push(ms), io: { ...fs,
    renameSync(from, to) {
      if (++attempts < 3) { assert.deepEqual(JSON.parse(fs.readFileSync(file)), { old: true }); throw fault('EPERM') }
      fs.renameSync(from, to)
    }
  } })
  io.writeJsonAtomicSync(file, { next: true })
  assert.deepEqual(delays, [10, 20])
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { next: true })
  assert.deepEqual(fs.readdirSync(folder), ['state.json'])
})

test('persistent sharing violations have a finite retry limit and retain the old file', t => {
  const { folder, file } = fixture(t), delays = []
  let attempts = 0
  const io = atomic.createAtomicFileIO({ pause: ms => delays.push(ms), io: { ...fs,
    renameSync() { attempts++; throw fault('EACCES') }
  } })
  assert.throws(() => io.writeJsonAtomicSync(file, { next: true }), { code: 'EACCES' })
  assert.equal(attempts, 6)
  assert.equal(delays.reduce((a, b) => a + b, 0), 150)
  assert.equal(fs.readFileSync(file, 'utf8'), '{"old":true}')
  assert.deepEqual(fs.readdirSync(folder), ['state.json'])
})

test('write and file-fsync failures cannot publish a truncated or empty target', t => {
  const { folder, file } = fixture(t)
  for (const operation of ['writeFileSync', 'fsyncSync']) {
    const io = atomic.createAtomicFileIO({ io: { ...fs, [operation]() { throw fault('ENOSPC') } } })
    assert.throws(() => io.writeJsonAtomicSync(file, { next: true }), { code: 'ENOSPC' })
    assert.equal(fs.readFileSync(file, 'utf8'), '{"old":true}')
    assert.deepEqual(fs.readdirSync(folder), ['state.json'])
  }
})

test('failed exclusive creation never cleans up a temporary file created by another writer', t => {
  const { file } = fixture(t)
  let reserved
  const io = atomic.createAtomicFileIO({ io: { ...fs, openSync(name, flags, ...args) {
    if (flags === 'wx') {
      reserved = name
      fs.writeFileSync(name, 'other writer')
      throw fault('EEXIST')
    }
    return fs.openSync(name, flags, ...args)
  } } })
  assert.throws(() => io.writeJsonAtomicSync(file, {}), { code: 'EEXIST' })
  assert.equal(fs.readFileSync(reserved, 'utf8'), 'other writer')
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { old: true })
})

test('initialization publishes exclusively instead of overwriting a concurrent saved configuration', t => {
  const { file } = fixture(t)
  fs.unlinkSync(file)
  const io = atomic.createAtomicFileIO({ io: { ...fs, linkSync(from, to) {
    fs.writeFileSync(to, '{"userSaved":true}')
    fs.linkSync(from, to)
  } } })
  assert.equal(io.writeJsonAtomicSync(file, { defaults: true }, { createOnly: true }), false)
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { userSaved: true })
})

test('a batch prepares every file before publication and rolls back failed replacements atomically', t => {
  const { folder, file } = fixture(t), second = path.join(folder, 'second.json')
  fs.writeFileSync(second, '{"oldSecond":true}')
  const io = atomic.createAtomicFileIO({ pause() {}, io: { ...fs, renameSync(from, to) {
    if (to === second) throw fault('EBUSY')
    fs.renameSync(from, to)
  } } })
  assert.throws(() => io.writeFilesAtomicSync([[file, '{"newFirst":true}'], [second, '{"newSecond":true}']]), { code: 'EBUSY' })
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { old: true })
  assert.deepEqual(JSON.parse(fs.readFileSync(second)), { oldSecond: true })
  assert.deepEqual(fs.readdirSync(folder).sort(), ['second.json', 'state.json'])
})

test('a failed staging step or duplicate destination changes none of the batch', t => {
  const { folder, file } = fixture(t), blocked = path.join(folder, 'directory.json')
  fs.mkdirSync(blocked)
  assert.throws(() => atomic.writeFilesAtomicSync([[file, '{"new":true}'], [blocked, '{}']]))
  assert.throws(() => atomic.writeFilesAtomicSync([[file, '{}'], [file, '{}']]), /重复路径/)
  assert.equal(fs.readFileSync(file, 'utf8'), '{"old":true}')
  assert.deepEqual(fs.readdirSync(folder).sort(), ['directory.json', 'state.json'])
})

test('batch rollback uses prepared bytes and needs no new disk allocation after publication', t => {
  const { folder, file } = fixture(t), second = path.join(folder, 'second.json')
  fs.writeFileSync(second, '{"oldSecond":true}')
  let publishing = false
  const io = atomic.createAtomicFileIO({ pause() {}, io: { ...fs,
    writeFileSync(...args) { if (publishing) throw fault('ENOSPC'); return fs.writeFileSync(...args) },
    renameSync(from, to) {
      publishing = true
      if (to === second) throw fault('EBUSY')
      fs.renameSync(from, to)
    }
  } })
  assert.throws(() => io.writeFilesAtomicSync([[file, '{"new":true}'], [second, '{"new":true}']]), { code: 'EBUSY' })
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { old: true })
  assert.deepEqual(JSON.parse(fs.readFileSync(second)), { oldSecond: true })
  assert.equal(fs.readdirSync(folder).some(name => name.endsWith('.tmp')), false)
})

test('failed rollback retains a private durable recovery copy instead of discarding the old bytes', t => {
  const { folder, file } = fixture(t), second = path.join(folder, 'second.json')
  const io = atomic.createAtomicFileIO({ pause() {}, io: { ...fs, renameSync(from, to) {
    if (to === second || from.endsWith('.rollback.tmp')) throw fault('EIO')
    fs.renameSync(from, to)
  } } })
  let failure
  try { io.writeFilesAtomicSync([[file, '{"new":true}'], [second, '{}']]) } catch (error) { failure = error }
  assert.ok(failure instanceof AggregateError)
  assert.equal(failure.recoveryFiles.length, 1)
  const recovery = failure.recoveryFiles[0]
  assert.deepEqual(JSON.parse(fs.readFileSync(recovery)), { old: true })
  if (process.platform !== 'win32') assert.equal(fs.statSync(recovery).mode & 0o777, 0o600)
})

test('directory-fsync failure after replacement is distinguished from a pre-commit failure', t => {
  const { file } = fixture(t)
  const io = atomic.createAtomicFileIO({ io: { ...fs, fsyncSync(fd) {
    if (fs.fstatSync(fd).isDirectory()) throw fault('EIO')
    fs.fsyncSync(fd)
  } } })
  assert.throws(() => io.writeJsonAtomicSync(file, { validNew: true }), error => error.code === 'EIO' && error.atomicCommitted === true)
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { validNew: true })
})

test('batch rollback preserves detected newer bytes and reports that rollback was incomplete', t => {
  const { folder, file } = fixture(t), second = path.join(folder, 'second.json')
  const io = atomic.createAtomicFileIO({ io: { ...fs, renameSync(from, to) {
    if (to === second) { fs.writeFileSync(file, '{"newerWriter":true}'); throw fault('EIO') }
    fs.renameSync(from, to)
  } } })
  assert.throws(() => io.writeFilesAtomicSync([[file, '{"ours":true}'], [second, '{}']]), /部分回滚/)
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { newerWriter: true })
})

test('mixed sync/async calls commit in invocation order and capture JSON before later mutation', async t => {
  const { file } = fixture(t)
  const value = { revision: 1 }
  const first = writeJsonAtomic(file, value)
  value.revision = 99
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { revision: 1 })
  writeJsonAtomicSync(file, { revision: 2 })
  await first
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { revision: 2 })
})

test('abrupt process death before rename leaves the old canonical JSON readable', { timeout: 10000 }, async t => {
  const { file } = fixture(t)
  const source = `import fs from 'node:fs'; import atomic from ${JSON.stringify(new URL('../atomic-file.cjs', import.meta.url).href)};
    const io=atomic.createAtomicFileIO({io:{...fs,renameSync(){fs.writeSync(1,'STAGED');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30000)}}});
    io.writeJsonAtomicSync(process.argv[1],{next:true})`
  const child = spawn(process.execPath, ['--input-type=module', '-e', source, file], { stdio: ['ignore', 'pipe', 'pipe'] })
  t.after(() => child.kill('SIGKILL'))
  const exited = new Promise(resolve => child.once('exit', resolve))
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); child.once('exit', () => reject(Error('child exited before staging'))) })
  child.kill('SIGKILL'); await exited
  assert.equal(fs.readFileSync(file, 'utf8'), '{"old":true}')
})
