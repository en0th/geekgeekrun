<template>
  <ElPopover trigger="click" placement="bottom-end" :width="240">
    <template #reference>
      <ElButton size="small" :icon="Setting">列设置</ElButton>
    </template>
    <div class="flex items-center justify-between mb6px">
      <span class="text-12px color-#909399">勾选显示，拖动排序</span>
      <ElButton link size="small" type="primary" @click="emit('reset')">恢复默认</ElButton>
    </div>
    <ElScrollbar max-height="360px">
      <Draggable
        :model-value="columns"
        item-key="key"
        handle=".column-settings__handle"
        :animation="150"
        @update:model-value="
          (list) =>
            emit(
              'update:order',
              list.map((c) => c.key)
            )
        "
      >
        <template #item="{ element }">
          <div class="column-settings__item">
            <ElIcon class="column-settings__handle"><Rank /></ElIcon>
            <ElCheckbox
              :model-value="!hidden.includes(element.key)"
              size="small"
              :disabled="!hidden.includes(element.key) && visibleCount <= 1"
              @update:model-value="(checked) => toggle(element.key, !!checked)"
              >{{ element.label }}</ElCheckbox
            >
          </div>
        </template>
      </Draggable>
    </ElScrollbar>
    <div class="text-12px color-#909399 mt6px">拖动表头边框可调整列宽</div>
  </ElPopover>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ElButton, ElCheckbox, ElIcon, ElPopover, ElScrollbar } from 'element-plus'
import { Rank, Setting } from '@element-plus/icons-vue'
import Draggable from 'vuedraggable'

const props = defineProps<{
  // all columns in current order
  columns: { key: string; label: string }[]
  hidden: string[]
}>()
const emit = defineEmits<{
  'update:order': [order: string[]]
  'update:hidden': [hidden: string[]]
  reset: []
}>()

const visibleCount = computed(
  () => props.columns.filter((c) => !props.hidden.includes(c.key)).length
)

function toggle(key: string, checked: boolean) {
  emit('update:hidden', checked ? props.hidden.filter((k) => k !== key) : [...props.hidden, key])
}
</script>

<style scoped lang="scss">
.column-settings__item {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  :deep(.el-checkbox) {
    height: auto;
  }
}
.column-settings__handle {
  cursor: move;
  color: var(--el-text-color-placeholder);
}
</style>
