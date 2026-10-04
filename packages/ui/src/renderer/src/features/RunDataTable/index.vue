<template>
  <div class="run-data-table" :class="{ 'is-fullscreen': isFullscreen }">
    <!-- toolbar -->
    <div class="run-data-table__toolbar">
      <ElInput
        v-model="keywordInput"
        size="small"
        clearable
        :prefix-icon="Search"
        :placeholder="`搜索${searchableLabels}`"
        class="run-data-table__search"
        @keydown.enter="applyKeyword"
        @clear="applyKeyword"
      />
      <ElBadge :value="advancedRows.length" :hidden="!advancedRows.length" type="primary">
        <ElButton size="small" :icon="Operation" @click="filterDialogVisible = true">过滤</ElButton>
      </ElBadge>
      <div class="run-data-table__tools">
        <ElButton size="small" :icon="DataAnalysis" @click="openStats">统计</ElButton>
        <ElButton
          v-if="datasetDef.importable !== false"
          size="small"
          :icon="Upload"
          @click="openImport"
          >导入</ElButton
        >
        <ElDropdown trigger="click" @command="exportAll">
          <ElButton size="small" :icon="Download" :loading="exporting">导出</ElButton>
          <template #dropdown>
            <ElDropdownMenu>
              <ElDropdownItem disabled
                >导出当前结果（{{ pagination.totalItemCount }} 条）</ElDropdownItem
              >
              <ElDropdownItem v-for="f in exportFormatOptions" :key="f.value" :command="f.value">{{
                f.label
              }}</ElDropdownItem>
            </ElDropdownMenu>
          </template>
        </ElDropdown>
        <ColumnSettings
          :columns="orderedColumns"
          :hidden="hiddenKeys"
          @update:order="(order) => (prefs.order = order)"
          @update:hidden="(hidden) => (prefs.hidden = hidden)"
          @reset="resetPrefs"
        />
        <ElButton
          size="small"
          :icon="isFullscreen ? Close : FullScreen"
          @click="toggleFullscreen"
          >{{ isFullscreen ? '退出全屏' : '全屏' }}</ElButton
        >
        <ElButton size="small" :icon="Refresh" :loading="isTableLoading" @click="handleRefresh"
          >刷新</ElButton
        >
      </div>
    </div>

    <!-- active conditions -->
    <div v-if="hasConditions" class="run-data-table__conditions">
      <ElTag v-if="appliedKeyword" size="small" closable @close="clearKeyword"
        >搜索：{{ appliedKeyword }}</ElTag
      >
      <ElTag
        v-for="(row, index) in advancedRows"
        :key="`adv-${index}`"
        size="small"
        type="primary"
        closable
        @close="advancedRows = advancedRows.filter((_, i) => i !== index)"
        >{{ describeAdvanced(row) }}</ElTag
      >
      <ElTag
        v-for="item in activeColumnFilters"
        :key="`col-${item.field.key}`"
        size="small"
        type="success"
        closable
        @close="columnFilters[item.field.key] = null"
        >{{ item.text }}</ElTag
      >
      <ElButton link size="small" type="primary" @click="clearAllConditions">清除全部</ElButton>
    </div>

    <!-- batch bar -->
    <div v-if="selection.length" class="run-data-table__batch">
      <span
        >已选 <strong>{{ selection.length }}</strong> 项</span
      >
      <ElDropdown trigger="click" @command="exportSelected">
        <ElButton size="small" link type="primary" :icon="Download">导出选中</ElButton>
        <template #dropdown>
          <ElDropdownMenu>
            <ElDropdownItem v-for="f in exportFormatOptions" :key="f.value" :command="f.value">{{
              f.label
            }}</ElDropdownItem>
          </ElDropdownMenu>
        </template>
      </ElDropdown>
      <ElButton size="small" link type="primary" :icon="DocumentCopy" @click="copySelected"
        >复制</ElButton
      >
      <ElButton
        v-if="datasetDef.hasJob"
        size="small"
        link
        type="primary"
        :icon="Link"
        :loading="openingOnline"
        @click="openSelectedOnline"
        >在BOSS查看所选职位</ElButton
      >
      <ElButton
        v-if="datasetDef.hasJob"
        size="small"
        link
        type="primary"
        :icon="Star"
        @click="openFavoritePicker"
        >收藏到…</ElButton
      >
      <ElButton size="small" link type="danger" :icon="Delete" @click="deleteSelected">{{
        dataset === 'favoriteJobs' ? '移出收藏夹' : '删除'
      }}</ElButton>
      <ElButton size="small" link @click="clearSelection">取消选择</ElButton>
    </div>

    <!-- table -->
    <div v-loading="isTableLoading" class="flex-1 of-hidden">
      <div ref="tableContainerEl" class="h-100% of-hidden">
        <ElTable
          ref="tableRef"
          :height="tableHeight"
          :data="tableData"
          :row-key="getRowKey"
          :default-sort="defaultSortForTable"
          size="small"
          border
          highlight-current-row
          @sort-change="handleSortChange"
          @selection-change="(rows) => (selection = rows)"
          @header-dragend="handleHeaderDragend"
        >
          <ElTableColumn type="selection" width="36" fixed="left" reserve-selection />
          <ElTableColumn
            v-for="col in displayedColumns"
            :key="col.key"
            :column-key="col.key"
            :prop="col.field?.key"
            :label="col.label"
            :width="prefs.widths[col.key] ?? col.width"
            :min-width="col.minWidth"
            :sortable="col.sortable ? 'custom' : false"
            :show-overflow-tooltip="!slots[`cell-${col.key}`]"
          >
            <template #header>
              <span>{{ col.label }}</span>
              <ColumnHeaderFilter
                v-if="col.headerFilter && col.field"
                v-model="columnFilters[col.field.key]"
                :field="col.field"
                :query="query"
              />
            </template>
            <template #default="{ row }">
              <slot :name="`cell-${col.key}`" :row="row">{{ cellText(col, row) }}</slot>
            </template>
          </ElTableColumn>
          <ElTableColumn
            v-if="slots.actions"
            label="操作"
            fixed="right"
            :width="actionsWidth ?? 120"
          >
            <template #default="{ row }">
              <slot name="actions" :row="row" />
            </template>
          </ElTableColumn>
        </ElTable>
      </div>
    </div>

    <div class="run-data-table__footer">
      <ElPagination
        v-model:current-page="pagination.pageNo"
        v-model:page-size="pagination.pageSize"
        :page-sizes="pageSizeList"
        small
        :disabled="isTableLoading"
        layout="total, sizes, prev, pager, next, jumper"
        :total="pagination.totalItemCount"
        @size-change="handlePageSizeChange"
        @current-change="fetchData"
      />
    </div>

    <FilterBuilder
      v-model:visible="filterDialogVisible"
      v-model="advancedRows"
      :fields="datasetDef.fields"
    />
    <StatsPanel
      v-model:visible="statsVisible"
      :dataset="dataset"
      :query="query"
      :preset="statsPreset"
      @drill="handleDrill"
    />
    <ImportDialog v-model:visible="importVisible" :dataset="dataset" @imported="fetchData" />
    <FavoriteFolderPicker
      v-model:visible="favoritePickerVisible"
      :job-ids="favoriteJobIds"
      @saved="handleFavoritesSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, reactive, ref, useSlots, watch } from 'vue'
