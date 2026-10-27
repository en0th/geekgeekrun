<script setup lang="ts">
import { computed, ref } from 'vue'
import Draggable from 'vuedraggable'

const props = defineProps<{ items: { type: string }[]; labels: Record<string, string> }>()
const emit = defineEmits<{ reorder: [types: string[]] }>()
const dragging = ref(false), announcement = ref('')
const animation = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180
const ordered = computed({ get: () => props.items, set: items => emit('reorder', items.map(item => item.type)) })
function moved(event: { moved?: { newIndex: number; element: { type: string } } }) {
  if (event.moved) announcement.value = `${props.labels[event.moved.element.type]}已移到第${event.moved.newIndex + 1}位`
}
function moveWithKeyboard(index: number, direction: number) {
  const to = index + direction
  if (to < 0 || to >= props.items.length) return
  const next = props.items.slice(), [item] = next.splice(index, 1)
  next.splice(to, 0, item)
  emit('reorder', next.map(item => item.type))
  announcement.value = `${props.labels[item.type]}已移到第${to + 1}位`
}
</script>

<template>
  <Draggable v-model="ordered" item-key="type" handle=".ux-source-drag-handle" class="ux-source-drag-list"
    :animation="animation" :force-fallback="true" :fallback-on-body="true" :fallback-tolerance="4"
    ghost-class="ux-source-drag-ghost" chosen-class="ux-source-drag-chosen" drag-class="ux-source-drag-moving"
    easing="cubic-bezier(0.2, 0, 0, 1)" :class="{ 'is-dragging': dragging }"
    @start="dragging = true" @end="dragging = false" @change="moved">
    <template #item="{ element, index }">
      <div class="ux-source-drag-row" :data-source-type="element.type">
        <span class="ux-source-order-number">{{ index + 1 }}</span>
        <span class="ux-source-order-label">{{ labels[element.type] || element.type }}</span>
        <button type="button" class="ux-source-drag-handle" :aria-label="`调整${labels[element.type]}顺序`"
          title="拖动调整顺序，也可按Alt＋上下方向键" @keydown.alt.up.prevent="moveWithKeyboard(index, -1)" @keydown.alt.down.prevent="moveWithKeyboard(index, 1)">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
            <circle cx="9" cy="5" r="1.5" /><circle cx="15" cy="5" r="1.5" />
            <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="19" r="1.5" /><circle cx="15" cy="19" r="1.5" />
          </svg>
        </button>
      </div>
    </template>
  </Draggable>
  <span class="ux-source-order-announcement" aria-live="polite">{{ announcement }}</span>
</template>

<style>
.ux-source-drag-list { display: grid; gap: 8px; }
.ux-source-drag-row { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 4px 4px 4px 12px; border: 1px solid var(--el-border-color-light); border-radius: 6px; background: var(--el-bg-color); color: var(--el-text-color-primary); font-size: var(--ggr-font-size-body); }
.ux-source-drag-handle { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 36px; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--el-text-color-secondary); cursor: grab; touch-action: none; font-size: 16px; }
.ux-source-drag-handle:hover { background: var(--el-fill-color-light); color: var(--el-color-primary); }
.ux-source-drag-handle:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 1px; }
.ux-source-drag-handle:active, .is-dragging .ux-source-drag-handle { cursor: grabbing; }
.ux-source-order-number { min-width: 16px; color: var(--el-text-color-secondary); font-variant-numeric: tabular-nums; }
.ux-source-order-label { flex: 1; }
.ux-source-drag-ghost { opacity: .4; background: var(--el-color-primary-light-9); border-color: var(--el-color-primary); }
.ux-source-drag-chosen { border-color: var(--el-color-primary); }
.ux-source-drag-moving { opacity: .95; box-shadow: var(--el-box-shadow-light); background: var(--el-bg-color); }
.ux-source-order-announcement { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
