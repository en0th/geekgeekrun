import atomic from './atomic-file.cjs'

export const { writeFileAtomicSync, writeJsonAtomicSync, writeFilesAtomicSync } = atomic
// The critical section is synchronous: invocation order is also commit order within
// a process, including calls mixing the async API and exit-time synchronous writes.
export async function writeJsonAtomic(file, value, options) { return writeJsonAtomicSync(file, value, options) }
export async function writeFileAtomic(file, value, options) { return writeFileAtomicSync(file, value, options) }
export const isJsonStorageError = error => ['GGR_JSON_INVALID', 'GGR_FILE_READ_FAILED', 'GGR_FILE_WRITE_FAILED', 'GGR_DATA_LOCATION_INVALID'].includes(error?.code)
