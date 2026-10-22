import semver from 'semver'
import packageJson from '../../../package.json'
import os from 'node:os'
import { BrowserWindow, ipcMain } from 'electron'
import { NewReleaseInfo } from '../../common/types/update'
import type { UpdateSettings } from '../../common/types/update'
import { RELEASES_API_URL } from '../../common/repository.mjs'
import { normalizeUpdateVersion } from '../../common/update-settings.mjs'
import { getUpdateSettings, ignoreUpdateVersion, restoreIgnoredUpdateVersions, setUpdateAutoCheck, updateSettingsEvents } from './update-settings'

export const currentOsPlatform = os.platform()
const RELEASE_LIST_URL = RELEASES_API_URL

export interface GitHubReleaseItem {
  tag_name: string
  prerelease: boolean
  draft: boolean
  html_url: string
  body: string
  assets: Array<{
    browser_download_url: string
    name: string
  }>
}

// find by arch, appendix
function findTargetAsset(
  assets: GitHubReleaseItem['assets']
): null | GitHubReleaseItem['assets'][number] {
  let assetsFilteredByPlatform: GitHubReleaseItem['assets'] = []
  switch (os.platform()) {
    case 'win32': {
      assetsFilteredByPlatform = assets.filter((it) => it.name.endsWith('.exe'))
      break
    }
    case 'darwin': {
      assetsFilteredByPlatform = assets.filter((it) => it.name.endsWith('.dmg'))
      break
    }
    case 'linux': {
      assetsFilteredByPlatform = assets.filter((it) => it.name.endsWith('.deb'))
      break
    }
  }
  if (!assetsFilteredByPlatform?.length) {
    return null
  }
  if (assetsFilteredByPlatform.length === 1) {
    return assetsFilteredByPlatform[0]
  }
  let targetAsset
  if (os.platform() === 'darwin') {
    targetAsset = assetsFilteredByPlatform.find((it) => it.name.includes(`_${os.arch()}`))
  }
  return targetAsset
}

const automaticChecks = new Set<AbortController>()
let automaticGeneration = 0
updateSettingsEvents.on('changed', (settings: UpdateSettings) => {
  if (!settings.autoCheck) {
    automaticGeneration++
    for (const controller of automaticChecks) controller.abort()
  }
})

export const checkUpdateForUi = async ({ manual = false } = {}): Promise<NewReleaseInfo | null> => {
  const generation = automaticGeneration
  const settings = await getUpdateSettings()
  if (!manual && (!settings.autoCheck || generation !== automaticGeneration)) return null
  const controller = new AbortController()
  if (!manual) automaticChecks.add(controller)
  const timeout = setTimeout(() => controller.abort(), 15000)
  let releaseList: GitHubReleaseItem[] = []
  try {
    const headers = new Headers()
    headers.append('Accept', 'application/vnd.github+json')
    headers.append('X-GitHub-Api-Version', '2022-11-28')
    const response = await fetch(RELEASE_LIST_URL, {
      method: 'GET',
      headers: headers,
      redirect: 'follow',
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`检测更新失败（HTTP ${response.status}）`)
    const body = await response.json()
    if (!Array.isArray(body)) throw new Error('更新服务返回的数据无法识别')
    releaseList = body
  } catch (err) {
    if (!manual && generation !== automaticGeneration) return null
    if (controller.signal.aborted) throw new Error('检测更新超时，请稍后重试')
    throw err
  } finally {
    clearTimeout(timeout)
    automaticChecks.delete(controller)
  }
  const availableRelease = releaseList.find((it) => !it.draft && !it.prerelease &&
    semver.valid(normalizeUpdateVersion(it.tag_name)))
  if (!availableRelease) {
    return null
  }
  const availableReleaseVersion = normalizeUpdateVersion(availableRelease.tag_name)
  if (!semver.gt(availableReleaseVersion, packageJson.version)) {
    return null
  }
  const currentSettings = await getUpdateSettings()
  if (!manual && (generation !== automaticGeneration || !currentSettings.autoCheck ||
    currentSettings.ignoredVersions.includes(availableReleaseVersion))) return null
  const { assets } = availableRelease
  const targetAsset = findTargetAsset(assets ?? [])
  if (targetAsset) {
    return {
      releaseVersion: availableReleaseVersion,
      releasePageUrl: availableRelease.html_url,
      assetUrl: targetAsset.browser_download_url,
      assetName: targetAsset.name,
      releaseNote: availableRelease.body
    }
  }
  return null
}

export function initUpdateIpc() {
  updateSettingsEvents.on('changed', settings => {
    for (const window of BrowserWindow.getAllWindows()) {
      try {
        if (!window.isDestroyed() && !window.webContents.isDestroyed())
          window.webContents.send('update-settings-changed', settings)
      } catch {
        // A window can close between the checks and send. The persisted save
        // still succeeded, and other windows must receive the new settings.
        console.warn('无法向已关闭的窗口同步更新设置')
      }
    }
  })
  ipcMain.handle('get-update-settings', () => getUpdateSettings())
  ipcMain.handle('set-update-auto-check', (_, enabled) => setUpdateAutoCheck(enabled))
  ipcMain.handle('ignore-update-version', (_, version) => ignoreUpdateVersion(version))
  ipcMain.handle('restore-ignored-update-versions', () => restoreIgnoredUpdateVersions())
  ipcMain.handle('check-update', (_, payload) => checkUpdateForUi({ manual: payload?.manual === true }))
}
