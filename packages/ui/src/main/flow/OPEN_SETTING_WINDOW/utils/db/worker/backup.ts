// Consistent copies of the open database (better-sqlite3's online backup API), used by the
// scheduled backups and when moving the data folder.
import fs from 'node:fs'
import path from 'node:path'
import {
  LATEST_BACKUP_FILE_NAME,
  backupsToPrune,
  datedBackupFileName
} from '../../../../../../common/db-backup.mjs'

export interface BackupDb {
  backup(destination: string): Promise<unknown>
}

/** copies the database to `destPath` through a temporary file, so a partial copy never remains */
export async function copyDatabase(db: BackupDb, { destPath }: { destPath: string }) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  const tmp = destPath + '.tmp'
  fs.rmSync(tmp, { force: true })
  try {
    await db.backup(tmp)
    fs.renameSync(tmp, destPath)
  } finally {
    fs.rmSync(tmp, { force: true })
  }
  return { file: destPath, size: fs.statSync(destPath).size }
}

export async function backupDatabase(
  db: BackupDb,
  { dir, mode, keep }: { dir: string; mode: 'rotate' | 'overwrite'; keep: number }
) {
  const name = mode === 'overwrite' ? LATEST_BACKUP_FILE_NAME : datedBackupFileName(new Date())
  const result = await copyDatabase(db, { destPath: path.join(dir, name) })
  const removed: string[] = []
  if (mode === 'rotate') {
    for (const old of backupsToPrune(fs.readdirSync(dir), keep)) {
      fs.rmSync(path.join(dir, old), { force: true })
      removed.push(old)
    }
  }
  return { ...result, name, removed }
}