import {
  ElBadge,
  ElButton,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElInput,
  ElMessage,
  ElMessageBox,
  ElPagination,
  ElTable,
  ElTableColumn,
  ElTag,
  type TableColumnCtx
} from 'element-plus'
import {
  Close,
  DataAnalysis,
  Delete,
  DocumentCopy,
  Download,
  FullScreen,
  Link,
  Operation,
  Refresh,
  Search,
  Star,
  Upload
} from '@element-plus/icons-vue'
import {
  runDataDatasets,
  type RunDataDatasetKey,
  type RunDataField,
  type RunDataFilter,
  type RunDataQuery,
  type RunDataSort
} from '../../../../common/run-data'
import type { PagedRes } from '../../../../common/types/pagination'
import { gtagRenderer } from '@renderer/utils/gtag'
import type { RunDataColumn, RunDataRow, RunDataStatsPreset } from './types'
import { useRunDataTablePrefs } from './prefs'
import { enumLabel, formatFieldValue, toPlain } from './format'
import {
  type FilterRow,
  describeFilterRow,
  drillToFilter,
  isFilterRowComplete,
  toServerFilter
} from './filters'
import { exportFormatOptions, exportRows, rowsToTsv, type ExportFormat } from './io'
import ColumnHeaderFilter from './ColumnHeaderFilter.vue'
import ColumnSettings from './ColumnSettings.vue'
import FilterBuilder from './FilterBuilder.vue'
import StatsPanel from './StatsPanel.vue'
import ImportDialog from './ImportDialog.vue'
import FavoriteFolderPicker from './FavoriteFolderPicker.vue'
import { useRunDataJumpStore } from '../../store'

