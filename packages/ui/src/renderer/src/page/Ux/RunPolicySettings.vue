<script setup lang="ts">
import { reactive, ref, computed, watch, defineComponent, h } from 'vue'
import { ElRadioGroup, ElRadioButton, ElSwitch, ElInput, ElInputNumber, ElButton, ElPopover, ElIcon } from 'element-plus'
import { QuestionFilled, WarningFilled } from '@element-plus/icons-vue'
import { normalizeRunPolicy, dailyTargetError } from '@geekgeekrun/geek-auto-start-chat-with-boss/run-policy.mjs'
import { runProfileHelp } from '../../../../common/run-profile-help.mjs'
const props = defineProps({ policy: Object, daily: Object, saving: Boolean })
const emit = defineEmits(['save', 'acknowledge-daily'])
const form = reactive(normalizeRunPolicy(props.policy)), error = reactive({ text: '' })
const dailyLimitText = ref(String(form.dailyLimit)), dailyTouched = ref(false), dailyInput = ref<InstanceType<typeof ElInput>>()
const dailyError = computed(() => dailyTargetError(dailyLimitText.value))
watch(() => props.policy, value => {
  if (!value) return
  Object.assign(form, normalizeRunPolicy(value))
  dailyLimitText.value = String(form.dailyLimit); dailyTouched.value = false
})
const profiles = [
  { key: 'safe', label: '安全模式', detail: '日常使用', recommended: true },
  { key: 'deep', label: '深度模式', detail: '多看一些岗位' },
  { key: 'fast', label: '极速模式', detail: '更快查找' },
]
const HelpTip = defineComponent({
  props: { label: { type: String, required: true }, text: { type: String, required: true }, multiline: Boolean },
  setup: p => {
    const visible = ref(false)
    return () => h(ElPopover, { visible: visible.value, 'onUpdate:visible': (value: boolean) => { visible.value = value }, trigger: 'click', width: p.multiline ? 360 : 320, placement: 'top-start', content: p.text, popperClass: p.multiline ? 'ux-settings-help ux-profile-help' : 'ux-settings-help' }, {
      reference: () => h('button', { type: 'button', class: 'ux-settings-help-trigger', 'aria-label': p.label + '说明', onKeydown: (event: KeyboardEvent) => {
        if (event.key === 'Escape') { visible.value = false; event.preventDefault(); event.stopPropagation() }
      } }, [h(ElIcon, () => h(QuestionFilled))]),
    })
  },
})
function save() {
  dailyTouched.value = true
  if (dailyError.value) { error.text = ''; dailyInput.value?.focus(); return }
  try { const value = normalizeRunPolicy({ ...form, dailyLimit: Number(dailyLimitText.value) }); error.text = ''; emit('save', value) }
  catch (e) { error.text = (e as Error).message }
}
</script>
<template>
  <section class="ux-card ux-run-policy" aria-label="找岗位运行偏好">
    <h2>找岗位运行偏好</h2>
    <div class="ux-policy-section">
      <h3>运行模式 <HelpTip label="运行模式" text="只影响找岗位。安全与深度的查找间隔相同，深度允许查看更多岗位；极速间隔更短。所有模式都保留运行保护，不会放宽筛选条件，也不保证免于平台验证。" /></h3>
      <ElRadioGroup v-model="form.profile" class="ux-profile-options" aria-label="找岗位运行模式">
        <div v-for="profile in profiles" :key="profile.key" class="ux-profile-option">
          <ElRadioButton :value="profile.key">
            <span class="ux-profile-title">{{ profile.label }}</span>
            <span class="ux-profile-detail">{{ profile.detail }}<span v-if="profile.recommended"> · 推荐</span></span>
          </ElRadioButton>
          <HelpTip :label="profile.label" :text="runProfileHelp(profile.key)" multiline />
        </div>
      </ElRadioGroup>
      <p v-if="form.profile === 'fast'" class="ux-policy-risk" role="note"><ElIcon><WarningFilled /></ElIcon>更容易触发平台风控 <HelpTip label="极速模式风险" text="可能出现验证码、限流或账号限制。极速模式仍保留运行保护，不能突破BOSS额度；如频繁遇到验证，建议改用安全模式。" /></p>
    </div>
    <div class="ux-policy-section">
      <div class="ux-policy-section-head">
        <h3>定时休息 <HelpTip label="定时休息" text="按连续运行时间休息，到时自动继续。休息结束仍会检查账号、登录及当日目标；平台额度或验证问题不会被跳过。" /></h3>
        <ElSwitch v-model="form.rest.enabled" aria-label="启用定时休息" />
      </div>
      <div v-if="form.rest.enabled" class="ux-policy-line">
        <label>每运行 <ElInputNumber v-model="form.rest.workMinutes" :min="1" :max="240" controls-position="right" aria-label="连续运行分钟" /> 分钟，</label>
        <label>休息 <ElInputNumber v-model="form.rest.restMinutes" :min="1" :max="120" controls-position="right" aria-label="休息分钟" /> 分钟</label>
      </div>
    </div>
    <div class="ux-policy-section">
      <h3>每日自动打招呼目标 <HelpTip label="每日自动打招呼" text="每个账号分别按北京时间当天累计，互不占用数量。两个账号目标各为150人时，合计最多300人。这里设置每个账号的默认目标，重启或新建任务不清零。达标后可为当前账号仅今天追加，单个账号最多150。只能统计本软件确认的发送，手机等入口无法准确读取；BOSS提示额度用尽会停止该账号。" /></h3>
      <div class="ux-policy-line"><label for="ux-daily-target">每个账号每天最多 <ElInput ref="dailyInput" id="ux-daily-target" v-model="dailyLimitText" class="ux-daily-target" :class="{ 'is-invalid': dailyTouched && dailyError }" inputmode="numeric" autocomplete="off" :disabled="saving || !policy" aria-label="每日自动打招呼人数" :aria-invalid="dailyTouched && dailyError ? 'true' : 'false'" :aria-describedby="dailyTouched && dailyError ? 'ux-daily-target-error' : undefined" @blur="dailyTouched = true" /> 人</label></div>
      <p v-if="dailyTouched && dailyError" id="ux-daily-target-error" role="alert" class="ux-policy-field-error">{{ dailyError }}</p>
      <div v-if="daily?.pendingCount" class="ux-policy-usage"><span>有 {{ daily.pendingCount }} 次发送待核对</span><ElButton @click="emit('acknowledge-daily')">去核对</ElButton></div>
      <p v-if="daily?.platformExhausted" role="alert" class="ux-policy-status">BOSS今日沟通额度已用尽，暂不能继续打招呼。</p>
    </div>
    <p v-if="error.text" role="alert" class="ux-policy-error">{{ error.text }}</p>
    <div class="ux-policy-save ux-settings-actions"><ElButton type="primary" :loading="saving" :disabled="!policy" title="模式和休息在下次提交任务时生效；每日人数在下一次开聊前检查。" @click="save">保存设置</ElButton></div>
  </section>
