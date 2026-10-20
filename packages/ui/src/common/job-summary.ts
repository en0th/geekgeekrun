export interface JobSummaryTerm {
  term: string
  jobs: number
  percent: number
}

export interface JobSummary {
  totalJobs: number
  sampledJobs: number
  sampleLimit: number
  withDescription: number
  missingDescription: number
  truncatedDescriptions: number
  firstSeenFrom: string | null
  firstSeenTo: string | null
  unknownFirstSeen: number
  origins: { capture: number; import: number; legacy: number }
  skills: JobSummaryTerm[]
  terms: JobSummaryTerm[]
}
