// Favourite folders and the jobs saved in them (tables from the
// AddFavoriteAndJobHireStatusLog migration in sqlite-plugin).
import { type Db, nowDbDate } from './run-data'

const MAX_FOLDER_NAME = 30

function folderName(name: unknown) {
  const value = String(name ?? '').trim()
  if (!value) throw new Error('请填写收藏夹名称')
  if (value.length > MAX_FOLDER_NAME) throw new Error(`收藏夹名称最多 ${MAX_FOLDER_NAME} 个字`)
  return value
}

function assertFolder(db: Db, id: unknown) {
  if (!db.prepare(`SELECT 1 FROM favorite_folder WHERE id = ?`).get(Number(id)))
    throw new Error('收藏夹不存在，可能已被删除')
}

function assertUniqueName(db: Db, name: string, exceptId?: number) {
  const same = db
    .prepare(`SELECT id FROM favorite_folder WHERE name = ? AND id IS NOT ?`)
    .get(name, exceptId ?? null)
  if (same) throw new Error(`已有名为“${name}”的收藏夹`)
}

export function listFavoriteFolders(db: Db) {
  return db
    .prepare(
      `SELECT ff.id, ff.name, ff.createdAt,
        COUNT(f.id) AS jobCount,
        COALESCE(SUM(CASE WHEN h.hireStatus IN (2, 3) THEN 1 ELSE 0 END), 0) AS closedCount,
        COALESCE(SUM(CASE WHEN h.hireStatus IS NULL THEN 1 ELSE 0 END), 0) AS uncheckedCount,
        MAX(h.lastSeenDate) AS lastCheckedAt
      FROM favorite_folder ff
        LEFT JOIN favorite_job f ON f.folderId = ff.id
        LEFT JOIN job_hire_status_record h ON h.encryptJobId = f.encryptJobId
      GROUP BY ff.id
      ORDER BY ff.id`
    )
    .all()
}

export function createFavoriteFolder(db: Db, { name }: { name: unknown }) {
  const value = folderName(name)
  assertUniqueName(db, value)
  db.prepare(`INSERT INTO favorite_folder (name, createdAt) VALUES (?, ?)`).run(value, nowDbDate())
  return db.prepare(`SELECT id FROM favorite_folder WHERE name = ?`).get(value)
}

export function renameFavoriteFolder(db: Db, { id, name }: { id: unknown; name: unknown }) {
  assertFolder(db, id)
  const value = folderName(name)
  assertUniqueName(db, value, Number(id))
  db.prepare(`UPDATE favorite_folder SET name = ? WHERE id = ?`).run(value, Number(id))
  return { id: Number(id) }
}

export function deleteFavoriteFolder(db: Db, { id }: { id: unknown }) {
  assertFolder(db, id)
  db.transaction(() => {
    db.prepare(`DELETE FROM favorite_job WHERE folderId = ?`).run(Number(id))
    db.prepare(`DELETE FROM favorite_folder WHERE id = ?`).run(Number(id))
  })()
  return { id: Number(id) }
}

export function addFavoriteJobs(db: Db, { folderId, jobIds }: { folderId: unknown; jobIds: unknown }) {
  assertFolder(db, folderId)
  const ids = [...new Set((Array.isArray(jobIds) ? jobIds : []).map(String).filter(Boolean))]
  let added = 0
  db.transaction(() => {
    const insert = db.prepare(
      `INSERT OR IGNORE INTO favorite_job (folderId, encryptJobId, createdAt) VALUES (?, ?, ?)`
    )
    const now = nowDbDate()
    for (const id of ids) added += insert.run(Number(folderId), id, now).changes
  })()
  return { added, alreadySaved: ids.length - added }
}

/** jobs not yet known to be closed or deleted; what a poll round would check */
export function countJobStatusPollTargets(db: Db) {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT f.encryptJobId) AS n
      FROM favorite_job f
        LEFT JOIN job_hire_status_record h ON h.encryptJobId = f.encryptJobId
      WHERE h.hireStatus IS NULL OR h.hireStatus = 1`
    )
    .get() as { n: number }
  return row.n
}
