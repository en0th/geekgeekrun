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

// auto-greeting run modes: 'chat' starts conversations; 'collect' only saves job details
export const RUN_MODES = ['chat', 'collect']
export const DEFAULT_RUN_MODE = 'chat'
export const DEFAULT_COLLECT_ONLY_MATCHING_JOBS = true

export function readRunSettings(bossConfig = {}) {
  return {
    runMode: RUN_MODES.includes(bossConfig.autoChatRunMode) ? bossConfig.autoChatRunMode : DEFAULT_RUN_MODE,
    collectOnlyMatchingJobs:
      typeof bossConfig.collectOnlyMatchingJobs === 'boolean'
        ? bossConfig.collectOnlyMatchingJobs
        : DEFAULT_COLLECT_ONLY_MATCHING_JOBS,
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

// polling favourited jobs for closed / deleted status (a queued task, see jobStatusPollMain)
export const JOB_STATUS_POLL_INTERVAL_HOURS = [2, 6, 12, 24]
export const DEFAULT_JOB_STATUS_POLL = { enabled: true, intervalHours: 6 }

// kept in its own storage file: boss.json changes would discard the settings page draft
export const JOB_STATUS_POLL_SETTINGS_FILE = 'job-status-poll-settings.json'

export function readJobStatusPollSettings(saved) {
  saved = saved && typeof saved === 'object' ? saved : {}
  return {
    enabled: typeof saved.enabled === 'boolean' ? saved.enabled : DEFAULT_JOB_STATUS_POLL.enabled,
    intervalHours: JOB_STATUS_POLL_INTERVAL_HOURS.includes(saved.intervalHours)
      ? saved.intervalHours
      : DEFAULT_JOB_STATUS_POLL.intervalHours
  }
}

// Run pace shared by every configuration that ticks "使用全局运行节奏" (config/run-pace.json).
// Same keys as the settings page draft: a timed rest every `actions` operations for `minutes`,
// and the waits after loading a list batch / opening a job detail.
export const RUN_PACE_FILE = 'run-pace.json'
export const DEFAULT_RUN_PACE = {
  pause: true,
  actions: 100,
  minutes: 15,
  jobListLoadWaitSeconds: DEFAULT_JOB_LIST_LOAD_WAIT_SECONDS,
  jobDetailViewWaitSeconds: DEFAULT_JOB_DETAIL_VIEW_WAIT_SECONDS
}

export function readRunPace(saved) {
  saved = saved && typeof saved === 'object' ? saved : {}
  const d = DEFAULT_RUN_PACE
  const actions = Number(saved.actions)
  const minutes = Number(saved.minutes)
  return {
    pause: typeof saved.pause === 'boolean' ? saved.pause : d.pause,
    actions: Number.isInteger(actions) && actions >= 1 ? actions : d.actions,
    minutes: Number.isFinite(minutes) && minutes >= 0 ? minutes : d.minutes,
    jobListLoadWaitSeconds: waitSeconds(saved.jobListLoadWaitSeconds, d.jobListLoadWaitSeconds),
    jobDetailViewWaitSeconds: waitSeconds(saved.jobDetailViewWaitSeconds, d.jobDetailViewWaitSeconds)
  }
}

/** the pace an existing boss.json uses, as the starting point of the global setting */
export function runPaceFromBossConfig(bossConfig = {}) {
  return readRunPace({
    pause: typeof bossConfig.isSageTimeEnabled === 'boolean' ? bossConfig.isSageTimeEnabled : undefined,
    actions: bossConfig.sageTimeOpTimes,
    minutes: bossConfig.sageTimePauseMinute,
    jobListLoadWaitSeconds: bossConfig.jobListLoadWaitSeconds,
    jobDetailViewWaitSeconds: bossConfig.jobDetailViewWaitSeconds
  })
}
