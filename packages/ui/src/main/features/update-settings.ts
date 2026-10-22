import { EventEmitter } from 'node:events'
import semver from 'semver'
import { readConfigFile, writeConfigFile } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { UPDATE_SETTINGS_FILE, normalizeUpdateVersion, readUpdateSettings } from '../../common/update-settings.mjs'
import type { UpdateSettings } from '../../common/types/update'

export const updateSettingsEvents = new EventEmitter()
let mutations: Promise<unknown> = Promise.resolve()
const read = (): UpdateSettings => readUpdateSettings(readConfigFile(UPDATE_SETTINGS_FILE))

export async function getUpdateSettings(): Promise<UpdateSettings> {
  await mutations
  return read()
}

function changeSettings(change: (previous: UpdateSettings) => UpdateSettings) {
  const operation = mutations.then(async () => {
    const previous = read()
    const next = readUpdateSettings(change(previous))
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      await writeConfigFile(UPDATE_SETTINGS_FILE, next)
      updateSettingsEvents.emit('changed', next)
    }
    return next
  })
  mutations = operation.catch(() => {})
  return operation
}

export function setUpdateAutoCheck(enabled: unknown) {
  if (typeof enabled !== 'boolean') throw new Error('自动检测更新设置无效')
  return changeSettings(previous => ({ ...previous, autoCheck: enabled }))
}

export function ignoreUpdateVersion(value: unknown) {
  const version = normalizeUpdateVersion(value)
  if (!semver.valid(version)) throw new Error('要忽略的版本号无效')
  return changeSettings(previous => ({ ...previous,
    ignoredVersions: [...previous.ignoredVersions.filter(item => item !== version), version].slice(-50),
  }))
}

export function restoreIgnoredUpdateVersions() {
  return changeSettings(previous => ({ ...previous, ignoredVersions: [] }))
}
