export type PrerequisiteStatus = 'todo' | 'pending' | 'fulfilled' | 'rejected'

export interface PrerequisiteStep {
  id: string
  describe: string
  status?: PrerequisiteStatus
}

export interface RunningTask {
  workerId: string
  args?: string[]
  command?: string
  pid?: number
  startedAt?: number
  runtimeStorage?: {
    stepStatusMapByStepId?: Record<string, {
      runRecordId?: number | null
      step: Pick<PrerequisiteStep, 'id' | 'status'>
    }>
    screenshot?: string
    screenshotAt?: number
    pageUrl?: string | null
    progress?: Record<string, unknown>
  }
}
