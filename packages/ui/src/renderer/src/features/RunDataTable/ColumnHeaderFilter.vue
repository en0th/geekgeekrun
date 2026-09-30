<template>
  <!-- stop propagation so clicking the icon doesn't toggle column sorting -->
  <span class="column-header-filter" @click.stop>
    <ElPopover
      v-model:visible="visible"
      trigger="click"
      placement="bottom"
      :width="280"
      @show="loadOptions"
    >
      <template #reference>
        <ElIcon
          class="column-header-filter__icon"
          :class="{ 'is-active': !!modelValue?.length }"
          :title="`筛选${field.label}`"
        >
          <Filter />
        </ElIcon>
      </template>
      <!-- no v-loading here: loading starts while the popper is still hidden, which can leave
           the mask stuck mid-transition on top of the options and swallowing clicks -->
      <div class="column-header-filter__panel">
        <ElInput v-model="search" size="small" placeholder="搜索选项" clearable />
        <div class="flex items-center justify-between mt6px mb4px">
          <span class="text-12px color-#909399">
            共 {{ options.length }} 项{{
              options.length >= OPTION_LIMIT ? '（仅显示最多的前 ' + OPTION_LIMIT + ' 项）' : ''
            }}
          </span>
          <span>
            <ElButton link size="small" type="primary" @click="checkAllVisible">全选</ElButton>
            <ElButton link size="small" type="primary" @click="invertVisible">反选</ElButton>
          </span>
        </div>
        <ElScrollbar max-height="260px">
          <ElCheckboxGroup v-model="checked" class="flex flex-col">
            <ElCheckbox
              v-for="opt in visibleOptions"
              :key="opt.key"
              :value="opt.key"
              size="small"
              class="column-header-filter__option"
            >
              <span class="column-header-filter__label" :title="opt.label">{{ opt.label }}</span>
              <span class="column-header-filter__count">{{ opt.count }}</span>
            </ElCheckbox>
          </ElCheckboxGroup>
          <div
            v-if="loading || !visibleOptions.length"
            class="text-center text-12px color-#909399 py12px"
          >
            {{ loading ? '加载中…' : '无匹配选项' }}
          </div>
        </ElScrollbar>
        <div class="flex justify-end gap-8px mt8px">
          <ElButton size="small" @click="handleReset">重置</ElButton>
          <ElButton size="small" type="primary" @click="handleConfirm">确定</ElButton>
        </div>
      </div>
    </ElPopover>
  </span>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ElButton,
  ElCheckbox,
  ElCheckboxGroup,
  ElIcon,
  ElInput,
  ElMessage,
  ElPopover,
  ElScrollbar
} from 'element-plus'
import { Filter } from '@element-plus/icons-vue'
import type { RunDataDistinctItem, RunDataField, RunDataQuery } from '../../../../common/run-data'
import { enumLabel, toPlain } from './format'
import { enumKey } from './filters'

const OPTION_LIMIT = 500

const props = defineProps<{
  field: RunDataField
  // current keyword + other filters; options are counted within them
  query: RunDataQuery
  modelValue: (string | number | null)[] | null
}>()
const emit = defineEmits<{
  'update:modelValue': [value: (string | number | null)[] | null]
}>()

const visible = ref(false)
const loading = ref(false)
const search = ref('')
const options = ref<{ key: string; value: string | number | null; label: string; count: number }[]>(
  []
)
const checked = ref<string[]>([])

const labelOf = (value: string | number | null) =>
  props.field.type === 'enum'
    ? enumLabel(props.field, value) || '(空)'
    : value === null || value === ''
      ? '(空)'
      : String(value)

async function loadOptions() {
  search.value = ''
  checked.value = (props.modelValue ?? []).map(enumKey)
  loading.value = true
  try {
    const { data } = (await electron.ipcRenderer.invoke(
      'run-data-distinct-values',
      toPlain({ ...props.query, field: props.field.key, limit: OPTION_LIMIT })
    )) as { data: RunDataDistinctItem[] }
    options.value = data.map((it) => ({
      key: enumKey(it.value),
      value: it.value,
      label: labelOf(it.value),
      count: it.count
    }))
    // keep currently selected values visible even when they no longer match
    for (const v of props.modelValue ?? []) {
      if (!options.value.some((o) => o.key === enumKey(v))) {
        options.value.push({ key: enumKey(v), value: v, label: labelOf(v), count: 0 })
      }
    }
  } catch (err) {
    ElMessage.error(`加载筛选项失败：${(err as Error)?.message ?? err}`)
  } finally {
    loading.value = false
  }
}

const visibleOptions = computed(() => {
  const kw = search.value.trim().toLowerCase()
  return kw ? options.value.filter((o) => o.label.toLowerCase().includes(kw)) : options.value
})

function checkAllVisible() {
  checked.value = [...new Set([...checked.value, ...visibleOptions.value.map((o) => o.key)])]
}
function invertVisible() {
  const visibleKeys = new Set(visibleOptions.value.map((o) => o.key))
  const kept = checked.value.filter((k) => !visibleKeys.has(k))
  const inverted = visibleOptions.value.map((o) => o.key).filter((k) => !checked.value.includes(k))
  checked.value = [...kept, ...inverted]
}

function handleConfirm() {
  const values = options.value.filter((o) => checked.value.includes(o.key)).map((o) => o.value)
  emit('update:modelValue', values.length ? values : null)
  visible.value = false
}
function handleReset() {
  checked.value = []
  emit('update:modelValue', null)
  visible.value = false
}
</script>

<style scoped lang="scss">
.column-header-filter {
  display: inline-flex;
  vertical-align: middle;
  margin-left: 2px;
  &__icon {
    cursor: pointer;
    color: var(--el-text-color-placeholder);
    &:hover,
    &.is-active {
      color: var(--el-color-primary);
    }
  }
}
// the popover is teleported to <body>, so panel styles can't nest under the header span
.column-header-filter {
  &__option {
    margin-right: 0;
    height: 26px;
    :deep(.el-checkbox__label) {
      display: flex;
      flex: 1;
      min-width: 0;
      justify-content: space-between;
      gap: 8px;
    }
  }
  &__label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 180px;
  }
  &__count {
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }
}
.column-header-filter__panel :deep(.el-checkbox) {
  width: 100%;
}
</style>
