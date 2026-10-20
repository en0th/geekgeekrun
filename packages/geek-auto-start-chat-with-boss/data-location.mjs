// Where the persistent data (database, login state, caches) lives. The default is
// <runtime folder>/storage; a user-chosen folder is recorded in data-location.json, which
// stays in the runtime folder so every process (UI, daemon, workers) resolves the same path.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { writeJsonAtomicSync } from '@geekgeekrun/utils/atomic-json.mjs'

export const runtimeFolderPath =
  process.env.GEEKGEEKRUN_RUNTIME_DIR || path.join(os.homedir(), '.geekgeekrun')
export const defaultStorageFolderPath = path.join(runtimeFolderPath, 'storage')
export const dataLocationFilePath = path.join(runtimeFolderPath, 'data-location.json')

export function readDataLocation() {
  try {
    const saved = JSON.parse(fs.readFileSync(dataLocationFilePath, 'utf8'))
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) || typeof saved.storageDir !== 'string' ||
      (saved.storageDir.trim() && !path.isAbsolute(saved.storageDir.trim()))) throw new Error('Invalid data location')
    const storageDir = typeof saved?.storageDir === 'string' ? saved.storageDir.trim() : ''
    return { storageDir: storageDir && path.isAbsolute(storageDir) ? path.normalize(storageDir) : '' }
  } catch (error) {
    if (error.code === 'ENOENT') return { storageDir: '' }
    throw Object.assign(new Error('无法读取 data-location.json；原文件已保留，请修正或从备份恢复，未切换数据目录'), { code: 'GGR_DATA_LOCATION_INVALID' })
  }
}

/**
 * The folder in use. A custom folder that has gone missing (e.g. an unplugged drive) falls
 * back to the default one, and `fallbackFrom` says so, rather than silently creating an
 * empty folder in its place.
 */
export function resolveStorageFolder() {
  const { storageDir } = readDataLocation()
  if (!storageDir || storageDir === defaultStorageFolderPath) {
    return { path: defaultStorageFolderPath, custom: false, fallbackFrom: null }
  }
  if (fs.existsSync(storageDir)) {
    return { path: storageDir, custom: true, fallbackFrom: null }
  }
  return { path: defaultStorageFolderPath, custom: false, fallbackFrom: storageDir }
}

export function writeDataLocation(storageDir) {
  if (storageDir && (typeof storageDir !== 'string' || !path.isAbsolute(storageDir))) throw new Error('数据目录必须是完整路径')
  fs.mkdirSync(runtimeFolderPath, { recursive: true })
  const value = !storageDir || path.normalize(storageDir) === defaultStorageFolderPath ? '' : path.normalize(storageDir)
  writeJsonAtomicSync(dataLocationFilePath, { storageDir: value })
}

// files that belong to one run of the app and must not be carried to a new folder
export const NON_PORTABLE_STORAGE_FILES = ['ipc-pipe-name']
