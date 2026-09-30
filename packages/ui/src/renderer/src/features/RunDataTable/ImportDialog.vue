<template>
  <ElDialog
    :model-value="visible"
    :title="`导入到「${datasetDef.label}」`"
    width="760px"
    append-to-body
    :close-on-click-modal="!importing"
    :close-on-press-escape="!importing"
    :show-close="!importing"
    @update:model-value="emit('update:visible', $event)"
    @closed="resetState"
  >
    <ElAlert type="warning" :closable="false" show-icon class="mb12px">
      <template #title>导入会直接写入本地数据库</template>
      <div class="text-12px leading-18px">
        <div v-if="isLog">
          · 以 {{ keyDescription }} 识别同一条记录：已存在的记录会跳过，不存在的会新增。
        </div>
        <div v-else>
          · 以 {{ keyDescription }}
          识别同一条记录：已存在的记录只更新文件中有值且有变化的字段，不存在的会新增。
        </div>
        <div v-if="isLog">
          · 记录中带有的职位 / BOSS / 公司信息仅在库中不存在时补充，不会覆盖已有信息。
        </div>
        <div>
          · 支持本程序导出的 .xlsx / .csv / .json
          文件，表头可以是中文列名或字段名。建议导入前先导出一份备份。
        </div>
      </div>
    </ElAlert>

    <template v-if="!parsed">
      <div
        class="import-dialog__drop"
        :class="{ 'is-dragover': dragover }"
        @click="fileInputEl?.click()"
        @dragover.prevent="dragover = true"
        @dragleave.prevent="dragover = false"
        @drop.prevent="handleDrop"
      >
        <ElIcon :size="32"><UploadFilled /></ElIcon>
        <div class="mt8px">点击选择文件，或将文件拖到此处</div>
        <div class="text-12px color-#909399 mt4px">.xlsx / .xls / .csv / .json</div>
      </div>
      <input
        ref="fileInputEl"
        type="file"
        accept=".xlsx,.xls,.csv,.json"
        class="hidden"
        @change="handleFileChange"
      />
      <div v-if="parsing" class="text-center mt12px text-12px color-#909399">正在解析文件…</div>
    </template>

    <template v-else-if="!result">
      <div class="text-13px mb8px">
        文件 <strong>{{ parsed.fileName }}</strong> 共 <strong>{{ parsed.rows.length }}</strong> 行
      </div>
      <div class="text-12px mb4px">已识别的列（{{ parsed.mappedFields.length }}）：</div>
      <div class="flex flex-wrap gap-4px mb8px">
        <ElTag
          v-for="f in parsed.mappedFields"
          :key="f.key"
          size="small"
          :type="requiredFields.includes(f.key) ? 'success' : 'info'"
          >{{ f.label }}</ElTag
        >
      </div>
      <div v-if="parsed.unknownHeaders.length" class="text-12px mb8px color-#e6a23c">
        将被忽略的列：{{ parsed.unknownHeaders.join('、') }}
      </div>
      <ElAlert
        v-if="missingRequired.length"
        type="error"
        :closable="false"
        class="mb8px"
        :title="`缺少必需的列：${missingRequired.join('、')}，无法导入`"
      />
      <div v-else-if="incompleteRowCount" class="text-12px mb8px color-#e6a23c">
        有 {{ incompleteRowCount }} 行缺少{{ requiredLabels }}，这些行将被跳过
      </div>
      <ElTable :data="parsed.rows.slice(0, 5)" size="small" border max-height="220">
        <ElTableColumn
          v-for="f in parsed.mappedFields"
          :key="f.key"
          :label="f.label"
          min-width="110"
          show-overflow-tooltip
        >
          <template #default="{ row }">{{ previewValue(f, row[f.key]) }}</template>
        </ElTableColumn>
      </ElTable>
      <div class="text-12px color-#909399 mt4px">仅预览前 5 行</div>
      <ElProgress v-if="importing" :percentage="progress" class="mt12px" />
    </template>

    <template v-else>
      <ElResult
        :icon="result.errors.length ? 'warning' : 'success'"
        :title="result.errors.length ? '导入完成，部分行未导入' : '导入完成'"
      >
        <template #sub-title>
          共 {{ result.total }} 行：新增 {{ result.inserted }}，更新 {{ result.updated }}，跳过
          {{ result.skipped }}
        </template>
      </ElResult>
      <ElTable
        v-if="result.errors.length"
        :data="result.errors"
        size="small"
        border
        max-height="200"
      >
        <ElTableColumn prop="row" label="文件行号" width="90" />
        <ElTableColumn prop="message" label="原因" />
      </ElTable>
    </template>

    <template #footer>
      <template v-if="result">
        <ElButton type="primary" @click="emit('update:visible', false)">完成</ElButton>
      </template>
      <template v-else-if="parsed">
        <ElButton :disabled="importing" @click="resetState">重新选择</ElButton>
        <ElButton
          type="primary"
          :loading="importing"
          :disabled="!parsed.rows.length || missingRequired.length > 0"
          @click="handleImport"
          >导入 {{ parsed.rows.length }} 行</ElButton
        >
      </template>
      <ElButton v-else @click="emit('update:visible', false)">取消</ElButton>
    </template>
  </ElDialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ElAlert,
  ElButton,
  ElDialog,
  ElIcon,
  ElMessage,
  ElProgress,
  ElResult,
  ElTable,
  ElTableColumn,
  ElTag
} from 'element-plus'
import { UploadFilled } from '@element-plus/icons-vue'
import {
  runDataDatasets,
  type RunDataDatasetKey,
  type RunDataField,
  type RunDataImportRes
} from '../../../../common/run-data'
import { parseImportFile, type ParsedImport } from './io'
import { formatFieldValue } from './format'

