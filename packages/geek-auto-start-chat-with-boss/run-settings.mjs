// User-adjustable run settings shared by the auto-chat run and the settings UI.

// 兼职、日结、实习 etc. have salaries that can't be parsed; skipped unless the user opts in
export const DEFAULT_SKIP_UNPARSEABLE_SALARY_JOB = true

// pace between actions; lower values run faster but make BOSS rate limiting more likely
export const DEFAULT_JOB_LIST_LOAD_WAIT_SECONDS = 5
export const DEFAULT_JOB_DETAIL_VIEW_WAIT_SECONDS = 2
export const MAX_WAIT_SECONDS = 600

export function waitSeconds(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.min(n, MAX_WAIT_SECONDS) : fallback
}

export function readRunSettings(bossConfig = {}) {
  return {
    skipUnparseableSalaryJob:
      typeof bossConfig.skipUnparseableSalaryJob === 'boolean'
        ? bossConfig.skipUnparseableSalaryJob
        : DEFAULT_SKIP_UNPARSEABLE_SALARY_JOB,
    jobListLoadWaitSeconds: waitSeconds(
      bossConfig.jobListLoadWaitSeconds,
      DEFAULT_JOB_LIST_LOAD_WAIT_SECONDS
    ),
    jobDetailViewWaitSeconds: waitSeconds(
      bossConfig.jobDetailViewWaitSeconds,
      DEFAULT_JOB_DETAIL_VIEW_WAIT_SECONDS
    )
  }
}
