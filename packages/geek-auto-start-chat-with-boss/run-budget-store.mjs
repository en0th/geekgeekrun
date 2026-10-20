import fs from 'node:fs'
import path from 'node:path'
import { writeJsonAtomicSync } from '@geekgeekrun/utils/atomic-json.mjs'
import { budgetStateError, normalizeBudgetUsage } from './run-budget.mjs'

export function createBudgetStore(folder, runRecordId) {
  const id = Number(runRecordId)
  if (!Number.isSafeInteger(id) || id < 0) throw budgetStateError('运行编号无效，无法关联预算记录')
  if (!id) return { load: () => null, save: () => {} } // standalone CLI: current process only
  const file = path.join(folder, 'auto-chat-run-budgets', id + '.json')
  return {
    load() {
      try {
        const state = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (state.version !== 1 || state.runRecordId !== id || !state.usage) throw budgetStateError()
        normalizeBudgetUsage(state.usage)
        return state
      } catch (error) {
        if (error.code === 'ENOENT') return null
        throw budgetStateError()
      }
    },
    save(state) { writeJsonAtomicSync(file, { version: 1, runRecordId: id, ...state }) }
  }
}
