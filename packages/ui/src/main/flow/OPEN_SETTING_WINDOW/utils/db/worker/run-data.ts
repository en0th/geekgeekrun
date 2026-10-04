// Query / stats / import / delete engine for the "运行数据" tables.
// Runs synchronously on the better-sqlite3 connection owned by TypeORM.
// Every field name that ends up in SQL is checked against the dataset whitelist.
import {
  runDataDatasets,
  type RunDataDatasetKey,
  type RunDataDeleteReq,
  type RunDataDistinctItem,
  type RunDataDistinctReq,
  type RunDataFilter,
  type RunDataImportReq,
  type RunDataImportRes,
  type RunDataPageQuery,
  type RunDataQuery,
  type RunDataStatsGroup,
  type RunDataStatsReq,
  type RunDataStatsRes
} from '../../../../../../common/run-data'
import { PagedRes } from '../../../../../../common/types/pagination'

// the subset of the better-sqlite3 API used here (no @types package installed)
interface Statement {
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
  run(...params: unknown[]): { changes: number }
}
export interface Db {
  prepare(sql: string): Statement
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R
}
type Row = Record<string, unknown>

const jobColumns = `
    j.jobName, j.positionName, j.salaryLow, j.salaryHigh, j.salaryMonth, j.experienceName,
    j.publishDate, j.degreeName, j.address, j.description, j.encryptBossId, j.encryptCompanyId`

const baseSql: Record<RunDataDatasetKey, string> = {
  chatStartupLog: `SELECT
    l.id, l.encryptJobId, l.encryptCurrentUserId, l.date, l.chatStartupFrom, l.jobSource,
    ${jobColumns},
    u.name AS userName, b.name AS bossName, b.title AS bossTitle, c.name AS companyName
  FROM chat_startup_log l
    LEFT JOIN job_info j ON j.encryptJobId = l.encryptJobId
    LEFT JOIN user_info u ON u.encryptUserId = l.encryptCurrentUserId
    LEFT JOIN boss_info b ON b.encryptBossId = j.encryptBossId
    LEFT JOIN company_info c ON c.encryptCompanyId = j.encryptCompanyId`,
  markAsNotSuitLog: `SELECT
    l.id, l.encryptJobId, l.encryptCurrentUserId, l.date, l.markFrom, l.markReason, l.markOp,
    l.extInfo, l.jobSource,
    ${jobColumns},
    u.name AS userName, b.name AS bossName, c.name AS companyName
  FROM mark_as_not_suit_log l
    LEFT JOIN job_info j ON j.encryptJobId = l.encryptJobId
    LEFT JOIN user_info u ON u.encryptUserId = l.encryptCurrentUserId
    LEFT JOIN boss_info b ON b.encryptBossId = j.encryptBossId
    LEFT JOIN company_info c ON c.encryptCompanyId = j.encryptCompanyId`,
  jobLibrary: `SELECT
    j.rowid AS _rowid, j.encryptJobId, ${jobColumns},
    b.name AS bossName, b.title AS bossTitle, c.name AS companyName,
    h.hireStatus, h.lastSeenDate AS hireStatusCheckedAt
  FROM job_info j
    LEFT JOIN boss_info b ON b.encryptBossId = j.encryptBossId
    LEFT JOIN company_info c ON c.encryptCompanyId = j.encryptCompanyId
    LEFT JOIN job_hire_status_record h ON h.encryptJobId = j.encryptJobId`,
  // one row per favourite; a job saved into two folders shows twice
  favoriteJobs: `SELECT
    f.id, f.folderId, f.encryptJobId, f.createdAt AS favoritedAt, ff.name AS folderName,
    ${jobColumns},
    b.name AS bossName, b.title AS bossTitle, c.name AS companyName,
    h.hireStatus, h.lastSeenDate AS hireStatusCheckedAt,
    (SELECT MAX(l.checkedAt) FROM job_hire_status_log l
      WHERE l.encryptJobId = f.encryptJobId AND l.hireStatus IN (2, 3)) AS closedAt
  FROM favorite_job f
    JOIN favorite_folder ff ON ff.id = f.folderId
    LEFT JOIN job_info j ON j.encryptJobId = f.encryptJobId
    LEFT JOIN boss_info b ON b.encryptBossId = j.encryptBossId
    LEFT JOIN company_info c ON c.encryptCompanyId = j.encryptCompanyId
    LEFT JOIN job_hire_status_record h ON h.encryptJobId = f.encryptJobId`,
  bossLibrary: `SELECT
    b.encryptBossId, b.encryptCompanyId, b.name, b.title, b.date, c.name AS companyName
  FROM boss_info b
    LEFT JOIN company_info c ON c.encryptCompanyId = b.encryptCompanyId`,
  companyLibrary: `SELECT
    encryptCompanyId, name, brandName, scaleLow, scaleHigh, stageName, industryName
  FROM company_info`
}