</template>
<style scoped>
.ux-policy-section { max-width: 680px; margin-top: 24px; }
.ux-policy-section h3 { margin: 0 0 12px; }
.ux-policy-section h3::before { display: none; }
.ux-policy-section-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.ux-policy-section-head h3 { margin: 0; }
.ux-profile-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); width: 100%; gap: 12px; }
.ux-profile-option { position: relative; min-width: 0; }
.ux-profile-option :deep(.el-radio-button) { width: 100%; }
.ux-profile-option :deep(.ux-settings-help-trigger) { position: absolute; top: 12px; right: 12px; font-size: var(--ggr-font-size-body); }
.ux-profile-options :deep(.el-radio-button__inner) { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; width: 100%; min-height: 76px; padding: 16px; border: 1px solid var(--el-border-color); border-radius: 8px; color: var(--el-text-color-primary); background: var(--el-bg-color); box-shadow: none; text-align: left; font-size: var(--ggr-font-size-body); }
.ux-profile-options :deep(.el-radio-button.is-active .el-radio-button__inner) { border-color: var(--el-color-primary); color: var(--el-color-primary); background: var(--el-color-primary-light-9); box-shadow: none; }
.ux-profile-options :deep(.el-radio-button__original-radio:focus-visible + .el-radio-button__inner) { outline: 2px solid var(--el-color-primary); outline-offset: 3px; }
.ux-profile-title { padding-right: 24px; font-weight: 600; }
.ux-profile-detail { color: var(--el-text-color-regular); font-size: var(--ggr-font-size-small); line-height: 1.5; }
.ux-policy-risk { display: flex; align-items: center; gap: 8px; margin: 12px 0 0; color: var(--el-color-danger); font-size: var(--ggr-font-size-body); line-height: 1.6; }
.ux-policy-line, .ux-policy-usage { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; }
.ux-policy-line label { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.ux-policy-line :deep(.el-input-number) { width: var(--ggr-number-input-width); }
.ux-daily-target { flex: 0 0 auto; width: var(--ggr-number-input-width); }
.ux-daily-target :deep(.el-input__inner) { text-align: center; font-variant-numeric: tabular-nums; }
.ux-daily-target.is-invalid :deep(.el-input__wrapper) { box-shadow: 0 0 0 1px var(--el-color-danger) inset; }
.ux-policy-field-error { margin: 8px 0 0; color: var(--el-color-danger); font-size: var(--ggr-font-size-body); line-height: 1.6; }
.ux-policy-usage { margin-top: 12px; gap: 8px; color: var(--el-text-color-secondary); }
.ux-policy-usage :deep(.el-button + .el-button) { margin-left: 0; }
.ux-policy-status { margin: 12px 0 0; color: var(--el-color-warning); }
.ux-policy-error { color: var(--el-color-danger); }
.ux-policy-save { margin-top: 24px; }
@media (max-width: 760px) { .ux-profile-options { gap: 8px; } .ux-profile-options :deep(.el-radio-button__inner) { padding: 12px; } }
</style>
