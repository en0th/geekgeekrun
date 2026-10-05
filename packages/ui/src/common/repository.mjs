// The repository this build comes from: project page, issues, releases and update checks.
export const REPOSITORY = 'en0th/geekgeekrun'
export const REPOSITORY_URL = `https://github.com/${REPOSITORY}`
export const ISSUE_NEW_URL = `${REPOSITORY_URL}/issues/new`
export const RELEASES_URL = `${REPOSITORY_URL}/releases`
export const RELEASES_API_URL = `https://api.github.com/repos/${REPOSITORY}/releases`
// UI releases are tagged ui-v<version>
export const releaseTag = (version) => `ui-v${version}`