const deleteTarget: Record<RunDataDatasetKey, { table: string; pk: string }> = {
  chatStartupLog: { table: 'chat_startup_log', pk: 'id' },
  markAsNotSuitLog: { table: 'mark_as_not_suit_log', pk: 'id' },
  jobLibrary: { table: 'job_info', pk: 'encryptJobId' },
  bossLibrary: { table: 'boss_info', pk: 'encryptBossId' },
  companyLibrary: { table: 'company_info', pk: 'encryptCompanyId' },
  // deleting a favourite only takes it out of its folder
  favoriteJobs: { table: 'favorite_job', pk: 'id' }
}

function getDataset(dataset: RunDataDatasetKey) {
  const def = runDataDatasets[dataset]
  if (!def) {
    throw new Error(`Unknown dataset: ${dataset}`)
  }
  return def
}

function col(dataset: RunDataDatasetKey, field: string) {
  if (!getDataset(dataset).fields.some((it) => it.key === field)) {
    throw new Error(`Unknown field "${field}" for dataset ${dataset}`)
  }
  return `t."${field}"`
}

const escapeLike = (s: string) => `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`

function buildFilterSql(dataset: RunDataDatasetKey, filter: RunDataFilter, params: unknown[]) {
  const c = col(dataset, filter.field)
  const v = filter.value
  switch (filter.op) {
    case 'contains':
      params.push(escapeLike(String(v ?? '')))
      return `${c} LIKE ? ESCAPE '\\'`
    case 'notContains':
      params.push(escapeLike(String(v ?? '')))
      return `(${c} IS NULL OR ${c} NOT LIKE ? ESCAPE '\\')`
    case 'eq':
      if (v === null || v === undefined) return `${c} IS NULL`
      params.push(v)
      return `${c} = ?`
    case 'neq':
      if (v === null || v === undefined) return `${c} IS NOT NULL`
      params.push(v)
      return `(${c} IS NULL OR ${c} <> ?)`
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const op = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[filter.op]
      params.push(v)
      return `${c} ${op} ?`
    }
    case 'between': {
      const [from, to] = Array.isArray(v) ? v : []
      const parts: string[] = []
      if (from !== null && from !== undefined && from !== '') {
        params.push(from)
        parts.push(`${c} >= ?`)
      }
      if (to !== null && to !== undefined && to !== '') {
        params.push(to)
        parts.push(`${c} <= ?`)
      }
      return parts.length ? `(${parts.join(' AND ')})` : ''
    }
    case 'in': {
      const list = Array.isArray(v) ? v : []
      if (!list.length) return ''
      const nonNull = list.filter((it) => it !== null && it !== undefined)
      const parts: string[] = []
      if (nonNull.length) {
        params.push(...nonNull)
        parts.push(`${c} IN (${nonNull.map(() => '?').join(',')})`)
      }
      if (nonNull.length !== list.length) {
        parts.push(`${c} IS NULL`)
      }
      return `(${parts.join(' OR ')})`
    }
    case 'isEmpty':
      return `(${c} IS NULL OR ${c} = '')`
    case 'isNotEmpty':
      return `(${c} IS NOT NULL AND ${c} <> '')`
    default:
      throw new Error(`Unknown filter op: ${filter.op}`)
  }
}