const OPEN_ONLINE_LIMIT = 20

const props = defineProps<{
  dataset: RunDataDatasetKey
  columns: RunDataColumn[]
  statsPreset: RunDataStatsPreset
  // prefix for analytics events, e.g. `job_library` -> `job_library_request_sent`
  gtagPrefix: string
  actionsWidth?: number
  // always applied and not shown as removable conditions, e.g. the selected favourite folder
  baseFilters?: RunDataFilter[]
}>()

const emit = defineEmits<{
  // rows were deleted or favourited, so counts shown outside the table may be stale
  (e: 'changed'): void
}>()

const slots = useSlots()
const datasetDef = computed(() => runDataDatasets[props.dataset])
const searchableLabels = computed(() =>
  datasetDef.value.fields
    .filter((f) => f.searchable)
    .map((f) => f.label)
    .slice(0, 4)
    .join('/')
)

// ---------- columns ----------
interface ResolvedColumn extends Omit<RunDataColumn, 'field' | 'label'> {
  label: string
  field?: RunDataField
}

const defaultMinWidth = (field?: RunDataField) =>
  field?.type === 'date' ? 150 : field?.type === 'number' ? 90 : 110

const allColumns = computed<ResolvedColumn[]>(() => {
  const fieldOf = (key?: string) => datasetDef.value.fields.find((f) => f.key === key)
  const fromProps = props.columns.map((c) => {
    const field = fieldOf(c.field ?? c.key)
    return {
      ...c,
      field,
      label: c.label ?? field?.label ?? c.key,
      minWidth: c.minWidth ?? defaultMinWidth(field),
      sortable: c.sortable ?? !!field,
      headerFilter: c.headerFilter ?? (field?.type === 'string' || field?.type === 'enum')
    }
  })
  // every other dataset field is available from column settings, hidden by default
  const used = new Set(fromProps.map((c) => c.field?.key ?? c.key))
  const rest = datasetDef.value.fields
    .filter((f) => !used.has(f.key))
    .map((f) => ({
      key: f.key,
      label: f.label,
      field: f,
      minWidth: defaultMinWidth(f),
      sortable: true,
      headerFilter: f.type === 'string' || f.type === 'enum',
      defaultHidden: true
    }))
  return [...fromProps, ...rest]
})

const { prefs, reset: resetPrefs } = useRunDataTablePrefs(props.dataset)

const orderedColumns = computed(() => {
  const byKey = new Map(allColumns.value.map((c) => [c.key, c]))
  const ordered = prefs.value.order.map((k) => byKey.get(k)).filter(Boolean) as ResolvedColumn[]
  const rest = allColumns.value.filter((c) => !prefs.value.order.includes(c.key))
  return [...ordered, ...rest]
})
const hiddenKeys = computed(
  () => prefs.value.hidden ?? allColumns.value.filter((c) => c.defaultHidden).map((c) => c.key)
)
const displayedColumns = computed(() =>
  orderedColumns.value.filter((c) => !hiddenKeys.value.includes(c.key))
)

