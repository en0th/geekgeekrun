// Datasets whose rows the page sends with each query (clientRows): they are put in a temporary
// table so the shared table gets the same search, filters, sorting and statistics.
import type { RunDataDatasetDef } from '../../../../../../common/run-data'
import type { Db } from './run-data'

export function refreshClientRows(db: Db, def: RunDataDatasetDef, rows: unknown) {
  const table = `client_${def.key}`
  const columns = def.fields.map((f) => f.key)
  const type = (key: string) =>
    def.fields.find((f) => f.key === key)?.type === 'number' ? 'REAL' : 'TEXT'
  db.prepare(
    `CREATE TEMP TABLE IF NOT EXISTS "${table}" (${columns.map((c) => `"${c}" ${type(c)}`).join(', ')})`
  ).run()
  const insert = db.prepare(
    `INSERT INTO temp."${table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
  )
  const list = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []
  db.transaction(() => {
    db.prepare(`DELETE FROM temp."${table}"`).run()
    for (const row of list)
      insert.run(...columns.map((c) => (row?.[c] === undefined ? null : (row[c] as unknown))))
  })()
}
