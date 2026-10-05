import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readReleaseNotesFile, withReleaseNotes, writeReleaseNotesFile } from '../release-notes-file.mjs'

test('a new version goes first and a re-release replaces its entry', () => {
  let entries = withReleaseNotes({}, '0.18.0', { notes: 'a', date: 'd1' })
  entries = withReleaseNotes(entries, '0.19.0', { notes: 'b', date: 'd2' })
  assert.deepEqual(Object.keys(entries), ['0.19.0', '0.18.0'])
  entries = withReleaseNotes(entries, '0.18.0', { notes: 'c', date: 'd3', draft: true })
  assert.deepEqual(Object.keys(entries), ['0.18.0', '0.19.0'])
  assert.deepEqual(entries['0.18.0'], { date: 'd3', draft: true, notes: 'c' })
})

test('a missing or broken file starts empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-notes-'))
  const file = path.join(dir, 'release-notes.json')
  assert.deepEqual(readReleaseNotesFile(file), {})
  fs.writeFileSync(file, 'not json')
  assert.deepEqual(readReleaseNotesFile(file), {})
  writeReleaseNotesFile('1.0.0', { notes: 'x', date: 'd' }, file)
  assert.deepEqual(readReleaseNotesFile(file), { '1.0.0': { date: 'd', draft: false, notes: 'x' } })
})