function handleHeaderDragend(newWidth: number, _old: number, column: TableColumnCtx<RunDataRow>) {
  if (column.columnKey) {
    prefs.value.widths = { ...prefs.value.widths, [column.columnKey]: Math.round(newWidth) }
  }
}

function cellText(col: ResolvedColumn, row: RunDataRow) {
  if (col.formatter) return col.formatter(row)
  return formatFieldValue(col.field, row[col.field?.key ?? col.key])
}

// ---------- query state ----------
const keywordInput = ref('')
const appliedKeyword = ref('')
const advancedRows = ref<FilterRow[]>([])
const columnFilters = reactive<Record<string, (string | number | null)[] | null>>({})
const sort = ref<RunDataSort | null>(null)

let keywordTimer: ReturnType<typeof setTimeout> | undefined
watch(keywordInput, () => {
  clearTimeout(keywordTimer)
  keywordTimer = setTimeout(applyKeyword, 400)
})
function applyKeyword() {
  clearTimeout(keywordTimer)
  appliedKeyword.value = keywordInput.value.trim()
}
function clearKeyword() {
  keywordInput.value = ''
  applyKeyword()
}

const fieldByKey = (key: string) => datasetDef.value.fields.find((f) => f.key === key)

const query = computed<RunDataQuery>(() => ({
  dataset: props.dataset,
  keyword: appliedKeyword.value,
  filters: [
    ...(props.baseFilters ?? []),
    ...advancedRows.value
      .filter((r) => isFilterRowComplete(r) && fieldByKey(r.field))
      .map((r) => toServerFilter(r, fieldByKey(r.field)!)),
    ...Object.entries(columnFilters)
      .filter(([, values]) => values?.length)
      .map(([field, values]) => ({ field, op: 'in' as const, value: [...values!] }))
  ],
  sort: sort.value
}))

const defaultSortForTable = computed(() => {
  const s = datasetDef.value.defaultSort
  return s
    ? ({ prop: s.field, order: s.order === 'asc' ? 'ascending' : 'descending' } as const)
    : undefined
})

function handleSortChange({ prop, order }: { prop: string; order: string | null }) {
  sort.value = order ? { field: prop, order: order === 'ascending' ? 'asc' : 'desc' } : null
}

const describeAdvanced = (row: FilterRow) => {
  const f = fieldByKey(row.field)
  return f ? describeFilterRow(row, f) : row.field
}
const activeColumnFilters = computed(() =>
  Object.entries(columnFilters)
    .filter(([, values]) => values?.length)
    .map(([key, values]) => {
      const field = fieldByKey(key)!
      const shown = values!
        .slice(0, 3)
        .map((v) =>
          field.type === 'enum'
            ? enumLabel(field, v) || '(空)'
            : v === null || v === ''
              ? '(空)'
              : v
        )
      return {
        field,
        text: `${field.label}：${shown.join('、')}${values!.length > 3 ? ` 等${values!.length}项` : ''}`
      }
    })
)
const hasConditions = computed(
  () =>
    !!appliedKeyword.value || advancedRows.value.length > 0 || activeColumnFilters.value.length > 0
)
function clearAllConditions() {
  keywordInput.value = ''
  appliedKeyword.value = ''
  advancedRows.value = []
  Object.keys(columnFilters).forEach((k) => (columnFilters[k] = null))
}

// ---------- opened from elsewhere with filters (task history) ----------
const jumpStore = useRunDataJumpStore()
function applyJump() {
  const target = jumpStore.take(props.dataset)
  if (!target) return
  clearAllConditions()
  advancedRows.value = target.rows as FilterRow[]
  ElMessage.success(`已筛选：${target.label}`)
}
applyJump()
watch(() => jumpStore.pending, applyJump)