function buildWhere(query: RunDataQuery, params: unknown[], excludeField?: string) {
  const def = getDataset(query.dataset)
  const clauses: string[] = []
  const tokens = (query.keyword ?? '').trim().split(/\s+/).filter(Boolean)
  const searchable = def.fields.filter((it) => it.searchable)
  for (const token of tokens) {
    clauses.push(
      `(${searchable
        .map((f) => {
          params.push(escapeLike(token))
          return `t."${f.key}" LIKE ? ESCAPE '\\'`
        })
        .join(' OR ')})`
    )
  }
  for (const filter of query.filters ?? []) {
    if (filter.field === excludeField) continue
    const sql = buildFilterSql(query.dataset, filter, params)
    if (sql) clauses.push(sql)
  }
  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
}

function buildOrderBy(query: RunDataQuery) {
  const def = getDataset(query.dataset)
  const sort = query.sort ?? def.defaultSort
  if (!sort) {
    // job_info has no usable timestamp (publishDate is never filled), so fall back to insertion order
    return `ORDER BY t._rowid DESC`
  }
  const dir = sort.order === 'asc' ? 'ASC' : 'DESC'
  return `ORDER BY ${col(query.dataset, sort.field)} ${dir}, t."${def.rowKey}" ${dir}`
}

const fromSql = (dataset: RunDataDatasetKey) => `FROM (${baseSql[dataset]}) AS t`

