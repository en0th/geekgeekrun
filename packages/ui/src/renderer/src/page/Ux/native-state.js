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
              current.config['target-company-list.json'] = Array.isArray(patch.expectCompanies)
                ? clone(patch.expectCompanies)
                : patch.expectCompanies.split(',').filter(Boolean)
          }
          return true
        })
      queue = operation
      return operation
    },
    async saveModels(models) {
      const result = await ipc.invoke('ux-save-models', clone(models))
      // the main process returns the saved list with keys blanked
      current.config['llm.json'] = result.models
      current.modelDraft = null
      return result
    },
    async listModels(model) {
      return ipc.invoke('ux-list-models', clone(model))
    },
    async testModels(models) {
      return ipc.invoke('ux-test-models', clone(models))
    },
    async saveDingtalk({ token = '', clear = false }) {
      const result = await ipc.invoke('ux-save-dingtalk', { token, clear })
      current.config['dingtalk.json'] = {
        ...(current.config['dingtalk.json'] || {}),
        groupRobotAccessToken: '',
        hasGroupRobotAccessToken: result.hasGroupRobotAccessToken
      }
    },
    async readPrompt(type) {
      return ipc.invoke('ux-read-prompt', { type })
    },
    async savePrompt(type, text) {
      await ipc.invoke('ux-save-prompt', { type, text })
      current.prompts[type] = text
    },
    async jobs() {
      const { data: result } = await ipc.invoke('run-data-query', {
        dataset: 'jobLibrary',
        filters: [],
        keyword: '',
        sort: null,
        pageNo: 1,
        pageSize: 100
      })
      if (!Array.isArray(result?.data)) throw new Error('职位库返回的数据格式不正确')
      return { rows: result.data, total: Number(result.totalItemCount || 0) }
    }
  }
  return bridge
}
