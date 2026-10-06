// 资料库 → 打招呼: one job, started by the user. The BOSS browser opens the job page and presses
// 立即沟通 once; a successful chat is recorded as a manual one in 求职记录.
import { h } from 'vue'
import { ElMessageBox } from 'element-plus'
import { toast } from './Toast'
import { formatDbDate } from './RunDataTable/format'

export interface GreetableJob {
  encryptJobId: string
  companyName?: string | null
  jobName?: string | null
  bossName?: string | null
  chattedAt?: string | null
}

type GreetResult = {
  status: 'sent' | 'already' | 'confirm-in-browser' | 'closed' | 'missing' | 'login' | 'failed'
  message?: string
}

const jobLabel = (job: GreetableJob) =>
  (job.companyName && job.jobName
    ? `${job.companyName}「${job.jobName}」`
    : job.companyName || job.jobName) || job.encryptJobId

/** true when BOSS confirmed the chat */
export async function greetJobManually(job: GreetableJob): Promise<boolean> {
  const label = jobLabel(job)
  try {
    await ElMessageBox.confirm(
      h('div', [
        h(
          'p',
          { class: 'm-0' },
          `将在BOSS中打开「${label}」并点击“立即沟通”，向${job.bossName || '招聘者'}发送打招呼消息。`
        ),
        job.chattedAt
          ? h(
              'p',
              { class: 'm-0 mt6px color-#e6a23c' },
              `已于 ${formatDbDate(job.chattedAt)} 开聊过；BOSS显示“继续沟通”时不会重复发送。`
            )
          : null,
        h(
          'p',
          { class: 'm-0 mt6px text-12px color-#909399' },
          '打招呼语使用你在BOSS中设置的招呼语；页面会保持打开，方便继续沟通。'
        )
      ]),
      '手动打招呼',
      { type: 'info', confirmButtonText: '打招呼', cancelButtonText: '取消' }
    )
  } catch {
    return false
  }
  const pending = toast.info({
    title: '正在打招呼',
    message: `正在BOSS中打开「${label}」…`,
    duration: 90 * 1000
  })
  let result: GreetResult
  try {
    result = (await electron.ipcRenderer.invoke('greet-job-manually', {
      encryptJobId: job.encryptJobId
    })) as GreetResult
  } catch (err) {
    result = { status: 'failed', message: String((err as Error)?.message ?? err) }
  } finally {
    pending.close()
  }
  const detail = result.message ? `：${result.message}` : ''
  switch (result.status) {
    case 'sent':
      toast.success({ title: '已打招呼', message: `已向「${label}」打招呼，已记入求职记录。` })
      return true
    case 'already':
      toast.info({
        title: '已经沟通过',
        message: `「${label}」显示“继续沟通”，没有重复发送。`
      })
      return false
    case 'confirm-in-browser':
      toast.warning({
        title: '需要在浏览器中确认',
        message: `BOSS提示${detail || '需要二次确认'}。请在打开的页面中决定是否继续，确认后会自动记录。`
      })
      return false
    case 'closed':
      toast.warning({ title: '职位已关闭', message: `「${label}」已关闭，无法打招呼。` })
      return false
    case 'missing':
      toast.warning({ title: '职位不存在', message: `「${label}」已被删除或下线。` })
      return false
    case 'login':
      toast.error({
        title: 'BOSS登录已失效',
        message: '请在“设置 → 账号与登录”中重新登录后再试。'
      })
      return false
    default:
      toast.error({
        title: '打招呼未完成',
        message: `「${label}」${detail || '，请在打开的页面中查看'}`
      })
      return false
  }
}
