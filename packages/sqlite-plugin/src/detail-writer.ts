import { createHash } from 'node:crypto'

// Network capture and the detail hook can see the same update concurrently.
// Serialize detail writes on the shared SQLite connection; remember only a bounded
// set of successful versions. Async ORM transactions must not overlap across jobs.
export function createDetailWriter(save: (detail: any) => Promise<unknown>, capacity = 256,
  onUnchanged?: (detail: any) => Promise<unknown>) {
  let tail = Promise.resolve()
  const saved = new Map<string, string>()
  return (detail: any): Promise<void> => {
    const id = detail?.jobInfo?.encryptId
    if (typeof id !== 'string' || !id || !detail?.bossInfo || !detail?.brandComInfo)
      return Promise.reject(new Error('岗位详情不完整，无法保存'))
    const signature = createHash('sha256').update(JSON.stringify(detail, (key, value) => {
      if (key.startsWith('__ggr_')) return undefined
      // API responses and Vue snapshots can enumerate the same fields in different orders.
      return value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.keys(value).sort().map(name => [name, value[name]]))
        : value
    })).digest('hex')
    const task = tail.catch(() => {}).then(async () => {
      if (saved.get(id) === signature) {
        await onUnchanged?.(detail)
        return
      }
      await save(detail)
      saved.delete(id)
      saved.set(id, signature)
      if (saved.size > capacity) saved.delete(saved.keys().next().value)
    })
    tail = task
    return task
  }
}
