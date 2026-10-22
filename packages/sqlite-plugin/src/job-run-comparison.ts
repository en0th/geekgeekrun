interface Db {
  prepare(sql: string): { get(...params: any[]): any; run(...params: any[]): unknown }
  transaction<T>(fn: () => T): () => T
}
interface Scope { runRecordId: number; accountId: string; signature: string; comparable: number; reason: string | null }
export interface JobRunComparison {
  runRecordId: number
  baselineRunId: number | null
  reason: string | null
  currentObserved: number
  baselineObserved: number
  added: number | null
  retained: number | null
  notObserved: number | null
  comparedAt: string
}
function runId(value: unknown) {
  if (!['number', 'string'].includes(typeof value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0)
    throw new Error('无效的岗位比较任务编号')
  return Number(value)
}

export function bindJobRunScope(db: Db, id: number, accountId: string, signature: string | null) {
  runId(id)
  if (!accountId?.trim() || (signature !== null && !/^v1:[a-f0-9]{64}$/.test(signature))) throw new Error('无效的岗位比较范围')
  db.transaction(() => {
    const previous = db.prepare('SELECT * FROM job_run_scope WHERE runRecordId = ?').get(id) as Scope | undefined
    if (previous) {
      if (previous.accountId !== accountId || previous.signature !== signature)
        db.prepare('UPDATE job_run_scope SET comparable = 0, reason = ? WHERE runRecordId = ?')
          .run('恢复任务时账号或筛选范围发生变化，本轮观察混合了不同范围', id)
      return
    }
    if (signature === null) return
    const historical = db.prepare('SELECT 1 FROM job_run_observation WHERE runRecordId = ? LIMIT 1').get(id)
    db.prepare('INSERT INTO job_run_scope (runRecordId, accountId, signature, comparable, reason) VALUES (?, ?, ?, ?, ?)')
      .run(id, accountId, signature, historical ? 0 : 1, historical ? '启用范围记录前已有采集，无法确认完整比较范围' : null)
  })()
}

/** Difference between observed IDs, not publication dates or a complete platform inventory. */
export function getJobRunComparison(db: Db, value: unknown, baseline?: unknown): JobRunComparison {
  const id = runId(value)
  return db.transaction(() => {
    const scope = db.prepare('SELECT * FROM job_run_scope WHERE runRecordId = ?').get(id) as Scope | undefined
    const count = (run: number) => Number(db.prepare('SELECT COUNT(*) n FROM job_run_observation WHERE runRecordId = ?').get(run).n)
    const result: JobRunComparison = { runRecordId: id, baselineRunId: null,
      reason: null, currentObserved: count(id), baselineObserved: 0, added: null, retained: null,
      notObserved: null, comparedAt: new Date().toISOString() }
    if (!scope?.comparable) {
      result.reason = scope?.reason || '该任务没有可验证的账号和搜索范围记录；旧任务及含个性化推荐的来源暂不参与同范围比较'
      return result
    }
    let base: Scope | undefined
    if (baseline !== undefined) {
      base = db.prepare('SELECT * FROM job_run_scope WHERE runRecordId = ?').get(runId(baseline)) as Scope | undefined
      if (!base?.comparable || base.runRecordId >= id || base.accountId !== scope.accountId || base.signature !== scope.signature)
        throw new Error('比较基准必须是较早且账号、筛选范围一致的任务')
    } else base = db.prepare(`SELECT * FROM job_run_scope s WHERE s.accountId = ? AND s.signature = ?
      AND s.comparable = 1 AND s.runRecordId < ? AND EXISTS
      (SELECT 1 FROM job_run_observation o WHERE o.runRecordId = s.runRecordId)
      ORDER BY s.runRecordId DESC LIMIT 1`).get(scope.accountId, scope.signature, id) as Scope | undefined
    if (!base || !count(base.runRecordId)) {
      result.reason = '没有较早的同账号、同筛选范围且有采集记录的任务，未把本轮全量视为新增'
      return result
    }
    result.baselineRunId = base.runRecordId
    result.baselineObserved = count(base.runRecordId)
    result.retained = Number(db.prepare(`SELECT COUNT(*) n FROM job_run_observation c WHERE c.runRecordId = ?
      AND EXISTS (SELECT 1 FROM job_run_observation b WHERE b.runRecordId = ? AND b.encryptJobId = c.encryptJobId)`)
      .get(id, base.runRecordId).n)
    result.added = result.currentObserved - result.retained!
    result.notObserved = result.baselineObserved - result.retained!
    return result
  })()
}
