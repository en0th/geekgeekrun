// Reads a job's hiring status from the HTML of its BOSS job detail page
// (https://www.zhipin.com/job_detail/{encryptJobId}.html).
import cheerio from 'cheerio'
import { JobHireStatus } from '@geekgeekrun/sqlite-plugin/dist/enums'

// storage file with the summary of the last finished poll round
export const JOB_STATUS_POLL_LAST_RUN_FILE = 'job-status-poll-last-run.json'

/** null when the page doesn't tell (blocked, verification, not loaded yet). */
export function parseJobDetailStatus(html: string): JobHireStatus | null {
  if (!html) return null
  const $ = cheerio.load(html)
  const banner = $('#main .job-banner')
  if (!banner.length) {
    return html.includes('您访问的页面不存在') ? JobHireStatus.DELETED : null
  }
  const statusText = banner.find('.job-status').first().text().trim()
  if (statusText === '职位已关闭') return JobHireStatus.CLOSED
  // an open job's banner shows its details; without a status label it is still hiring
  return JobHireStatus.HIRING
}

export const jobHireStatusLabel: Record<number, string> = {
  [JobHireStatus.HIRING]: '招聘中',
  [JobHireStatus.CLOSED]: '已关闭',
  [JobHireStatus.DELETED]: '已删除'
}
