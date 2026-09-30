// Per-table view preferences (column order / visibility / width, page size) kept in localStorage.
import { ref, watch } from 'vue'
import type { RunDataDatasetKey } from '../../../../common/run-data'

export interface RunDataTablePrefs {
  order: string[]
  // undefined = use each column's defaultHidden
  hidden?: string[]
  widths: Record<string, number>
  pageSize?: number
}

const storageKey = (dataset: RunDataDatasetKey) => `ggr:run-data-table:${dataset}`

const emptyPrefs = (): RunDataTablePrefs => ({ order: [], widths: {} })

function load(dataset: RunDataDatasetKey): RunDataTablePrefs {
  try {
    const raw = localStorage.getItem(storageKey(dataset))
    return raw ? { ...emptyPrefs(), ...JSON.parse(raw) } : emptyPrefs()
  } catch {
    return emptyPrefs()
  }
}

export function useRunDataTablePrefs(dataset: RunDataDatasetKey) {
  const prefs = ref<RunDataTablePrefs>(load(dataset))
  watch(
    prefs,
    (value) => {
      try {
        localStorage.setItem(storageKey(dataset), JSON.stringify(value))
      } catch {
        //
      }
    },
    { deep: true }
  )
  const reset = () => {
    prefs.value = { ...emptyPrefs(), pageSize: prefs.value.pageSize }
  }
  return { prefs, reset }
}