export function queryRunData(db: Db, query: RunDataPageQuery): PagedRes<Row> {
  const pageNo = Math.max(1, Number(query.pageNo) || 1)
  const pageSize = Math.min(5000, Math.max(1, Number(query.pageSize) || 100))
  const params: unknown[] = []
  const where = buildWhere(query, params)
  const from = fromSql(query.dataset)
  const { total } = db.prepare(`SELECT COUNT(*) AS total ${from} ${where}`).get(...params) as {
    total: number
  }
  const data = db
    .prepare(`SELECT t.* ${from} ${where} ${buildOrderBy(query)} LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (pageNo - 1) * pageSize) as Row[]
  return { data, pageNo, totalItemCount: total }
}

export const EXPORT_ROW_LIMIT = 200000

export function queryAllRunData(db: Db, query: RunDataQuery): Row[] {
  const params: unknown[] = []
  const where = buildWhere(query, params)
  return db
    .prepare(
      `SELECT t.* ${fromSql(query.dataset)} ${where} ${buildOrderBy(query)} LIMIT ${EXPORT_ROW_LIMIT}`
    )
    .all(...params) as Row[]
}

export function getRunDataDistinctValues(db: Db, req: RunDataDistinctReq): RunDataDistinctItem[] {
  const c = col(req.dataset, req.field)
  const params: unknown[] = []
  // ignore the filter on the field itself so every option stays pickable
  const where = buildWhere(req, params, req.field)
  const limit = Math.min(2000, Math.max(1, Number(req.limit) || 500))
  return db
    .prepare(
      `SELECT ${c} AS value, COUNT(*) AS count ${fromSql(req.dataset)} ${where}
       GROUP BY ${c} ORDER BY count DESC LIMIT ?`
    )
    .all(...params, limit) as RunDataDistinctItem[]
}

function groupExpr(dataset: RunDataDatasetKey, group: RunDataStatsGroup, params: unknown[]) {
  const c = col(dataset, group.field)
  const local = `datetime(${c}, 'localtime')`
  switch (group.bucket) {
    case 'day':
      return `strftime('%Y-%m-%d', ${local})`
    case 'week':
      return `strftime('%Y-W%W', ${local})`
    case 'month':
      return `strftime('%Y-%m', ${local})`
    case 'hour':
      return `strftime('%H', ${local})`
    case 'weekday':
      return `strftime('%w', ${local})`
    case 'numberRange': {
      const ranges = (group.ranges ?? []).map(Number).filter((n) => Number.isFinite(n))
      if (!ranges.length) return c
      const cases: string[] = [`WHEN ${c} IS NULL THEN NULL`]
      cases.push(`WHEN ${c} < ? THEN ?`)
      params.push(ranges[0], `<${ranges[0]}`)
      for (let i = 1; i < ranges.length; i++) {
        cases.push(`WHEN ${c} < ? THEN ?`)
        params.push(ranges[i], `${ranges[i - 1]}-${ranges[i]}`)
      }
      params.push(`${ranges[ranges.length - 1]}+`)
      return `CASE ${cases.join(' ')} ELSE ? END`
    }
    default:
      return c
  }
}

const orderedBuckets: (RunDataStatsGroup['bucket'] | undefined)[] = [
  'day',
  'week',
  'month',
  'hour',
  'weekday'
]

export function getRunDataStats(db: Db, req: RunDataStatsReq): RunDataStatsRes {
  const from = fromSql(req.dataset)
  const whereParams: unknown[] = []
  const where = buildWhere(req, whereParams)
  const { total } = db.prepare(`SELECT COUNT(*) AS total ${from} ${where}`).get(...whereParams) as {
    total: number
  }

  const groups: RunDataStatsRes['groups'] = {}
  for (const group of req.groups ?? []) {
    const exprParams: unknown[] = []
    const expr = groupExpr(req.dataset, group, exprParams)
    const limit = Math.min(1000, Math.max(1, Number(group.limit) || 20))
    if (group.bucket === 'numberRange') {
      // keep range order rather than count order; params for the CASE appear twice
      const rows = db
        .prepare(
          `SELECT ${expr} AS name, COUNT(*) AS value, MIN(${col(req.dataset, group.field)}) AS sortKey
           ${from} ${where} GROUP BY ${expr} HAVING name IS NOT NULL ORDER BY sortKey`
        )
        .all(...exprParams, ...whereParams, ...exprParams) as { name: string; value: number }[]
      groups[group.id] = rows.map(({ name, value }) => ({ name, value }))
      continue
    }
    const byName = orderedBuckets.includes(group.bucket)
    // for enums NULL is a meaningful value (e.g. chatStartupFrom NULL = 自动)
    const isEnum =
      !group.bucket &&
      getDataset(req.dataset).fields.find((f) => f.key === group.field)?.type === 'enum'
    const rows = db
      .prepare(
        `SELECT ${expr} AS name, COUNT(*) AS value ${from} ${where}
         GROUP BY ${expr} ${isEnum ? '' : `HAVING name IS NOT NULL AND name <> ''`}
         ORDER BY ${byName ? 'name DESC' : 'value DESC'} LIMIT ?`
      )
      .all(...exprParams, ...whereParams, ...exprParams, limit) as {
      name: string
      value: number
    }[]
    groups[group.id] = byName ? rows.reverse() : rows
  }

  const numeric: RunDataStatsRes['numeric'] = {}
  for (const field of req.numericFields ?? []) {
    const c = col(req.dataset, field)
    numeric[field] = db
      .prepare(
        `SELECT AVG(${c}) AS avg, MIN(${c}) AS min, MAX(${c}) AS max, COUNT(${c}) AS count ${from} ${where}`
      )
      .get(...whereParams) as RunDataStatsRes['numeric'][string]
  }

  const distinct: RunDataStatsRes['distinct'] = {}
  for (const field of req.distinctFields ?? []) {
    const c = col(req.dataset, field)
    const { n } = db
      .prepare(`SELECT COUNT(DISTINCT ${c}) AS n ${from} ${where}`)
      .get(...whereParams) as { n: number }
    distinct[field] = n
  }

  return { total, groups, numeric, distinct }
}

export function deleteRunData(db: Db, req: RunDataDeleteReq) {
  const { table, pk } = deleteTarget[req.dataset] ?? {}
  if (!table) throw new Error(`Unknown dataset: ${req.dataset}`)
  const keys = [...new Set(req.keys ?? [])]
  let deleted = 0
  db.transaction(() => {
    for (let i = 0; i < keys.length; i += 500) {
      const chunk = keys.slice(i, i + 500)
      const res = db
        .prepare(`DELETE FROM "${table}" WHERE "${pk}" IN (${chunk.map(() => '?').join(',')})`)
        .run(...chunk)
      deleted += res.changes
    }
  })()
  return { deleted }
}

// ---------- import ----------

const isBlank = (v: unknown) => v === null || v === undefined || v === ''
// text keeps its whitespace (descriptions often end with a newline); ids and dates are trimmed
const str = (v: unknown) => (isBlank(v) || !String(v).trim() ? null : String(v))
const key = (v: unknown) => str(v)?.trim() ?? null
const num = (v: unknown) => {
  if (isBlank(v)) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
export const nowDbDate = () => new Date().toISOString().replace('T', ' ').replace('Z', '')

// spreadsheet round trips turn \r\n into \n and numbers into strings; neither counts as a change
function sameValue(a: unknown, b: unknown) {
  if (a === b) return true
  if (isBlank(a) || isBlank(b)) return isBlank(a) && isBlank(b)
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b)
  return String(a).replace(/\r\n/g, '\n') === String(b).replace(/\r\n/g, '\n')
}

/**
 * INSERT a row, or UPDATE only the columns whose value actually changed when the pk exists.
 * `required` fills NOT NULL columns on insert when the source row lacks them.
 * `insertOnly` never touches an existing row (used for data a row merely references).
 */
function upsert(
  db: Db,
  table: string,
  pk: string,
  values: Record<string, unknown>,
  required: Record<string, unknown> = {},
  { insertOnly = false } = {}
): 'inserted' | 'updated' | 'unchanged' {
  const present = Object.entries(values).filter(([k, v]) => k !== pk && !isBlank(v))
  const existing = db.prepare(`SELECT * FROM "${table}" WHERE "${pk}" = ?`).get(values[pk]) as
    | Row
    | undefined
  if (existing) {
    const changed = insertOnly ? [] : present.filter(([k, v]) => !sameValue(existing[k], v))
    if (!changed.length) return 'unchanged'
    db.prepare(
      `UPDATE "${table}" SET ${changed.map(([k]) => `"${k}" = ?`).join(', ')} WHERE "${pk}" = ?`
    ).run(...changed.map(([, v]) => v), values[pk])
    return 'updated'
  }
  const insertValues = { ...required, ...Object.fromEntries(present), [pk]: values[pk] }
  const keys = Object.keys(insertValues)
  db.prepare(
    `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
  ).run(...keys.map((k) => insertValues[k]))
  return 'inserted'
}

