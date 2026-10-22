export const UPDATE_SETTINGS_FILE = 'update.json'
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000

export function normalizeUpdateVersion(value) {
  if (typeof value !== 'string') return ''
  const version = value.trim().replace(/^(?:ui-v|v)/, '')
  return version.length <= 100 && /^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/.test(version) ? version : ''
}

export function readUpdateSettings(saved) {
  if (saved == null) return { autoCheck: true, ignoredVersions: [] }
  if (typeof saved !== 'object' || Array.isArray(saved) ||
    (saved.autoCheck !== undefined && typeof saved.autoCheck !== 'boolean') ||
    (saved.ignoredVersions !== undefined && (!Array.isArray(saved.ignoredVersions) ||
      saved.ignoredVersions.some(version => !normalizeUpdateVersion(version)))))
    throw new Error('更新设置格式无效，请检查 update.json')
  return {
    autoCheck: saved.autoCheck ?? true,
    ignoredVersions: [...new Set((saved.ignoredVersions ?? []).map(normalizeUpdateVersion))].slice(-50),
  }
}
