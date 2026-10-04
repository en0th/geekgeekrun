<template>
  <div class="h-screen flex flex-col flex-items-center flex-justify-center">
    <div>
      <img
        class="block"
        :class="{
          'animate__animated animate__bounce animate__repeat-3': stage !== 'choose'
        }"
        :width="stage === 'choose' ? 128 : 256"
        src="@renderer/../../../resources/icon.png"
      />
    </div>
    <div v-if="stage !== 'choose'" mt24px>
      {{ stage === 'checking' ? '正在检查BOSS直聘登录状态…' : '愿你薪想事成' }}
    </div>

    <section v-else class="login-choice" role="alertdialog" aria-labelledby="login-choice-title">
      <h2 id="login-choice-title" class="login-choice__title">{{ choiceTitle }}</h2>
      <ElAlert
        :type="
          login.status === 'missing' ? 'info' : login.status === 'unknown' ? 'warning' : 'error'
        "
        :closable="false"
        show-icon
        :title="choiceMessage"
      />
      <p class="login-choice__hint">
        不登录也可以先进入软件查看资料、修改设置；开始自动打招呼、消息跟进或检查收藏职位前需要先登录。
      </p>
      <div class="login-choice__actions">
        <ElButton @click="enter">暂不登录，先进入软件</ElButton>
        <ElButton v-if="login.status === 'unknown'" :loading="checking" @click="check">
          重新检查
        </ElButton>
        <ElButton type="primary" :loading="loggingIn" @click="goLogin">
          {{ login.status === 'missing' ? '去登录' : '重新登录' }}
        </ElButton>
      </div>
    </section>
  </div>
</template>

<script lang="ts" setup>
import { useRouter } from 'vue-router'
import { computed, onMounted, ref } from 'vue'
import { ElAlert, ElButton, ElMessage } from 'element-plus'
import { sleep } from '@geekgeekrun/utils/sleep.mjs'
import { gtagRenderer } from '@renderer/utils/gtag'

const router = useRouter()

type LoginStatus = 'missing' | 'valid' | 'invalid' | 'unknown'
const stage = ref<'splash' | 'checking' | 'choose'>('splash')
const login = ref<{ status: LoginStatus; detail: string }>({ status: 'missing', detail: '' })
const checking = ref(false)
const loggingIn = ref(false)

const choiceTitle = computed(
  () =>
    ({
      missing: '还没有登录BOSS直聘',
      invalid: 'BOSS直聘登录已失效',
      unknown: '暂时无法确认BOSS直聘登录状态',
      valid: ''
    })[login.value.status]
)
const choiceMessage = computed(() =>
  login.value.status === 'missing'
    ? '本机没有保存BOSS直聘的登录凭证。'
    : login.value.status === 'invalid'
      ? `已保存的登录凭证无法使用：${login.value.detail}`
      : login.value.detail || '检查登录状态时出现异常。'
)

function enter() {
  router.replace('/main-layout')
}

async function check() {
  checking.value = true
  try {
    login.value = (await electron.ipcRenderer.invoke('boss-login-status')) as {
      status: LoginStatus
      detail: string
    }
  } catch (err) {
    login.value = { status: 'unknown', detail: '检查登录状态失败：' + (err as Error)?.message }
  } finally {
    checking.value = false
  }
  gtagRenderer('startup_login_checked', { status: login.value.status })
  if (login.value.status === 'valid') {
    ElMessage.success({ message: 'BOSS直聘登录状态正常', duration: 4000 })
    enter()
    return
  }
  stage.value = 'choose'
}

async function goLogin() {
  loggingIn.value = true
  try {
    await electron.ipcRenderer.invoke('login-with-cookie-assistant')
  } catch {
    // closed without saving: stay on the choice
    return
  } finally {
    loggingIn.value = false
  }
  // a freshly saved login is tested the same way
  await check()
}

onMounted(async () => {
  gtagRenderer('bootstrap_mounted')
  await sleep(1500)
  try {
    await electron.ipcRenderer.invoke('pre-enter-setting-ui')
  } catch (err) {
    console.log('pre-enter-setting-ui error', err)
  }
  stage.value = 'checking'
  await check()
})
</script>

<style scoped lang="scss">
.login-choice {
  width: min(460px, calc(100vw - 32px));
  margin-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.login-choice__title {
  margin: 0;
  font-size: 18px;
  text-align: center;
}
.login-choice__hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
.login-choice__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  .el-button + .el-button {
    margin-left: 0;
  }
}
</style>