function upsertCompany(db: Db, id: unknown, values: Record<string, unknown>, insertOnly = false) {
  if (isBlank(id)) return 'unchanged'
  return upsert(
    db,
    'company_info',
    'encryptCompanyId',
    { encryptCompanyId: key(id), ...values },
    { name: str(values.name) ?? '', brandName: str(values.brandName) ?? str(values.name) ?? '' },
    { insertOnly }
  )
}

function upsertBoss(db: Db, id: unknown, values: Record<string, unknown>, insertOnly = false) {
  if (isBlank(id)) return 'unchanged'
  return upsert(
    db,
    'boss_info',
    'encryptBossId',
    { encryptBossId: key(id), ...values },
    { name: '', title: '', date: nowDbDate() },
    { insertOnly }
  )
}

function upsertJobFromRow(db: Db, row: Row, insertOnly = false) {
  return upsert(
    db,
    'job_info',
    'encryptJobId',
    {
      encryptJobId: key(row.encryptJobId),
      jobName: str(row.jobName),
      positionName: str(row.positionName),
      salaryLow: num(row.salaryLow),
      salaryHigh: num(row.salaryHigh),
      salaryMonth: num(row.salaryMonth),
      experienceName: str(row.experienceName),
      publishDate: key(row.publishDate),
      degreeName: str(row.degreeName),
      address: str(row.address),
      description: str(row.description),
      encryptBossId: key(row.encryptBossId),
      encryptCompanyId: key(row.encryptCompanyId)
    },
    {
      jobName: '',
      positionName: '',
      experienceName: '',
      description: '',
      encryptBossId: '',
      encryptCompanyId: ''
    },
    { insertOnly }
  )
}

// add company/boss rows referenced by a job-shaped row when they're missing;
// existing ones are left alone since the db copy is usually newer than the file
function insertJobRelations(db: Db, row: Row) {
  upsertCompany(db, row.encryptCompanyId, { name: str(row.companyName) }, true)
  upsertBoss(
    db,
    row.encryptBossId,
    {
      name: str(row.bossName),
      title: str(row.bossTitle),
      encryptCompanyId: key(row.encryptCompanyId)
    },
    true
  )
}

