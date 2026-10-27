import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { writeJsonAtomicSync } from '@geekgeekrun/utils/atomic-json.mjs'
import { jobConfigSnapshot } from './task-config-snapshot.mjs'
const states = new Set(['pending', 'waiting', 'starting', 'started', 'blocked', 'missed', 'cancelled', 'needs-review'])
export function createScheduledRunStore(folder, { now = Date.now, id = randomUUID, write = writeJsonAtomicSync } = {}) {
  const file = path.join(folder, 'scheduled-job-runs.json')
  function read() {
    if (!fs.existsSync(file)) return { version: 1, items: [] }
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (value.version !== 1 || !Array.isArray(value.items) || value.items.some(item =>
        !item || typeof item.id !== 'string' || !Number.isSafeInteger(item.at) || !states.has(item.state) ||
        typeof item.accountId !== 'string' || !item.accountId || !item.config?.['boss.json'])) throw Error()
      return value
    } catch { throw Error('定时启动记录无法读取，原文件已保留；为避免重复启动，不会自动补跑。') }
  }
  const save = data => { fs.mkdirSync(folder, { recursive: true }); write(file, data) }
  function change(key, mutate) {
    const data = read(), item = data.items.find(item => item.id === key)
    if (!item) throw Error('定时启动记录已不存在，请重新读取')
    mutate(item); save(data); return item
  }
  return {
    list: () => read().items.map(({ config, ...item }) => item).sort((a, b) => a.at - b.at),
    due: () => read().items.filter(item => ['pending', 'waiting'].includes(item.state) && item.at <= now()).sort((a, b) => a.at - b.at),
    create(at, accountId, config) {
      if (!Number.isSafeInteger(at) || at < now() + 60000 || at > now() + 31 * 86400000) throw Error('请选择至少1分钟后、31天内的启动时间')
      if (typeof accountId !== 'string' || !accountId.trim()) throw Error('请先登录并确认BOSS账号')
      const data = read()
      if (data.items.filter(item => ['pending', 'waiting', 'starting'].includes(item.state)).length >= 50) throw Error('待启动任务过多，请先处理已有定时启动记录')
      const item = { id: id(), at, accountId, createdAt: now(), state: 'pending', detail: '等待设定的启动时间；需要电脑及软件保持运行', config: jobConfigSnapshot(config) }
      data.items.push(item); save(data); return item.id
    },
    cancel(key) { return change(key, item => { if (!['pending', 'waiting', 'blocked', 'missed'].includes(item.state)) throw Error('该任务已开始处理，不能直接取消；请检查任务列表'); item.state = 'cancelled'; item.detail = '已取消定时启动' }) },
    set(key, state, detail, runRecordId) {
      if (!states.has(state)) throw Error('Invalid scheduled state')
      return change(key, item => { if (item.state === 'cancelled') throw Error('定时启动已取消'); Object.assign(item, { state, detail, ...(runRecordId ? { runRecordId } : {}) }) })
    },
    recoverOnOpen() {
      const data = read(), affected = []
      for (const item of data.items) {
        if (['pending', 'waiting'].includes(item.state) && item.at < now()) {
          item.state = 'missed'; item.detail = '应用未运行或重启期间错过设定的启动时间，未补跑；请确认后重新设置定时启动'; affected.push(item)
        } else if (item.state === 'starting') {
          item.state = 'needs-review'; item.detail = '上次启动结果未确认，请先检查任务列表，避免重复开始'; affected.push(item)
        }
      }
      if (affected.length) save(data)
      return affected
    }
  }
}

export function createScheduleRunner({ store, busy, start, notify = () => {} }) {
  let checking = false
  return async function tick() {
    if (checking) return
    checking = true
    try {
      for (const item of store.due()) {
        if (await busy()) { store.set(item.id, 'waiting', '等待当前找岗位任务结束，不会并行执行'); break }
        // Claim before the asynchronous account check. A crash leaves needs-review,
        // not a pending entry that could silently launch the same task twice.
        store.set(item.id, 'starting', '正在核对账号和启动条件')
        try {
          const result = await start(item)
          if (result?.isAlreadyRunning) { store.set(item.id, 'waiting', '已有找岗位任务，等待其结束'); break }
          if (!Number.isSafeInteger(Number(result?.runRecordId)) || Number(result.runRecordId) <= 0) {
            store.set(item.id, 'needs-review', '任务提交结果未确认，请先检查任务列表，避免重复启动')
            break
          }
          store.set(item.id, 'started', result?.queued ? '已进入任务列表，等待前一任务结束' : '定时任务已启动，进度见任务列表', result?.runRecordId)
          try { notify('定时启动任务已提交', '可在任务列表查看进度；仍按保存的条件执行。') } catch { /* notification cannot reverse a submitted task */ }
        } catch (error) { store.set(item.id, 'blocked', error.message || '启动条件未满足，未执行'); try { notify('未能定时启动', error.message || '请检查任务列表') } catch {} }
        break
      }
    } finally { checking = false }
  }
}
