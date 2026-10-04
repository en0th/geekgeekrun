<template>
  <div class="ggr-toast-stack" aria-live="polite" aria-atomic="false">
    <TransitionGroup name="ggr-toast">
      <div
        v-for="item in items"
        :key="item.id"
        class="ggr-toast"
        :class="'is-' + item.type"
        :role="item.type === 'error' || item.type === 'warning' ? 'alert' : 'status'"
        @mouseenter="pause(item)"
        @mouseleave="resume(item)"
        @click="close(item.id)"
      >
        <div class="ggr-toast__head">
          <img class="ggr-toast__app-icon" :src="appIcon" alt="" />
          <span class="ggr-toast__app">牛人快跑</span>
          <span class="ggr-toast__time">{{ timeText(item.createdAt) }}</span>
          <button
            type="button"
            class="ggr-toast__close"
            aria-label="关闭通知"
            @click.stop="close(item.id)"
          >
            ×
          </button>
        </div>
        <div class="ggr-toast__body">
          <span class="ggr-toast__glyph" aria-hidden="true">{{ glyph[item.type] }}</span>
          <div class="ggr-toast__text">
            <div class="ggr-toast__title">{{ item.title }}</div>
            <div class="ggr-toast__message">{{ item.message }}</div>
            <button
              v-if="item.action"
              type="button"
              class="ggr-toast__action"
              @click.stop="runAction(item)"
            >
              {{ item.action.label }}
            </button>
          </div>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<script lang="ts" setup>
import { onBeforeUnmount, ref } from 'vue'
import appIcon from '@renderer/../../../resources/icon.png'
import { items, close, pause, resume, type ToastItem } from './store'

async function runAction(item: ToastItem) {
  await item.action?.onClick()
  close(item.id)
}

const glyph = { success: '✓', info: 'i', warning: '!', error: '×' }

// "现在" for fresh notices, then minutes, like the lock screen
const now = ref(Date.now())
const clock = setInterval(() => (now.value = Date.now()), 15 * 1000)
onBeforeUnmount(() => clearInterval(clock))
function timeText(createdAt: number) {
  const minutes = Math.floor((now.value - createdAt) / 60000)
  return minutes < 1 ? '现在' : `${minutes} 分钟前`
}
</script>

<style lang="scss">
.ggr-toast-stack {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 5000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(360px, calc(100vw - 24px));
  pointer-events: none;
}
.ggr-toast {
  --toast-bg: rgba(246, 246, 248, 0.82);
  --toast-text: #1c1c1e;
  --toast-muted: rgba(60, 60, 67, 0.6);
  position: relative;
  box-sizing: border-box;
  padding: 10px 14px 12px;
  border-radius: 18px;
  background: var(--toast-bg);
  color: var(--toast-text);
  box-shadow:
    0 10px 30px rgba(0, 0, 0, 0.16),
    0 0 0 0.5px rgba(0, 0, 0, 0.08);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei UI',
    'Microsoft YaHei', sans-serif;
  cursor: pointer;
  pointer-events: auto;
  user-select: none;
}
.ggr-toast__head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--toast-muted);
}
.ggr-toast__app-icon {
  width: 18px;
  height: 18px;
  border-radius: 5px;
}
.ggr-toast__app {
  flex: 1;
  letter-spacing: 0.02em;
}
.ggr-toast__time {
  font-variant-numeric: tabular-nums;
}
.ggr-toast__close {
  display: none;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(120, 120, 128, 0.24);
  color: var(--toast-text);
  font-size: 13px;
  line-height: 18px;
  cursor: pointer;
}
.ggr-toast:hover .ggr-toast__close,
.ggr-toast__close:focus-visible {
  display: block;
}
.ggr-toast:hover .ggr-toast__time {
  display: none;
}
.ggr-toast__body {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.ggr-toast__glyph {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  margin-top: 1px;
  border-radius: 50%;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  line-height: 20px;
  text-align: center;
}
.ggr-toast.is-success .ggr-toast__glyph {
  background: #34c759;
}
.ggr-toast.is-info .ggr-toast__glyph {
  background: #0a84ff;
  font-family: Georgia, serif;
  font-style: italic;
}
.ggr-toast.is-warning .ggr-toast__glyph {
  background: #ff9f0a;
}
.ggr-toast.is-error .ggr-toast__glyph {
  background: #ff3b30;
}
.ggr-toast__text {
  min-width: 0;
}
.ggr-toast__action {
  margin-top: 8px;
  padding: 4px 14px;
  border: 0;
  border-radius: 999px;
  background: rgba(120, 120, 128, 0.2);
  color: #0a84ff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.ggr-toast__action:hover {
  background: rgba(120, 120, 128, 0.3);
}
.ggr-toast__title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.35;
}
.ggr-toast__message {
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-top: 1px;
  font-size: 13px;
  line-height: 1.45;
  white-space: pre-line;
  word-break: break-word;
}
/* drops in from the top like a new notification, leaves to the right when dismissed */
.ggr-toast-enter-active {
  transition:
    transform 0.42s cubic-bezier(0.2, 0.9, 0.3, 1.15),
    opacity 0.3s ease;
}
.ggr-toast-leave-active {
  transition:
    transform 0.28s ease-in,
    opacity 0.28s ease-in;
  position: absolute;
  width: 100%;
}
.ggr-toast-move {
  transition: transform 0.3s ease;
}
.ggr-toast-enter-from {
  opacity: 0;
  transform: translateY(-14px) scale(0.96);
}
.ggr-toast-leave-to {
  opacity: 0;
  transform: translateX(110%);
}
@media (prefers-reduced-motion: reduce) {
  .ggr-toast-enter-active,
  .ggr-toast-leave-active,
  .ggr-toast-move {
    transition: opacity 0.15s linear;
  }
  .ggr-toast-enter-from,
  .ggr-toast-leave-to {
    transform: none;
  }
}
</style>
