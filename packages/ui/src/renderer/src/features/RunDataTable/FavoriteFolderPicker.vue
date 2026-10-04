<template>
  <ElDialog
    :model-value="visible"
    title="收藏到收藏夹"
    width="420px"
    append-to-body
    @update:model-value="(v) => emit('update:visible', v)"
    @open="load"
  >
    <p class="m-0 mb10px">
      将选中的
      <strong>{{ jobIds.length }}</strong> 个职位加入收藏夹。已收藏的职位会被定期检查是否已关闭。
    </p>
    <div v-loading="loading" class="favorite-picker__list">
      <ElRadioGroup v-model="folderId" class="favorite-picker__radios">
        <ElRadio v-for="f in folders" :key="f.id" :value="f.id">
          {{ f.name }}<span class="favorite-picker__count">（{{ f.jobCount }}）</span>
        </ElRadio>
      </ElRadioGroup>
      <p v-if="!loading && !folders.length" class="m-0 color-#909399">
        还没有收藏夹，请先新建一个。
      </p>
    </div>
    <div class="favorite-picker__create">
      <ElInput
        v-model="newName"
        size="small"
        maxlength="30"
        placeholder="新收藏夹名称"
        @keydown.enter="createFolder"
      />
      <ElButton size="small" :loading="creating" :disabled="!newName.trim()" @click="createFolder"
        >新建</ElButton
      >
    </div>
    <template #footer>
      <ElButton @click="emit('update:visible', false)">取消</ElButton>
      <ElButton type="primary" :loading="saving" :disabled="!folderId" @click="save">收藏</ElButton>
    </template>
  </ElDialog>
</template>

<script setup lang="ts">
import { toast } from '@renderer/features/Toast'
import { ref } from 'vue'
import { ElButton, ElDialog, ElInput, ElRadio, ElRadioGroup } from 'element-plus'
import { ipcErrorMessage } from './format'

interface FavoriteFolder {
  id: number
  name: string
  jobCount: number
}

const props = defineProps<{ visible: boolean; jobIds: string[] }>()
const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'saved'): void
}>()

const folders = ref<FavoriteFolder[]>([])
const folderId = ref<number | undefined>()
const loading = ref(false)
const newName = ref('')
const creating = ref(false)
const saving = ref(false)

async function load() {
  loading.value = true
  try {
    const { data } = (await electron.ipcRenderer.invoke('favorite-folders')) as {
      data: FavoriteFolder[]
    }
    folders.value = data
    if (!folders.value.some((f) => f.id === folderId.value)) folderId.value = data[0]?.id
  } catch (err) {
    toast.error(`读取收藏夹失败：${ipcErrorMessage(err)}`)
  } finally {
    loading.value = false
  }
}

async function createFolder() {
  if (!newName.value.trim() || creating.value) return
  creating.value = true
  try {
    const { data } = (await electron.ipcRenderer.invoke('favorite-folder-create', {
      name: newName.value
    })) as { data: { id: number } }
    newName.value = ''
    await load()
    folderId.value = data.id
  } catch (err) {
    toast.error(ipcErrorMessage(err))
  } finally {
    creating.value = false
  }
}

async function save() {
  if (!folderId.value) return
  saving.value = true
  try {
    const { data } = (await electron.ipcRenderer.invoke('favorite-jobs-add', {
      folderId: folderId.value,
      jobIds: [...props.jobIds]
    })) as { data: { added: number; alreadySaved: number } }
    const folder = folders.value.find((f) => f.id === folderId.value)?.name
    toast.success(
      `已收藏 ${data.added} 个职位到“${folder}”` +
        (data.alreadySaved ? `，${data.alreadySaved} 个此前已在该收藏夹中` : '')
    )
    emit('saved')
    emit('update:visible', false)
  } catch (err) {
    toast.error(`收藏失败：${ipcErrorMessage(err)}`)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped lang="scss">
.favorite-picker__list {
  max-height: 240px;
  min-height: 40px;
  overflow: auto;
}
.favorite-picker__radios {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.favorite-picker__count {
  color: var(--el-text-color-secondary);
}
.favorite-picker__create {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
</style>