const CHUNK_SIZE = 2000

const props = defineProps<{ visible: boolean; dataset: RunDataDatasetKey }>()
const emit = defineEmits<{
  'update:visible': [value: boolean]
  imported: [result: RunDataImportRes]
}>()

const datasetDef = computed(() => runDataDatasets[props.dataset])
const isLog = computed(() => ['chatStartupLog', 'markAsNotSuitLog'].includes(props.dataset))
const requiredFields = computed(() =>
  isLog.value ? ['encryptJobId', 'date'] : [datasetDef.value.rowKey]
)
const labelOf = (key: string) => datasetDef.value.fields.find((f) => f.key === key)?.label ?? key
const keyDescription = computed(() =>
  requiredFields.value.map((k) => `「${labelOf(k)}」`).join(' + ')
)

const fileInputEl = ref<HTMLInputElement>()
const dragover = ref(false)
const parsing = ref(false)
const parsed = ref<ParsedImport | null>(null)
const importing = ref(false)
const progress = ref(0)
const result = ref<RunDataImportRes | null>(null)

const missingRequired = computed(() =>
  parsed.value
    ? requiredFields.value
        .filter((k) => !parsed.value!.mappedFields.some((f) => f.key === k))
        .map(labelOf)
    : []
)

const requiredLabels = computed(() => requiredFields.value.map(labelOf).join(' / '))
const incompleteRowCount = computed(
  () =>
    parsed.value?.rows.filter((row) =>
      requiredFields.value.some((k) => row[k] === null || row[k] === undefined || row[k] === '')
    ).length ?? 0
)

const previewValue = (f: RunDataField, v: unknown) => formatFieldValue(f, v)

async function handleFile(file?: File | null) {
  if (!file) return
  parsing.value = true
  try {
    parsed.value = await parseImportFile(props.dataset, file)
  } catch (err) {
    ElMessage.error(`解析文件失败：${(err as Error)?.message ?? err}`)
  } finally {
    parsing.value = false
  }
}
function handleFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  handleFile(input.files?.[0])
  input.value = ''
}
function handleDrop(e: DragEvent) {
  dragover.value = false
  handleFile(e.dataTransfer?.files?.[0])
}

async function handleImport() {
  if (!parsed.value) return
  const rows = parsed.value.rows
  const total: RunDataImportRes = {
    total: rows.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: []
  }
  importing.value = true
  progress.value = 0
  try {
    // chunked so progress can be shown; each chunk is its own transaction
    for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
      const { data } = (await electron.ipcRenderer.invoke('run-data-import', {
        dataset: props.dataset,
        rows: JSON.parse(JSON.stringify(rows.slice(offset, offset + CHUNK_SIZE)))
      })) as { data: RunDataImportRes }
      total.inserted += data.inserted
      total.updated += data.updated
      total.skipped += data.skipped
      total.errors.push(...data.errors.map((e) => ({ ...e, row: e.row + offset })))
      progress.value = Math.round((Math.min(offset + CHUNK_SIZE, rows.length) / rows.length) * 100)
    }
    result.value = total
    emit('imported', total)
  } catch (err) {
    ElMessage.error(`导入失败：${(err as Error)?.message ?? err}`)
    if (total.inserted || total.updated) {
      // earlier chunks were committed
      result.value = total
      emit('imported', total)
    }
  } finally {
    importing.value = false
  }
}

function resetState() {
  parsed.value = null
  result.value = null
  progress.value = 0
}
</script>

<style scoped lang="scss">
.import-dialog__drop {
  border: 1px dashed var(--el-border-color);
  border-radius: 6px;
  padding: 32px 16px;
  text-align: center;
  cursor: pointer;
  color: var(--el-text-color-regular);
  transition: border-color 0.2s;
  &:hover,
  &.is-dragover {
    border-color: var(--el-color-primary);
    color: var(--el-color-primary);
  }
}
</style>
