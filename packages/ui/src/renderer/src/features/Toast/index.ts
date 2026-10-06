// Notifications in the top-right corner, styled like iPhone lock-screen notices.
// Call-compatible with ElMessage (toast('…'), toast.success('…'), toast({ type, message,
// duration })) so every notice in the app goes through here.
import { createApp, type VNode } from 'vue'
import ToastStack from './ToastStack.vue'
import { close, items, push, type ToastType } from './store'

export interface ToastOptions {
  message?: string | VNode
  type?: ToastType | 'primary'
  title?: string
  duration?: number
  action?: { label: string; onClick: () => unknown }
  // accepted for ElMessage compatibility; every notice can be closed
  showClose?: boolean
  grouping?: boolean
}

const defaultTitles: Record<ToastType, string> = {
  success: '已完成',
  info: '提示',
  warning: '请注意',
  error: '出错了'
}
const defaultDurations: Record<ToastType, number> = {
  success: 3000,
  info: 4000,
  warning: 5000,
  error: 6500
}

let mounted = false
function ensureMounted() {
  if (mounted || typeof document === 'undefined') return
  mounted = true
  const host = document.createElement('div')
  host.className = 'ggr-toast-host'
  document.body.appendChild(host)
  createApp(ToastStack).mount(host)
}

const textOf = (message: unknown) =>
  typeof message === 'string' ? message : message == null ? '' : String(message)

function show(input: string | ToastOptions, forcedType?: ToastType) {
  ensureMounted()
  const options: ToastOptions = typeof input === 'string' ? { message: input } : input || {}
  const type: ToastType =
    forcedType ?? (options.type && options.type !== 'primary' ? options.type : 'info')
  const id = push({
    type,
    title: options.title || defaultTitles[type],
    message: textOf(options.message),
    action: options.action,
    duration: options.duration ?? defaultDurations[type]
  })
  return { close: () => close(id) }
}

type ToastFn = ((input: string | ToastOptions) => { close: () => void }) & {
  [K in ToastType]: (input: string | ToastOptions) => { close: () => void }
} & { closeAll: () => void }

export const toast = Object.assign((input: string | ToastOptions) => show(input), {
  success: (input: string | ToastOptions) => show(input, 'success'),
  info: (input: string | ToastOptions) => show(input, 'info'),
  warning: (input: string | ToastOptions) => show(input, 'warning'),
  error: (input: string | ToastOptions) => show(input, 'error'),
  closeAll: () => {
    for (const it of items.value) close(it.id)
  }
}) as ToastFn

/**
 * Notices from the main process and from background tasks:
 * 'toast-message' from the UI process, and worker messages of type 'toast' relayed by the daemon.
 */
export function listenForAppToasts() {
  type Listener = (event: unknown, payload: never) => void
  const ipc = (
    globalThis as { electron?: { ipcRenderer?: { on: (channel: string, fn: Listener) => void } } }
  ).electron?.ipcRenderer
  if (!ipc) return
  ipc.on('toast-message', (_: unknown, payload: ToastOptions) => toast(payload))
  // data.type is the message kind ('toast'), so the notice's own type travels as `level`
  ipc.on(
    'worker-to-gui-message',
    (_: unknown, message: { data?: { type?: string; level?: ToastOptions['type'] } }) => {
      if (message?.data?.type !== 'toast') return
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { type, level, ...rest } = message.data as ToastOptions & {
        level?: ToastOptions['type']
      }
      toast({ ...rest, type: level ?? 'info' })
    }
  )
}
