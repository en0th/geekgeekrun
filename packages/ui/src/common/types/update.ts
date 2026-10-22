export interface NewReleaseInfo {
  releaseVersion: string
  releasePageUrl: string
  assetUrl: string
  assetName: string
  releaseNote: string
}

export interface UpdateSettings {
  autoCheck: boolean
  ignoredVersions: string[]
}
