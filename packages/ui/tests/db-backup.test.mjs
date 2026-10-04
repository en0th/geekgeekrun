import test from 'node:test'
import assert from 'node:assert/strict'
import {
  readDbBackupSettings,
  datedBackupFileName,
  isBackupFileName,
  backupsToPrune,
  isBackupDue,
  DEFAULT_DB_BACKUP_SETTINGS
} from '../src/common/db-backup.mjs'

test('backups are off by default and bad values fall back', () => {
  assert.deepEqual(readDbBackupSettings(null), DEFAULT_DB_BACKUP_SETTINGS)
  assert.equal(DEFAULT_DB_BACKUP_SETTINGS.enabled, false)
  assert.deepEqual(
    readDbBackupSettings({
      enabled: 'yes',
      intervalHours: 5,
      mode: 'incremental',
      keep: 0,
      dir: 3
    }),
    DEFAULT_DB_BACKUP_SETTINGS
  )
  assert.deepEqual(
    readDbBackupSettings({
      enabled: true,
      intervalHours: 168,
      mode: 'overwrite',
      keep: 30,
      dir: ' /b '
    }),
    { enabled: true, intervalHours: 168, mode: 'overwrite', keep: 30, dir: '/b' }
  )
})

test('dated names sort by time and only our own files count', () => {
  const name = datedBackupFileName(new Date(2026, 9, 4, 7, 5, 9))
  assert.equal(name, 'public-20261004-070509.db')
  assert.ok(isBackupFileName(name))
  assert.ok(isBackupFileName('public-latest.db'))
  assert.ok(!isBackupFileName('public.db'))
  assert.ok(!isBackupFileName('public-before-restore-1.db'))
  assert.ok(!isBackupFileName('notes.txt'))
})

test('rotation keeps the newest and never prunes everything', () => {
  const names = [
    'public-20261001-000000.db',
    'public-20261003-000000.db',
    'public-20261002-000000.db',
    'public-latest.db',
    'other.db'
  ]
  assert.deepEqual(backupsToPrune(names, 2), ['public-20261001-000000.db'])
  assert.deepEqual(backupsToPrune(names, 0), [
    'public-20261002-000000.db',
    'public-20261001-000000.db'
  ])
})

test('a backup is due once the interval has passed', () => {
  const s = { enabled: true, intervalHours: 24 }
  const now = Date.now()
  assert.equal(isBackupDue({ ...s, enabled: false }, 0, now), false)
  assert.equal(isBackupDue(s, 0, now), true)
  assert.equal(isBackupDue(s, now - 23 * 3600e3, now), false)
  assert.equal(isBackupDue(s, now - 24 * 3600e3, now), true)
})
