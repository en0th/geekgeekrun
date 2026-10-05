// The release notes shipped inside the app (packages/ui/src/common/release-notes.json), so the
// version number in the navigation can show them without asking GitHub.
import fs from 'node:fs'

export const RELEASE_NOTES_JSON = 'packages/ui/src/common/release-notes.json'

/** the file's entries, newest version first */
export function readReleaseNotesFile(file = RELEASE_NOTES_JSON) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch {
    return {}
  }
}

/** adds (or replaces) one version, keeping the newest first */
export function withReleaseNotes(entries, version, { notes, date, draft = false }) {
  const rest = Object.entries(entries).filter(([v]) => v !== version)
  return Object.fromEntries([[version, { date, draft, notes }], ...rest])
}

export function writeReleaseNotesFile(version, fields, file = RELEASE_NOTES_JSON) {
  const next = withReleaseNotes(readReleaseNotesFile(file), version, fields)
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n')
}