// ---------- data ----------
const pageSizeList = [50, 100, 200, 500]
const pagination = ref({
  pageNo: 1,
  pageSize: prefs.value.pageSize ?? 100,
  totalItemCount: 0
})
const tableData = ref<RunDataRow[]>([])
const tableRef = ref<InstanceType<typeof ElTable>>()
const isTableLoading = ref(false)
const getRowKey = (row: RunDataRow) => String(row[datasetDef.value.rowKey])

let requestSeq = 0
async function fetchData() {
  const seq = ++requestSeq
  const eventParams = { page_no: pagination.value.pageNo, page_size: pagination.value.pageSize }
  isTableLoading.value = true
  try {
    gtagRenderer(`${props.gtagPrefix}_request_sent`, eventParams)
    const { data: res } = (await electron.ipcRenderer.invoke(
      'run-data-query',
      toPlain({
        ...query.value,
        pageNo: pagination.value.pageNo,
        pageSize: pagination.value.pageSize
      })
    )) as { data: PagedRes<RunDataRow> }
    if (seq !== requestSeq) return
    tableData.value = res.data
    pagination.value.totalItemCount = res.totalItemCount
    pagination.value.pageNo = res.pageNo
    gtagRenderer(`${props.gtagPrefix}_request_success`, eventParams)
  } catch (err) {
    if (seq !== requestSeq) return
    gtagRenderer(`${props.gtagPrefix}_request_error`, { err, ...eventParams })
    console.log(err)
    ElMessage.error(`加载数据失败：${(err as Error)?.message ?? err}`)
    tableData.value = []
  } finally {
    if (seq === requestSeq) {
      tableRef.value?.setScrollTop(0)
      isTableLoading.value = false
    }
  }
}

watch(
  () => JSON.stringify(query.value),
  () => {
    pagination.value.pageNo = 1
    fetchData()
  }
)
fetchData()

function handlePageSizeChange(size: number) {
  prefs.value.pageSize = size
  fetchData()
}
function handleRefresh() {
  gtagRenderer(`${props.gtagPrefix}_refresh_clicked`)
  fetchData()
}

const trackAction = (action: string, extra: Record<string, unknown> = {}) =>
  gtagRenderer('run_data_table_action', { dataset: props.dataset, action, ...extra })

// ---------- table height ----------
const tableHeight = ref<number | undefined>(undefined)
const tableContainerEl = ref<HTMLElement>()
onMounted(() => {
  const update = () => (tableHeight.value = tableContainerEl.value?.clientHeight || undefined)
  update()
  const ro = new ResizeObserver(update)
  ro.observe(tableContainerEl.value!)
  onBeforeUnmount(() => ro.disconnect())
})

// ---------- selection & batch operations ----------
const selection = ref<RunDataRow[]>([])
function clearSelection() {
  tableRef.value?.clearSelection()
  selection.value = []
}

async function exportSelected(format: ExportFormat) {
  trackAction('export_selected', { format, count: selection.value.length })
  try {
    const res = await exportRows(props.dataset, selection.value, format, '-选中')
    notifySaved(res)
  } catch (err) {
    ElMessage.error(`导出失败：${(err as Error)?.message ?? err}`)
  }
}

async function copySelected() {
  trackAction('copy_selected', { count: selection.value.length })
  const cols = displayedColumns.value
  const text = rowsToTsv(
    cols.map((c) => c.label),
    selection.value.map((row) => cols.map((c) => cellText(c, row)))
  )
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(`已复制 ${selection.value.length} 行（可直接粘贴到 Excel）`)
  } catch (err) {
    ElMessage.error(`复制失败：${(err as Error)?.message ?? err}`)
  }
}

