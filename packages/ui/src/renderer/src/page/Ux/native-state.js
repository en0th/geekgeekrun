import {
  validModelList,
  followErrors,
  normalizeCache,
  clone
} from '../../../../common/ux-validation.mjs'
export { validModelList, followErrors, normalizeCache }

export async function createNativeState() {
  const ipc = window.electron.ipcRenderer
  let current = await ipc.invoke('ux-load-state')
  let revision = current.revision
  let queue = Promise.resolve()
  const bridge = {
    state: () => clone(current),
    async refresh() {
      await queue.catch(() => {})
      const next = await ipc.invoke('ux-load-state')
      current = next
      revision = next.revision
      return bridge.state()
    },
    saveUx(state, configPatch) {
      const captured = clone(state),
        patch = configPatch ? clone(configPatch) : null
      const operation = queue
        .catch(() => {})
        .then(async () => {
          const result = await ipc.invoke('ux-save-state', {
            expectedRevision: revision,
            state: captured,
            configPatch: patch
          })
          revision = result.revision
          current.revision = revision
          current.uxState = captured
          if (patch) {
            Object.assign(current.config['boss.json'], patch)
            if (Object.hasOwn(patch, 'expectCompanies'))
              current.config['target-company-list.json'] = patch.expectCompanies
                .split(',')
                .filter(Boolean)
          }
          return true
        })
      queue = operation
      return operation
    },
    async saveModels(models) {
      const result = await ipc.invoke('ux-save-models', clone(models))
      current.config['llm.json'] = clone(models)
      current.modelDraft = null
      return result
    },
    async testModels(models) {
      return ipc.invoke('ux-test-models', clone(models))
    },
    async readPrompt(type) {
      return ipc.invoke('ux-read-prompt', { type })
    },
    async savePrompt(type, text) {
      await ipc.invoke('ux-save-prompt', { type, text })
      current.prompts[type] = text
    },
    async jobs() {
      const result = await ipc.invoke('run-data-query-all', {
        dataset: 'jobLibrary',
        filters: [],
        keyword: '',
        sort: null
      })
      return Array.isArray(result) ? result : result.rows || result.data || []
    }
  }
  return bridge
}
