import type { JobInfo } from './entity/JobInfo'

interface Db {
  prepare(sql: string): { get(...params: any[]): any; run(...params: any[]): unknown }
  transaction<T>(fn: () => T): () => T
}
const now = () => new Date().toISOString().replace('T', ' ').replace('Z', '')
const runId = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null

/** Call within the same transaction as the imported/captured job write. */
export function ensureJobDiscovery(db: Db, id: string, origin: 'capture' | 'import', runRecordId?: unknown, at = now()) {
  const existing = db.prepare('SELECT 1 FROM job_info WHERE encryptJobId = ?').get(id)
  db.prepare(`INSERT OR IGNORE INTO job_discovery
    (encryptJobId, firstSeenAt, firstSeenRunId, origin) VALUES (?, ?, ?, ?)`)
    .run(id, existing ? null : at, !existing && origin === 'capture' ? runId(runRecordId) : null,
      existing ? 'legacy' : origin)
}

export function observeJob(db: Db, id: string, runRecordId?: unknown, at = now()) {
  db.transaction(() => {
    // Also handles older callers that saved a detail without creating a ledger entry.
    ensureJobDiscovery(db, id, 'capture', runRecordId, at)
    db.prepare('UPDATE job_discovery SET lastSeenAt = ? WHERE encryptJobId = ?').run(at, id)
    const run = runId(runRecordId)
    if (run) db.prepare(`INSERT INTO job_run_observation
      (runRecordId, encryptJobId, firstObservedAt, lastObservedAt) VALUES (?, ?, ?, ?)
      ON CONFLICT(runRecordId, encryptJobId) DO UPDATE SET lastObservedAt = excluded.lastObservedAt`)
      .run(run, id, at, at)
  })()
}

// Persist the detail and its discovery atomically on the native connection. Keeping this
// short and synchronous prevents concurrent response hooks from sharing an async transaction.
export function saveCapturedJob(db: Db, job: JobInfo, runRecordId?: unknown) {
  db.transaction(() => {
    const at = now()
    ensureJobDiscovery(db, job.encryptJobId, 'capture', runRecordId, at)
    // Match ORM save semantics: an omitted field preserves the saved value; null clears it.
    const fields = Object.keys(job).filter(k => job[k] !== undefined)
    db.prepare(`INSERT INTO job_info (${fields.map(k => `"${k}"`).join(',')})
      VALUES (${fields.map(() => '?').join(',')}) ON CONFLICT(encryptJobId) DO UPDATE SET
      ${fields.filter(k => k !== 'encryptJobId').map(k => `"${k}" = excluded."${k}"`).join(',')}`)
      .run(...fields.map(k => job[k] instanceof Date
        ? job[k].toISOString().replace('T', ' ').replace('Z', '') : job[k]))
    observeJob(db, job.encryptJobId, runRecordId, at)
  })()
}