const openingOnline = ref(false)
async function openSelectedOnline() {
  const ids = [...new Set(selection.value.map((r) => r.encryptJobId).filter(Boolean))] as string[]
  if (!ids.length) {
    ElMessage.warning('选中的记录中没有可打开的职位')
    return
  }
  let toOpen = ids
  if (ids.length > OPEN_ONLINE_LIMIT) {
    try {
      await ElMessageBox.confirm(
        `一次最多打开 ${OPEN_ONLINE_LIMIT} 个职位，将只打开前 ${OPEN_ONLINE_LIMIT} 个。`,
        '在BOSS查看所选职位',
        { type: 'warning', confirmButtonText: '继续', cancelButtonText: '取消' }
      )
    } catch {
      return
    }
    toOpen = ids.slice(0, OPEN_ONLINE_LIMIT)
  }
  trackAction('open_online_selected', { count: toOpen.length })
  openingOnline.value = true
  try {
    // sequential: the first call starts the browser process, later calls reuse it
    for (const id of toOpen) {
      await electron.ipcRenderer.invoke('open-site-with-boss-cookie', {
        url: `https://www.zhipin.com/job_detail/${id}.html`
      })
    }
  } finally {
    openingOnline.value = false
  }
}

const deleteWarning: Record<RunDataDatasetKey, string> = {
  chatStartupLog: '删除开聊记录后，程序可能会再次向这些职位发起开聊。',
  markAsNotSuitLog: '删除标记记录后，这些职位可能会被再次处理。',
  jobLibrary: '引用这些职位的开聊 / 标记记录将无法再显示职位信息。',
  bossLibrary: '引用这些 BOSS 的职位将无法再显示 BOSS 信息。',
  companyLibrary: '引用这些公司的职位 / BOSS 将无法再显示公司信息。',
  favoriteJobs: '只从收藏夹中移除，职位本身仍保留在职位库中。'
}

async function deleteSelected() {
  const count = selection.value.length
  try {
    await ElMessageBox.confirm(
      h('div', [
        h(
          'p',
          { class: 'm-0' },
          props.dataset === 'favoriteJobs'
            ? `确定将选中的 ${count} 个职位移出收藏夹吗？`
            : `确定从数据库中永久删除选中的 ${count} 条${datasetDef.value.label}吗？此操作不可撤销。`
        ),
        h('p', { class: 'm-0 mt6px color-#e6a23c' }, deleteWarning[props.dataset])
      ]),
      props.dataset === 'favoriteJobs' ? '移出收藏夹' : '删除记录',
      {
        type: 'warning',
        confirmButtonText:
          props.dataset === 'favoriteJobs' ? `移出 ${count} 个` : `删除 ${count} 条`,
        confirmButtonClass: 'el-button--danger',
        cancelButtonText: '取消'
      }
    )
  } catch {
    return
  }
  trackAction('delete_selected', { count })
  try {
    const { data } = (await electron.ipcRenderer.invoke(
      'run-data-delete',
      toPlain({
        dataset: props.dataset,
        keys: selection.value.map((r) => r[datasetDef.value.rowKey])
      })
    )) as { data: { deleted: number } }
    ElMessage.success(`已删除 ${data.deleted} 条记录`)
    clearSelection()
    fetchData()
    emit('changed')
  } catch (err) {
    ElMessage.error(`删除失败：${(err as Error)?.message ?? err}`)
  }
}

// ---------- favourites ----------
const favoritePickerVisible = ref(false)
const favoriteJobIds = ref<string[]>([])
function openFavoritePicker() {
  const ids = [...new Set(selection.value.map((r) => r.encryptJobId).filter(Boolean))] as string[]
  if (!ids.length) {
    ElMessage.warning('选中的记录中没有可收藏的职位')
    return
  }
  trackAction('favorite_selected', { count: ids.length })
  favoriteJobIds.value = ids
  favoritePickerVisible.value = true
}
function handleFavoritesSaved() {
  clearSelection()
  emit('changed')
  if (props.dataset === 'favoriteJobs') fetchData()
}

