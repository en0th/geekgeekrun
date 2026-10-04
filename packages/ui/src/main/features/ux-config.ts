import { ipcMain, BrowserWindow, safeStorage } from 'electron'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import {
  configFolderPath,
  storageFilePath,
  readConfigFile,
  readStorageFile,
  ensureConfigFileExist,
  ensureStorageFileExist
} from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { getLastUsedAndAvailableBrowser } from '../flow/DOWNLOAD_DEPENDENCIES/utils/browser-history'
import { getAnyAvailablePuppeteerExecutable } from '../flow/DOWNLOAD_DEPENDENCIES/utils/puppeteer-executable'
import { openBrowserDownloadWindow } from './open-browser-download-window'
import { defaultPromptMap } from '../flow/READ_NO_REPLY_AUTO_REMINDER_MAIN/boss-operation'
import { validModelList, followErrors, normalizeCache } from '../../common/ux-validation.mjs'
import { completes } from '@geekgeekrun/utils/gpt-request.mjs'

const stateFile = path.join(storageFilePath, 'ux-workspace.json')
const closeDraftFile = path.join(storageFilePath, 'ux-close-draft.json')
function readCloseDraft() {
  if (!fsSync.existsSync(closeDraftFile)) return null
  try {
    if (fsSync.statSync(closeDraftFile).size > 6 * 1024 * 1024) throw Error('草稿过大')
    const stored = JSON.parse(fsSync.readFileSync(closeDraftFile, 'utf8'))
    if (stored.version !== 1) throw Error('草稿版本无效')
    return JSON.parse(
      stored.encrypted ? safeStorage.decryptString(Buffer.from(stored.data, 'base64')) : stored.data
    )
  } catch (error) {
    console.warn('无法恢复退出草稿：', (error as Error).message)
    return null
  }
}
function writeCloseDraft(draft) {
  if (!draft.state && !draft.models) {
    if (fsSync.existsSync(closeDraftFile)) fsSync.unlinkSync(closeDraftFile)
    return
  }
  const encrypted = safeStorage.isEncryptionAvailable()
  const captured = JSON.parse(JSON.stringify(draft))
  // Never put an unsaved API secret into a plaintext fallback file.
  if (!encrypted && captured.models) {
    captured.secretOmitted = captured.models.some((model) => model.providerApiSecret)
    for (const model of captured.models) model.providerApiSecret = ''
  }
  const text = JSON.stringify(captured)
  const temp = closeDraftFile + '.tmp-' + randomUUID()
  try {
    fsSync.writeFileSync(
      temp,
      JSON.stringify({
        version: 1,
        encrypted,
        data: encrypted ? safeStorage.encryptString(text).toString('base64') : text
      }),
      { mode: 0o600 }
    )
    fsSync.renameSync(temp, closeDraftFile)
  } finally {
    if (fsSync.existsSync(temp)) fsSync.unlinkSync(temp)
  }
}
function discardCloseDraft(part: 'state' | 'models', requestedAt: number) {
  try {
    const draft = readCloseDraft()
    // A write requested before closing must not discard newer edits captured at exit.
    if (!draft || draft.createdAt >= requestedAt) return
    draft[part] = null
    writeCloseDraft(draft)
  } catch (error) {
    console.warn('无法更新退出草稿：', (error as Error).message)
  }
}
let queue: Promise<unknown> = Promise.resolve()
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.catch(() => {}).then(fn)
  queue = p
  return p
}
async function readState() {
  try {
    return JSON.parse(await fs.readFile(stateFile, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { revision: 0, state: null }
    if (error instanceof SyntaxError) {
      await fs.copyFile(stateFile, stateFile + '.invalid-' + Date.now())
      return { revision: 0, state: null }
    }
    throw error
  }
}
function signature(
  boss = readConfigFile('boss.json'),
  companies = readConfigFile('target-company-list.json')
) {
  return createHash('sha256')
    .update(JSON.stringify([boss, companies, readConfigFile('common-job-condition-config.json')]))
    .digest('hex')
}
// Atomic individual replacement; restore earlier files if a later write fails.
async function writeBatch(entries: Array<[string, unknown]>) {
  const backups: Array<[string, Buffer | null]> = []
  try {
    for (const [file, data] of entries) {
      let before: Buffer | null = null
      try {
        before = await fs.readFile(file)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      }
      const temp = file + '.tmp-' + randomUUID()
      try {
        await fs.writeFile(temp, typeof data === 'string' ? data : JSON.stringify(data), {
          mode: 0o600
        })
        await fs.rename(temp, file)
        backups.push([file, before])
      } finally {
        await fs.unlink(temp).catch(() => {})
      }
    }
  } catch (error) {
    for (const [file, before] of backups.reverse()) {
      if (before === null) await fs.unlink(file).catch(() => {})
      else await fs.writeFile(file, before)
    }
    throw error
  }
}
function promptType(type: string) {
  if (type !== 'open' && type !== 'rechat') throw Error('无效的提示词类型')
  return defaultPromptMap[type]
}
export function initUxIpc() {
  // beforeunload cannot await promises. Capture only editing drafts synchronously;
  // this never writes runnable BOSS settings or saved AI configuration.
  ipcMain.on('ux-store-close-draft', (event, payload) => {
    try {
      if (
        !event.sender.getURL().includes('#/ux/') ||
        !payload ||
        JSON.stringify(payload).length > 4 * 1024 * 1024
      )
        throw Error('退出草稿无效或过大')
      const state = payload.state ? normalizeCache(payload.state) : null
      if (payload.state && !state?.draft) throw Error('退出草稿结构无效')
      if (
        payload.models != null &&
        (!Array.isArray(payload.models) ||
          !payload.models.length ||
          payload.models.some(
            (model) => !model || typeof model !== 'object' || Array.isArray(model)
          ))
      )
        throw Error('模型草稿结构无效')
      ensureStorageFileExist()
      writeCloseDraft({
        createdAt: Date.now(),
        state,
        models: payload.models || null,
        autoDirty: Boolean(payload.autoDirty),
        followDirty: Boolean(payload.followDirty)
      })
      event.returnValue = { ok: true }
    } catch (error) {
      event.returnValue = { ok: false, error: (error as Error).message }
    }
  })
  ipcMain.handle('ux-load-state', () =>
    exclusive(async () => {
      ensureConfigFileExist()
      ensureStorageFileExist()
      const saved = await readState()
      let state = normalizeCache(saved.state)
      if (state && saved.signature !== signature()) {
        delete state.draft
        delete state.follow
        delete state.shared
        state.activeTemplate = ''
        state.templateBaseline = ''
      }
      const closeDraft = readCloseDraft()
      if (closeDraft?.state) state = normalizeCache(closeDraft.state) || state
      const config = {}
      for (const name of [
        'boss.json',
        'common-job-condition-config.json',
        'llm.json',
        'target-company-list.json'
      ])
        config[name] = readConfigFile(name)
      const prompts = {}
      for (const type of ['open', 'rechat'])
        prompts[type] =
          readStorageFile(promptType(type).fileName, { isJson: false }) || promptType(type).content
      return {
        config,
        cookie:
          Array.isArray(readStorageFile('boss-cookies.json')) &&
          readStorageFile('boss-cookies.json').length
            ? [{ present: true }]
            : [],
        browser: await getLastUsedAndAvailableBrowser(),
        prompts,
        datasets: { jobLibrary: [] },
        uxState: state,
        modelDraft: Array.isArray(closeDraft?.models) ? closeDraft.models : null,
        pendingDraft: closeDraft?.state
          ? { autoDirty: closeDraft.autoDirty, followDirty: closeDraft.followDirty }
          : null,
        draftSecretOmitted: Boolean(closeDraft?.models && closeDraft?.secretOmitted),
        revision: saved.revision || 0
      }
    })
  )
  ipcMain.handle('ux-save-state', (_, payload) => {
    const requestedAt = Date.now()
    return exclusive(async () => {
      if (!payload || JSON.stringify(payload).length > 4 * 1024 * 1024)
        throw Error('配置过大或无效')
      const previous = await readState()
      if ((previous.revision || 0) !== payload.expectedRevision)
        throw Error('配置已被另一个窗口修改，请重新加载后再保存，当前草稿仍保留。')
      const state = normalizeCache(payload.state)
      if (!state?.draft) throw Error('配置草稿结构无效，请重新加载')
      const patch = payload.configPatch
      const entries: Array<[string, unknown]> = []
      let nextSignature = signature()
      if (patch) {
        const boss = readConfigFile('boss.json')
        if (patch.autoReminder) {
          const a = patch.autoReminder
          const errors = followErrors({
            source: a.rechatContentSource === 2 ? 'ai' : 'emotion',
            days: a.rechatLimitDay,
            interval: a.throttleIntervalMinutes,
            context: a.recentMessageQuantityForLlm
          })
          if (errors.length) throw Error(errors.join('；'))
        }
        for (const k of ['expectSalaryLow', 'expectSalaryHigh'])
          if (
            Object.hasOwn(patch, k) &&
            patch[k] != null &&
            (!Number.isFinite(patch[k]) || patch[k] < 0)
          )
            throw Error('薪资必须为非负数')
        for (const k of ['sageTimeOpTimes', 'sageTimePauseMinute'])
          if (
            Object.hasOwn(patch, k) &&
            (!Number.isFinite(patch[k]) || patch[k] < (k === 'sageTimeOpTimes' ? 1 : 0))
          )
            throw Error('休息设置无效')
        if (
          patch.expectSalaryLow != null &&
          patch.expectSalaryHigh != null &&
          patch.expectSalaryLow > patch.expectSalaryHigh
        )
          throw Error('薪资上限不能低于下限')
        Object.assign(boss, patch)
        delete boss.expectCompanies
        entries.push([path.join(configFolderPath, 'boss.json'), boss])
        if (Object.hasOwn(patch, 'expectCompanies'))
          entries.push([
            path.join(configFolderPath, 'target-company-list.json'),
            String(patch.expectCompanies).split(',').filter(Boolean)
          ])
        nextSignature = signature(
          boss,
          Object.hasOwn(patch, 'expectCompanies')
            ? String(patch.expectCompanies).split(',').filter(Boolean)
            : readConfigFile('target-company-list.json')
        )
      }
      const revision = (previous.revision || 0) + 1
      entries.push([stateFile, { revision, state, signature: nextSignature }])
      await writeBatch(entries)
      discardCloseDraft('state', requestedAt)
      return { revision }
    })
  })
  ipcMain.handle('ux-save-models', (_, models) => {
    const requestedAt = Date.now()
    return exclusive(async () => {
      const error = validModelList(models)
      if (error) throw Error(error)
      const previousModels = readConfigFile('llm.json')
      const legacyBackedUp = Array.isArray(previousModels) && previousModels.length > 2
      if (legacyBackedUp) {
        if (!safeStorage.isEncryptionAvailable()) throw Error('无法安全备份旧模型配置，请稍后重试。旧配置未改动。')
        await fs.writeFile(
          path.join(storageFilePath, 'llm-legacy-backup-' + Date.now() + '-' + randomUUID() + '.encrypted'),
          safeStorage.encryptString(JSON.stringify(previousModels)),
          { mode: 0o600, flag: 'wx' }
        )
      }
      await writeBatch([
        [
          path.join(configFolderPath, 'llm.json'),
          models.map(
            ({ id, model, providerCompleteApiUrl, providerApiSecret, enabled }, index) => ({
              id,
              model,
              providerCompleteApiUrl,
              providerApiSecret,
              role: index === 0 ? 'primary' : 'backup',
              enabled
            })
          )
        ]
      ])
      discardCloseDraft('models', requestedAt)
      return { legacyBackedUp }
    })
  })
  ipcMain.handle('ux-test-models', async (_, models) => {
    const error = validModelList(models)
    if (error) throw Error(error)
    const results: Array<{ role: 'primary' | 'backup'; ok: boolean; error?: string }> = []
    for (const [index, model] of models.entries()) {
      if (!model.enabled) continue
      try {
        const result = await completes(
          { baseURL: model.providerCompleteApiUrl, apiKey: model.providerApiSecret || 'local', model: model.model, timeout: 15000, maxRetries: 0 },
          [{ role: 'user', content: '只回复 OK。' }]
        )
        if (!result?.choices?.[0]?.message?.content?.trim()) throw Error('服务返回空内容')
        results.push({ role: index === 0 ? 'primary' : 'backup', ok: true })
      } catch (error) {
        let message = String((error as Error).message || '连接失败').slice(0, 300)
        if (model.providerApiSecret) message = message.split(model.providerApiSecret).join('[密钥已隐藏]')
        results.push({ role: index === 0 ? 'primary' : 'backup', ok: false, error: message })
      }
    }
    return results
  })
  ipcMain.handle(
    'ux-read-prompt',
    (_, { type }) =>
      readStorageFile(promptType(type).fileName, { isJson: false }) || promptType(type).content
  )
  ipcMain.handle('ux-save-prompt', (_, { type, text }) =>
    exclusive(async () => {
      const info = promptType(type)
      if (typeof text !== 'string' || !text.trim() || text.length > 100000)
        throw Error('提示词不能为空或过长')
      if (type === 'rechat' && !text.includes('__REPLACE_REAL_RESUME_HERE__'))
        throw Error('请保留简历占位符')
      await writeBatch([[path.join(storageFilePath, info.fileName), text]])
    })
  )
  ipcMain.handle('ux-find-browser', () =>
    getAnyAvailablePuppeteerExecutable({ ignoreCached: true, noSave: true })
  )
  ipcMain.handle('ux-save-browser', async (_, info) => {
    const executablePath = String(info.executablePath || '').trim()
    const stat = await fs.stat(executablePath)
    if (!stat.isFile()) throw Error('请选择浏览器可执行文件')
    // Native existing path checking does not guarantee BOSS compatibility; worker checks remain authoritative.
    await writeBatch([
      [
        path.join(storageFilePath, 'last-used-browser-record'),
        [executablePath, 'chrome', 2].join('\n')
      ]
    ])
  })
  ipcMain.handle('ux-download-browser', (ev) =>
    openBrowserDownloadWindow({
      windowOption: {
        parent: BrowserWindow.fromWebContents(ev.sender),
        modal: true,
        show: true
      }
    })
  )
}