function importLogRow(
  db: Db,
  table: 'chat_startup_log' | 'mark_as_not_suit_log',
  row: Row,
  fallbackUserId: string
): 'inserted' | 'skipped' {
  const encryptJobId = key(row.encryptJobId)
  const date = key(row.date)
  if (!encryptJobId) throw new Error('缺少职位ID')
  if (!date) throw new Error('缺少时间')
  const userId = key(row.encryptCurrentUserId) ?? fallbackUserId
  // referenced user / job / boss / company rows are only added when missing
  if (str(row.userName) && userId) {
    upsert(
      db,
      'user_info',
      'encryptUserId',
      { encryptUserId: userId, name: str(row.userName) },
      {},
      {
        insertOnly: true
      }
    )
  }
  if (str(row.jobName) || key(row.encryptBossId) || key(row.encryptCompanyId)) {
    insertJobRelations(db, row)
    upsertJobFromRow(db, row, true)
  }
  const exists = db
    .prepare(`SELECT 1 FROM "${table}" WHERE encryptJobId = ? AND date = ?`)
    .get(encryptJobId, date)
  if (exists) return 'skipped'
  const values: Row =
    table === 'chat_startup_log'
      ? { chatStartupFrom: num(row.chatStartupFrom), jobSource: num(row.jobSource) }
      : {
          markFrom: num(row.markFrom),
          markReason: num(row.markReason),
          markOp: num(row.markOp),
          extInfo: str(row.extInfo),
          jobSource: num(row.jobSource)
        }
  const all = { encryptJobId, encryptCurrentUserId: userId, date, ...values }
  const keys = Object.keys(all)
  db.prepare(
    `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
  ).run(...keys.map((k) => all[k]))
  return 'inserted'
}

export function importRunData(db: Db, req: RunDataImportReq): RunDataImportRes {
  const def = getDataset(req.dataset)
  const rows = Array.isArray(req.rows) ? req.rows : []
  const res: RunDataImportRes = {
    total: rows.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: []
  }
  const fallbackUserId =
    (
      db
        .prepare(`SELECT encryptCurrentUserId AS id FROM chat_startup_log ORDER BY id DESC LIMIT 1`)
        .get() as { id?: string } | undefined
    )?.id ??
    (db.prepare(`SELECT encryptUserId AS id FROM user_info LIMIT 1`).get() as { id?: string })
      ?.id ??
    ''

  const importOne = (row: Row): 'inserted' | 'updated' | 'unchanged' | 'skipped' => {
    switch (def.key) {
      case 'chatStartupLog':
        return importLogRow(db, 'chat_startup_log', row, fallbackUserId)
      case 'markAsNotSuitLog':
        return importLogRow(db, 'mark_as_not_suit_log', row, fallbackUserId)
      case 'jobLibrary':
        if (!key(row.encryptJobId)) throw new Error('缺少职位ID')
        insertJobRelations(db, row)
        return upsertJobFromRow(db, row)
      case 'bossLibrary':
        if (!key(row.encryptBossId)) throw new Error('缺少BOSS ID')
        upsertCompany(db, row.encryptCompanyId, { name: str(row.companyName) }, true)
        return upsertBoss(db, row.encryptBossId, {
          name: str(row.name),
          title: str(row.title),
          date: key(row.date),
          encryptCompanyId: key(row.encryptCompanyId)
        })
      case 'favoriteJobs':
        throw new Error('收藏夹不支持导入，请在职位库中选择职位后收藏')
      case 'companyLibrary':
        if (!key(row.encryptCompanyId)) throw new Error('缺少公司ID')
        return upsertCompany(db, row.encryptCompanyId, {
          name: str(row.name),
          brandName: str(row.brandName),
          scaleLow: num(row.scaleLow),
          scaleHigh: num(row.scaleHigh),
          stageName: str(row.stageName),
          industryName: str(row.industryName)
        })
    }
  }

  // nested transaction = savepoint, so one bad row rolls back alone
  const importOneInSavepoint = db.transaction((row: Row) => importOne(row))
  db.transaction(() => {
    rows.forEach((row, index) => {
      try {
        const result = importOneInSavepoint(row ?? {})
        if (result === 'inserted') res.inserted++
        else if (result === 'updated') res.updated++
        else res.skipped++
      } catch (err) {
        res.skipped++
        if (res.errors.length < 200) {
          // +2: 1-based and the header line
          res.errors.push({ row: index + 2, message: (err as Error)?.message ?? String(err) })
        }
      }
    })
  })()
  return res
}
