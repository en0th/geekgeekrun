import { ipcMain, BrowserWindow, safeStorage } from 'electron'
import { mergeJobFilterConfig, companySelections } from '@geekgeekrun/geek-auto-start-chat-with-boss/job-filter-config.mjs'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { writeFileAtomicSync, writeJsonAtomicSync, writeFilesAtomicSync } from '@geekgeekrun/utils/atomic-json.mjs'
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
import { completes, listModels } from '@geekgeekrun/utils/gpt-request.mjs'
import { aiRequestSettings, completionOptions } from '../../common/model-config.mjs'
import {
  keepAutoReminderSecrets,
  llmSecretsLostByHostChange,
  redactConfigForRenderer,
  redactLlmConfigList,
  restoreLlmSecrets
} from './config-secrets'

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
    console.warn('无法恢复 ux-close-draft.json，原文件已保留；请检查草稿文件或备份')
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
  // Unsaved API secrets are never kept: the draft is handed back to the renderer on restore.
  if (captured.models) {
    captured.secretOmitted =
      captured.secretOmitted || captured.models.some((model) => model.providerApiSecret)
    for (const model of captured.models) model.providerApiSecret = ''
  }
  const text = JSON.stringify(captured)
  writeJsonAtomicSync(closeDraftFile, {
    version: 1, encrypted,
    data: encrypted ? safeStorage.encryptString(text).toString('base64') : text
  })
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
    const saved = JSON.parse(await fs.readFile(stateFile, 'utf8'))
    if (!saved || !Number.isSafeInteger(saved.revision) || saved.revision < 0 || !Object.hasOwn(saved, 'state'))
      throw new SyntaxError('Invalid workspace structure')
    return saved
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { revision: 0, state: null }
    if (error instanceof SyntaxError) {
      throw Error('ux-workspace.json 的 JSON 格式或结构无效；原文件已保留，请修正或从备份恢复')
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
  writeFilesAtomicSync(entries.map(([file, data]) => [file, typeof data === 'string' ? data : JSON.stringify(data)]))
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
        'target-company-list.json',
        'dingtalk.json'
      ])
        config[name] = readConfigFile(name)
      const prompts = {}
      for (const type of ['open', 'rechat'])
        prompts[type] =
          readStorageFile(promptType(type).fileName, { isJson: false }) || promptType(type).content
      // drafts written before secrets were stripped may still hold one
      const draftModels = Array.isArray(closeDraft?.models)
        ? redactLlmConfigList(closeDraft.models).map((model) => ({
            ...model,
            hasProviderApiSecret: redactLlmConfigList(config['llm.json']).some(
              (saved) => saved.id === model.id && saved.hasProviderApiSecret
            )
          }))
        : null
      return {
        config: redactConfigForRenderer(config),
        cookie:
          Array.isArray(readStorageFile('boss-cookies.json')) &&
          readStorageFile('boss-cookies.json').length
            ? [{ present: true }]
            : [],
        browser: await getLastUsedAndAvailableBrowser(),
        prompts,
        datasets: { jobLibrary: [] },
        uxState: state,
        modelDraft: draftModels,
        pendingDraft: closeDraft?.state
          ? { autoDirty: closeDraft.autoDirty, followDirty: closeDraft.followDirty }
          : null,
        draftSecretOmitted: Boolean(
          closeDraft?.models &&
            (closeDraft?.secretOmitted ||
              closeDraft.models.some((model) => model?.providerApiSecret))
        ),
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
        let boss = readConfigFile('boss.json')
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
        if (patch.autoReminder)
          patch.autoReminder = keepAutoReminderSecrets(patch.autoReminder, boss.autoReminder)
        boss = mergeJobFilterConfig(boss, patch)
        delete boss.expectCompanies
        entries.push([path.join(configFolderPath, 'boss.json'), boss])
        if (Object.hasOwn(patch, 'expectCompanies'))
          entries.push([
            path.join(configFolderPath, 'target-company-list.json'),
            companySelections(patch.expectCompanies)
          ])
        nextSignature = signature(
          boss,
          Object.hasOwn(patch, 'expectCompanies')
            ? companySelections(patch.expectCompanies)
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
  ipcMain.handle('ux-save-models', (_, incoming) => {
    const requestedAt = Date.now()
    return exclusive(async () => {
      const error = validModelList(incoming)
      if (error) throw Error(error)
      const previousModels = readConfigFile('llm.json')
      if (llmSecretsLostByHostChange(incoming, previousModels))
        throw Error('更换接口地址后，请重新填写该模型的 API 密钥。')
      // blank secrets mean "keep the saved one"; the renderer never receives them
      const models = restoreLlmSecrets(incoming, previousModels)
      const legacyBackedUp = Array.isArray(previousModels) && previousModels.length > 2
      if (legacyBackedUp) {
        if (!safeStorage.isEncryptionAvailable()) throw Error('无法安全备份旧模型配置，请稍后重试。旧配置未改动。')
        const backedUp = writeFileAtomicSync(
          path.join(storageFilePath, 'llm-legacy-backup-' + Date.now() + '-' + randomUUID() + '.encrypted'),
          safeStorage.encryptString(JSON.stringify(previousModels)),
          { createOnly: true }
        )
        if (!backedUp) throw Error('旧模型配置的安全备份未能创建，原配置未改动')
      }
      await writeBatch([
        [
          path.join(configFolderPath, 'llm.json'),
          models.map(
            ({ id, model, providerCompleteApiUrl, providerApiSecret, enabled, ...rest }, index) => ({
              id,
              model,
              providerCompleteApiUrl,
              providerApiSecret,
              role: index === 0 ? 'primary' : 'backup',
              enabled,
              ...aiRequestSettings(rest)
            })
          )
        ]
      ])
      discardCloseDraft('models', requestedAt)
      return { legacyBackedUp, models: redactLlmConfigList(readConfigFile('llm.json')) }
    })
  })
  ipcMain.handle('ux-test-models', async (_, incoming) => {
    const error = validModelList(incoming)
    if (error) throw Error(error)
    const savedModels = readConfigFile('llm.json')
    if (llmSecretsLostByHostChange(incoming, savedModels))
      throw Error('更换接口地址后，请重新填写该模型的 API 密钥。')
    const models = restoreLlmSecrets(incoming, savedModels)
    const results: Array<{ role: 'primary' | 'backup'; ok: boolean; error?: string }> = []
    for (const [index, model] of models.entries()) {
      if (!model.enabled) continue
      try {
        // same timeout and thinking mode as real requests, but no retries so problems show at once
        const result = await completes(
          {
            ...completionOptions({ ...model, providerApiSecret: model.providerApiSecret || 'local' }),
            maxRetries: 0
          },
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
  // model list for the model name picker; the key is resolved here and never leaves main
  ipcMain.handle('ux-list-models', async (_, incoming) => {
    const savedModels = readConfigFile('llm.json')
    if (llmSecretsLostByHostChange([incoming], savedModels))
      throw Error('更换接口地址后，请先填写该接口的 API 密钥。')
    const [model] = restoreLlmSecrets([incoming], savedModels)
    let url
    try {
      url = new URL(String(model.providerCompleteApiUrl ?? ''))
      if (!['http:', 'https:'].includes(url.protocol)) throw Error()
    } catch {
      throw Error('请先填写完整的 http(s) 接口地址。')
    }
    try {
      return await listModels({
        baseURL: url.toString(),
        apiKey: model.providerApiSecret || 'local'
      })
    } catch (error) {
      let message = String((error as Error).message || '获取失败').slice(0, 300)
      if (model.providerApiSecret) message = message.split(model.providerApiSecret).join('[密钥已隐藏]')
      throw Error(message)
    }
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
  // dingtalk.json isn't part of the draft signature, so saving it never discards a draft
  // the renderer never gets the token back; it only learns whether one is set
  ipcMain.handle('ux-save-dingtalk', (_, { token = '', clear = false } = {}) =>
    exclusive(async () => {
      if (typeof token !== 'string' || token.length > 200) throw Error('钉钉机器人令牌无效')
      if (!clear && !token.trim()) throw Error('请填写钉钉机器人令牌')
      ensureConfigFileExist()
      const current = readConfigFile('dingtalk.json') || {}
      await writeBatch([
        [
          path.join(configFolderPath, 'dingtalk.json'),
          { ...current, groupRobotAccessToken: clear ? '' : token.trim() }
        ]
      ])
      return { hasGroupRobotAccessToken: !clear }
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
        parent: BrowserWindow.fromWebContents(ev.sender) || undefined,
        modal: true,
        show: true
      }
    })
  )
}
