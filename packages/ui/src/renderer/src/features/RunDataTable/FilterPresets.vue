<template>
  <ElPopover v-model:visible="open" trigger="click" placement="bottom-start" :width="380">
    <template #reference>
      <ElButton size="small" :icon="CollectionTag">常用条件</ElButton>
    </template>
    <div class="filter-presets">
      <div class="filter-presets__title">已保存</div>
      <div v-if="!saved.length" class="filter-presets__empty">
        暂无。设置好过滤条件后点“保存当前条件”。
      </div>
      <div
        v-for="item in saved"
        :key="item.id"
        class="filter-presets__item"
        role="button"
        tabindex="0"
        @click="pick(item)"
        @keydown.enter="pick(item)"
      >
        <div class="filter-presets__text">
          <strong>{{ item.name }}</strong>
          <span>{{ describe(item.snapshot) }}</span>
        </div>
        <ElButton link size="small" type="danger" @click.stop="emit('remove-saved', item.id)"
          >删除</ElButton
        >
      </div>

      <div class="filter-presets__title">
        最近使用
        <span class="filter-presets__limit">
          保留
          <ElInputNumber
            v-model="limit"
            size="small"
            :min="0"
            :max="HISTORY_LIMIT_MAX"
            :step="1"
            step-strictly
            controls-position="right"
            aria-label="最近使用保留条数"
          />
          条
        </span>
      </div>
      <div v-if="!recent.length" class="filter-presets__empty">
        {{ limit ? '暂无。使用过的过滤条件会出现在这里。' : '已关闭最近使用记录。' }}
      </div>
      <div
        v-for="item in recent"
        :key="item.id"
        class="filter-presets__item"
        role="button"
        tabindex="0"
        @click="pick(item)"
        @keydown.enter="pick(item)"
      >
        <div class="filter-presets__text">
          <span>{{ describe(item.snapshot) }}</span>
          <small>{{ timeText(item.at) }}</small>
        </div>
        <ElButton link size="small" type="primary" @click.stop="emit('save', item.snapshot)"
          >保存</ElButton
        >
        <ElButton link size="small" @click.stop="emit('remove-recent', item.id)">移除</ElButton>
      </div>

      <div class="filter-presets__footer">
        <ElButton size="small" type="primary" :disabled="!canSave" @click="saveCurrent"
          >保存当前条件</ElButton
        >
      </div>
    </div>
  </ElPopover>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import dayjs from 'dayjs'
import { ElButton, ElInputNumber, ElPopover } from 'element-plus'
import { CollectionTag } from '@element-plus/icons-vue'
import {
  HISTORY_LIMIT_MAX,
  historyLimit,
  type FilterSnapshot,
  type StoredFilter
} from './filter-memory'

defineProps<{
  saved: StoredFilter[]
  recent: StoredFilter[]
  canSave: boolean
  describe: (snapshot: FilterSnapshot) => string
}>()
const emit = defineEmits<{
  (e: 'apply', snapshot: FilterSnapshot): void
  // no snapshot = the current conditions
  (e: 'save', snapshot?: FilterSnapshot): void
  (e: 'remove-saved', id: string): void
  (e: 'remove-recent', id: string): void
}>()

const limit = historyLimit
const open = ref(false)
function pick(item: StoredFilter) {
  open.value = false
  emit('apply', item.snapshot)
}
function saveCurrent() {
  open.value = false
  emit('save')
}
function timeText(at: number) {
  const d = dayjs(at)
  return d.isSame(dayjs(), 'day') ? d.format('HH:mm') : d.format('MM-DD HH:mm')
}
</script>

<style scoped lang="scss">
.filter-presets {
  max-height: min(460px, 70vh);
  overflow: auto;
  font-size: 13px;
  &__title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 4px 0 6px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    & + & {
      margin-top: 12px;
    }
  }
  &__item + &__title {
    margin-top: 12px;
  }
  &__empty + &__title {
    margin-top: 12px;
  }
  &__limit {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 400;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    .el-input-number {
      width: 76px;
    }
  }
  &__empty {
    padding: 6px 0;
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }
  &__item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    margin: 0 -8px;
    border-radius: 6px;
    cursor: pointer;
    &:hover,
    &:focus-visible {
      background: var(--el-fill-color-light);
      outline: none;
    }
    .el-button + .el-button {
      margin-left: 0;
    }
  }
  &__text {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--el-text-color-regular);
    }
    small {
      color: var(--el-text-color-secondary);
    }
  }
  &__footer {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--el-border-color-lighter);
  }
}
</style>
