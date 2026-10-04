// Needs better-sqlite3 built for the runtime in use. The app builds it for Electron, so run:
//   ELECTRON_RUN_AS_NODE=1 <electron binary> --test tests/favorites.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import { build } from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(path.join(here, '../package.json'))
let Database
try {
  Database = require('better-sqlite3')
  new Database(':memory:').close()
} catch (err) {
  Database = null
  console.log('better-sqlite3 unavailable in this runtime, skipping:', err.message.split('\n')[0])
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-fav-'))
const bundle = async (entry, name) => {
  const outfile = path.join(dir, name)
  await build({
    entryPoints: [path.join(here, entry)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    logLevel: 'silent',
    // keep typeorm & co. out: only the plain SQL is under test
    packages: 'external'
  })
  return import(pathToFileURL(outfile).href)
}

async function freshDb() {
  const db = new Database(':memory:')
  const { AddFavoriteAndJobHireStatusLog1791100000000: Migration } = await bundle(
    '../../sqlite-plugin/src/migrations/1791100000000-AddFavoriteAndJobHireStatusLog.ts',
    'migration.mjs'
  )
  await new Migration().up({ query: async (sql) => db.exec(sql) })
  db.exec(
    `CREATE TABLE job_hire_status_record ("encryptJobId" varchar PRIMARY KEY, "hireStatus" integer, "lastSeenDate" datetime)`
  )
  return db
}

const skip = !Database && 'better-sqlite3 not built for this runtime'

test('folders: create, rename, unique names, delete with their jobs', { skip }, async () => {
  const fav = await bundle(
    '../src/main/flow/OPEN_SETTING_WINDOW/utils/db/worker/favorites.ts',
    'favorites.mjs'
  )
  const db = await freshDb()
  const { id } = fav.createFavoriteFolder(db, { name: '  想去的  ' })
  assert.throws(() => fav.createFavoriteFolder(db, { name: '想去的' }), /已有名为/)
  assert.throws(() => fav.createFavoriteFolder(db, { name: ' ' }), /请填写/)
  assert.throws(() => fav.createFavoriteFolder(db, { name: 'x'.repeat(31) }), /最多 30/)
  fav.renameFavoriteFolder(db, { id, name: '重点' })
  assert.equal(fav.listFavoriteFolders(db)[0].name, '重点')

  assert.deepEqual(fav.addFavoriteJobs(db, { folderId: id, jobIds: ['a', 'b', 'a', ''] }), {
    added: 2,
    alreadySaved: 0
  })
  assert.deepEqual(fav.addFavoriteJobs(db, { folderId: id, jobIds: ['b', 'c'] }), {
    added: 1,
    alreadySaved: 1
  })
  assert.throws(() => fav.addFavoriteJobs(db, { folderId: 999, jobIds: ['a'] }), /不存在/)

  fav.deleteFavoriteFolder(db, { id })
  assert.equal(fav.listFavoriteFolders(db).length, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM favorite_job').get().n, 0)
})

test('folder counts and poll targets follow the hire status', { skip }, async () => {
  const fav = await bundle(
    '../src/main/flow/OPEN_SETTING_WINDOW/utils/db/worker/favorites.ts',
    'favorites.mjs'
  )
  const db = await freshDb()
  const one = fav.createFavoriteFolder(db, { name: '一' }).id
  const two = fav.createFavoriteFolder(db, { name: '二' }).id
  fav.addFavoriteJobs(db, { folderId: one, jobIds: ['open', 'closed', 'new'] })
  fav.addFavoriteJobs(db, { folderId: two, jobIds: ['open', 'gone'] })
  const status = db.prepare('INSERT INTO job_hire_status_record VALUES (?, ?, ?)')
  status.run('open', 1, '2026-10-01 00:00:00.000')
  status.run('closed', 2, '2026-10-02 00:00:00.000')
  status.run('gone', 3, '2026-10-03 00:00:00.000')

  const [a, b] = fav.listFavoriteFolders(db)
  assert.deepEqual(
    [a.jobCount, a.closedCount, a.uncheckedCount, b.jobCount, b.closedCount, b.uncheckedCount],
    [3, 1, 1, 2, 1, 0]
  )
  // still hiring or never checked, each job once even when saved in two folders
  assert.equal(fav.countJobStatusPollTargets(db), 2)
})

test('backups are consistent copies and rotation prunes the oldest', { skip }, async () => {
  const backup = await bundle(
    '../src/main/flow/OPEN_SETTING_WINDOW/utils/db/worker/backup.ts',
    'backup.mjs'
  )
  const db = await freshDb()
  db.exec(`INSERT INTO favorite_folder (name, createdAt) VALUES ('a', '2026-01-01')`)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-backup-'))
  for (const old of ['public-20200101-000000.db', 'public-20200102-000000.db'])
    fs.writeFileSync(path.join(dir, old), 'old')
  const result = await backup.backupDatabase(db, { dir, mode: 'rotate', keep: 2 })
  assert.deepEqual(result.removed, ['public-20200101-000000.db'])
  const copy = new Database(path.join(dir, result.name), { readonly: true })
  assert.equal(copy.prepare('SELECT name FROM favorite_folder').get().name, 'a')
  copy.close()
  const latest = await backup.backupDatabase(db, { dir, mode: 'overwrite', keep: 2 })
  assert.equal(latest.name, 'public-latest.db')
  assert.ok(!fs.existsSync(path.join(dir, 'public-latest.db.tmp')))
})
