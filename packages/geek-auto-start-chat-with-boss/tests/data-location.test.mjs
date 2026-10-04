import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// a throwaway runtime folder; the real ~/.geekgeekrun is never touched
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-loc-'))
process.env.GEEKGEEKRUN_RUNTIME_DIR = runtime
const loc = await import('../data-location.mjs')

test('the default storage folder is used until another one is chosen', () => {
  assert.deepEqual(loc.resolveStorageFolder(), {
    path: path.join(runtime, 'storage'),
    custom: false,
    fallbackFrom: null
  })
})

test('a chosen folder is used while it exists, otherwise the default stands in', () => {
  const custom = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-data-'))
  loc.writeDataLocation(custom)
  assert.deepEqual(loc.resolveStorageFolder(), { path: custom, custom: true, fallbackFrom: null })
  fs.rmSync(custom, { recursive: true })
  assert.deepEqual(loc.resolveStorageFolder(), {
    path: path.join(runtime, 'storage'),
    custom: false,
    fallbackFrom: custom
  })
})

test('choosing the default again or a relative path clears the setting', () => {
  loc.writeDataLocation(path.join(runtime, 'storage'))
  assert.equal(loc.readDataLocation().storageDir, '')
  fs.writeFileSync(loc.dataLocationFilePath, JSON.stringify({ storageDir: 'relative/dir' }))
  assert.equal(loc.readDataLocation().storageDir, '')
  fs.writeFileSync(loc.dataLocationFilePath, 'not json')
  assert.equal(loc.readDataLocation().storageDir, '')
})
