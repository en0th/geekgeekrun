// Filter conditions of a table: kept for the app session (switching tabs / pages keeps them),
// plus saved and recently used conditions kept in localStorage.
import { ref, watch } from 'vue'
import dayjs from 'dayjs'
import type { RunDataField } from '../../../../common/run-data'
import type { FilterRow } from './filters'

export interface FilterSnapshot {
  keyword: string
  rows: FilterRow[]
  // header value filters by field key
  columns: Record<string, (string | number | null)[]>
}

export interface StoredFilter {
  id: string
  // saved conditions only
  name?: string
  at: number
  snapshot: FilterSnapshot
}

export const isEmptySnapshot = (s: FilterSnapshot) =>
  !s.keyword && !s.rows.length && !Object.keys(s.columns).length

// stable text for comparing snapshots (column order does not matter)
export const snapshotKey = (s: FilterSnapshot) =>
  JSON.stringify([
    s.keyword,
    s.rows,
    Object.keys(s.columns)
      .sort()
      .map((k) => [k, s.columns[k]])
  ])

// ---------- session ----------
const session = new Map<string, FilterSnapshot>()
export const sessionFilters = {
  get: (key: string) => session.get(key) ?? null,
  set: (key: string, snapshot: FilterSnapshot) => session.set(key, snapshot)
}

// ---------- saved / recent ----------
export const HISTORY_LIMIT_DEFAULT = 5
export const HISTORY_LIMIT_MAX = 50
const limitKey = 'ggr:run-data-filter-history-limit'
const listKey = (key: string) => `ggr:run-data-filters:${key}`

function readLimit() {
  try {
    const n = Number(localStorage.getItem(limitKey))
    return localStorage.getItem(limitKey) !== null && Number.isInteger(n) && n >= 0
      ? Math.min(n, HISTORY_LIMIT_MAX)
      : HISTORY_LIMIT_DEFAULT
  } catch {
    return HISTORY_LIMIT_DEFAULT
  }
}
// shared by every table
export const historyLimit = ref(readLimit())
watch(historyLimit, (n) => {
  try {
    localStorage.setItem(limitKey, String(n))
  } catch {
    //
  }
})

// dates are stored as ISO strings; turn them back into Date objects for date fields
function revive(snapshot: FilterSnapshot, fields: RunDataField[]): FilterSnapshot {
  const typeOf = (key: string) => fields.find((f) => f.key === key)?.type
  const toDate = (v: unknown) =>
    v === null || v === undefined || v === '' ? v : dayjs(v as string).toDate()
  return {
    keyword: snapshot.keyword ?? '',
    rows: (snapshot.rows ?? [])
      .filter((r) => typeOf(r.field))
      .map((r) =>
        typeOf(r.field) === 'date'
          ? { ...r, value: Array.isArray(r.value) ? r.value.map(toDate) : toDate(r.value) }
          : r
      ),
    columns: Object.fromEntries(Object.entries(snapshot.columns ?? {}).filter(([k]) => typeOf(k)))
  }
}

/** key: the dataset, or a table's own key when it must not share conditions with it */
export function useFilterMemory(dataset: string, fields: () => RunDataField[]) {
  const load = (): { saved: StoredFilter[]; recent: StoredFilter[] } => {
    try {
      const raw = JSON.parse(localStorage.getItem(listKey(dataset)) || '{}')
      const fix = (list: unknown) =>
        (Array.isArray(list) ? (list as StoredFilter[]) : []).map((it) => ({
          ...it,
          snapshot: revive(it.snapshot, fields())
        }))
      return { saved: fix(raw.saved), recent: fix(raw.recent) }
    } catch {
      return { saved: [], recent: [] }
    }
  }
  const initial = load()
  const saved = ref<StoredFilter[]>(initial.saved)
  const recent = ref<StoredFilter[]>(initial.recent.slice(0, historyLimit.value))
  watch(
    [saved, recent],
    () => {
      try {
        localStorage.setItem(
          listKey(dataset),
          JSON.stringify({ saved: saved.value, recent: recent.value })
        )
      } catch {
        //
      }
    },
    { deep: true }
  )
  watch(historyLimit, (n) => (recent.value = recent.value.slice(0, n)))

  const copy = (s: FilterSnapshot): FilterSnapshot =>
    revive(JSON.parse(JSON.stringify(s)), fields())
  const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

  function remember(snapshot: FilterSnapshot) {
    if (isEmptySnapshot(snapshot) || !historyLimit.value) return
    const key = snapshotKey(snapshot)
    recent.value = [
      { id: newId(), at: Date.now(), snapshot: copy(snapshot) },
      ...recent.value.filter((it) => snapshotKey(it.snapshot) !== key)
    ].slice(0, historyLimit.value)
  }
  /** returns false when the same conditions are already saved */
  function save(name: string, snapshot: FilterSnapshot) {
    const key = snapshotKey(snapshot)
    const existing = saved.value.find((it) => snapshotKey(it.snapshot) === key)
    if (existing) {
      existing.name = name
      existing.at = Date.now()
      return false
    }
    saved.value = [{ id: newId(), name, at: Date.now(), snapshot: copy(snapshot) }, ...saved.value]
    return true
  }
  const removeSaved = (id: string) => (saved.value = saved.value.filter((it) => it.id !== id))
  const removeRecent = (id: string) => (recent.value = recent.value.filter((it) => it.id !== id))
  return { saved, recent, remember, save, removeSaved, removeRecent, copy }
}