// ---------- export all ----------
const exporting = ref(false)
function notifySaved(res: { canceled: boolean; filePath?: string }) {
  if (res.canceled || !res.filePath) return
  ElMessage({
    type: 'success',
    message: `已导出到 ${res.filePath}`,
    duration: 5000,
    showClose: true
  })
  electron.ipcRenderer.invoke('show-item-in-folder', res.filePath)
}
async function exportAll(format: ExportFormat) {
  trackAction('export_all', { format, count: pagination.value.totalItemCount })
  exporting.value = true
  try {
    const { data: rows } = (await electron.ipcRenderer.invoke(
      'run-data-query-all',
      toPlain(query.value)
    )) as { data: RunDataRow[] }
    if (!rows.length) {
      ElMessage.warning('没有可导出的数据')
      return
    }
    if (rows.length < pagination.value.totalItemCount) {
      ElMessage.warning(`数据量过大，仅导出前 ${rows.length} 条`)
    }
    notifySaved(await exportRows(props.dataset, rows, format))
  } catch (err) {
    ElMessage.error(`导出失败：${(err as Error)?.message ?? err}`)
  } finally {
    exporting.value = false
  }
}

// ---------- dialogs ----------
const filterDialogVisible = ref(false)
const statsVisible = ref(false)
const importVisible = ref(false)
function openStats() {
  trackAction('open_stats')
  statsVisible.value = true
}
function openImport() {
  trackAction('open_import')
  importVisible.value = true
}

// ---------- stats drill-down ----------
function handleDrill({
  group,
  raw,
  label
}: {
  group: { field: string; bucket?: string }
  raw: unknown
  label: string
}) {
  const field = fieldByKey(group.field)
  if (!field) return
  const filter = drillToFilter(group, raw)
  if (filter.kind === 'unsupported') {
    ElMessage.info('按小时、星期统计的项暂不支持筛选')
    return
  }
  trackAction('stats_drill', { field: group.field, bucket: group.bucket ?? '' })
  if (filter.kind === 'column') {
    // replaces any value filter on that column, like picking it in the header filter
    columnFilters[filter.field] = filter.values
  } else {
    advancedRows.value = [...advancedRows.value, ...filter.rows]
  }
  statsVisible.value = false
  ElMessage.success(`已添加筛选：${field.label} ${label}`)
}

// ---------- fullscreen ----------
const isFullscreen = ref(false)
function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value
  trackAction(isFullscreen.value ? 'enter_fullscreen' : 'exit_fullscreen')
}
function handleKeydown(e: KeyboardEvent) {
  // leave Esc to any open dialog / drawer / popper first
  const overlayOpen = [...document.querySelectorAll<HTMLElement>('.el-overlay, .el-popper')].some(
    (el) => el.offsetParent !== null || getComputedStyle(el).display !== 'none'
  )
  if (e.key === 'Escape' && isFullscreen.value && !overlayOpen) {
    isFullscreen.value = false
  }
}
onMounted(() => document.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown)
  clearTimeout(keywordTimer)
})
</script>

<style scoped lang="scss">
.run-data-table {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  box-sizing: border-box;
  overflow: hidden;
  background: var(--el-bg-color);
  &.is-fullscreen {
    position: fixed;
    inset: 0;
    // below element-plus overlays / poppers (z-index starts at 2000)
    z-index: 1000;
    padding: 16px 20px 0;
  }
  &__toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    // room for the 过滤 count badge
    padding-top: 8px;
    padding-bottom: 8px;
    .el-button + .el-button {
      margin-left: 0;
    }
  }
  &__search {
    width: 280px;
  }
  // right-aligned group that wraps as a unit on narrow windows
  &__tools {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-left: auto;
    .el-button + .el-button {
      margin-left: 0;
    }
  }
  &__conditions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding-bottom: 8px;
  }
  &__footer {
    display: flex;
    justify-content: flex-end;
    padding: 10px 0;
    // wrap instead of clipping on narrow windows
    :deep(.el-pagination) {
      flex-wrap: wrap;
      justify-content: flex-end;
      row-gap: 6px;
    }
  }
  &__batch {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    padding: 6px 12px;
    margin-bottom: 8px;
    border-radius: 4px;
    font-size: 13px;
    background: var(--el-color-primary-light-9);
    .el-button + .el-button {
      margin-left: 0;
    }
  }
}
</style>
