// State behind the notification stack; one per window.
import { ref } from 'vue'

export type ToastType = 'success' | 'info' | 'warning' | 'error'

export interface ToastItem {
  id: number
  type: ToastType
  title: string
  message: string
  // one button under the text, e.g. 撤销
  action?: { label: string; onClick: () => unknown }
  createdAt: number
  // 0 keeps it until clicked
  duration: number
  timer?: ReturnType<typeof setTimeout>
  remaining: number
  startedAt: number
}

const MAX_VISIBLE = 5
let seq = 0

export const items = ref<ToastItem[]>([])

function schedule(item: ToastItem) {
  if (!item.duration) return
  item.startedAt = Date.now()
  item.timer = setTimeout(() => close(item.id), item.remaining)
}

export function close(id: number) {
  const item = items.value.find((it) => it.id === id)
  if (item?.timer) clearTimeout(item.timer)
  items.value = items.value.filter((it) => it.id !== id)
}

// reading a notice under the pointer shouldn't be cut short
export function pause(item: ToastItem) {
  if (!item.timer) return
  clearTimeout(item.timer)
  item.timer = undefined
  item.remaining = Math.max(1000, item.remaining - (Date.now() - item.startedAt))
}
export function resume(item: ToastItem) {
  if (item.duration && !item.timer) schedule(item)
}

export function push(input: Omit<ToastItem, 'id' | 'createdAt' | 'remaining' | 'startedAt'>) {
  // the same notice repeated quickly (e.g. a double click) shows once
  const same = items.value.find(
    (it) => it.type === input.type && it.message === input.message && it.title === input.title
  )
  if (same) close(same.id)
  const item: ToastItem = {
    ...input,
    id: ++seq,
    createdAt: Date.now(),
    remaining: input.duration,
    startedAt: Date.now()
  }
  // newest on top, like the lock screen
  items.value = [item, ...items.value]
  for (const old of items.value.slice(MAX_VISIBLE)) close(old.id)
  schedule(items.value.find((it) => it.id === item.id)!)
  return item.id
}
