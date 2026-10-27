import fs from 'node:fs'
import path from 'node:path'
import { resolveStorageFolder, runtimeFolderPath } from './data-location.mjs'
import { readTaskConfigSnapshot } from './task-config-snapshot.mjs'
import { RUN_POLICY_FILE, normalizeRunPolicy, policyRunConfig } from './run-policy.mjs'
import { writeFileAtomicSync, writeFilesAtomicSync, writeJsonAtomicSync } from '@geekgeekrun/utils/atomic-json.mjs'
import defaultDingtalkConf from './default-config-file/dingtalk.json' with { type: 'json' }
import defaultBossConf from './default-config-file/boss.json' with { type: 'json' }
import defaultTargetCompanyListConf from './default-config-file/target-company-list.json' with { type: 'json' }
import defaultLlmConf from './default-config-file/llm.json' with { type: 'json' }
import defaultCommonJobConditionConfig from './default-config-file/common-job-condition-config.json' with { type: 'json' }
import defaultBossCookieStorage from './default-storage-file/boss-cookies.json' with { type: 'json' }
import defaultBossLocalStorageStorage from './default-storage-file/boss-local-storage.json' with { type: 'json' }
import defaultJobNotSuitReasonCodeToTextCacheStorage from './default-storage-file/job-not-suit-reason-code-to-text-cache.json' with { type: 'json' }

export { runtimeFolderPath }
export const configFolderPath = path.join(runtimeFolderPath, 'config')
export const storageFilePath = resolveStorageFolder().path
const taskConfigSnapshot = process.env.GEEKGEEKRUN_TASK_CONFIG_FILE
  ? readTaskConfigSnapshot(process.env.GEEKGEEKRUN_TASK_CONFIG_FILE) : null
const configDefaults = {
  'boss.json': defaultBossConf, 'dingtalk.json': defaultDingtalkConf,
  'target-company-list.json': defaultTargetCompanyListConf, 'llm.json': defaultLlmConf,
  'common-job-condition-config.json': defaultCommonJobConditionConfig
}
const storageDefaults = {
  'boss-cookies.json': defaultBossCookieStorage, 'boss-local-storage.json': defaultBossLocalStorageStorage,
  'job-not-suit-reason-code-to-text-cache.json': defaultJobNotSuitReasonCodeToTextCacheStorage
}
export const configFileNameList = Object.keys(configDefaults)
export const storageFileNameList = Object.keys(storageDefaults)
const copy = value => JSON.parse(JSON.stringify(value))
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)

function filePath(folder, name) {
  if (typeof name !== 'string' || !name.trim() || name === '.' || name === '..' || /[\\/\0]/.test(name) || path.isAbsolute(name) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(name))
    throw new Error('配置或存储文件名无效')
  return path.join(folder, name)
}
function readError(file, code) {
  // JSON.parse error messages can contain credential text. Never forward them or
  // attach the original SyntaxError as a cause.
  return Object.assign(new Error(`无法读取 ${path.basename(file)}（${code === 'JSON_INVALID' ? 'JSON 格式或结构无效' : code || '读取失败'}）；原文件已保留，请修正或从备份恢复`),
    { code: code === 'JSON_INVALID' ? 'GGR_JSON_INVALID' : 'GGR_FILE_READ_FAILED' })
}
function writeError(file, error) {
  return Object.assign(new Error(`无法保存 ${path.basename(file)}（${error.code || '写入失败'}）；${error.atomicCommitted ? '文件已替换，但刷盘确认失败，请检查后重试' : '未截断覆盖目标文件，请检查数据目录后重试'}`),
    { code: 'GGR_FILE_WRITE_FAILED', atomicCommitted: Boolean(error.atomicCommitted) })
}
function createDefault(file, value) {
  try { writeJsonAtomicSync(file, value, { createOnly: true }) }
  catch (error) { throw writeError(file, error) }
}
function validateConfig(name, value) {
  if (['boss.json', 'dingtalk.json', 'common-job-condition-config.json'].includes(name) && !object(value)) throw Error('structure')
  if (name === 'target-company-list.json' && (!Array.isArray(value) || value.some(v => typeof v !== 'string'))) throw Error('structure')
  if (name === 'llm.json' && (!Array.isArray(value) || value.some(v => !object(v)))) throw Error('structure')
}
function validateStorage(name, value) {
  if (name === 'boss-cookies.json' && (!Array.isArray(value) || value.some(cookie =>
    !object(cookie) || typeof cookie.name !== 'string' || typeof cookie.value !== 'string'))) throw Error('structure')
  if (name === 'boss-local-storage.json' && (!object(value) || Object.values(value).some(v => typeof v !== 'string'))) throw Error('structure')
}
function readJson(file, validate, missing = null) {
  let text
  try { text = fs.readFileSync(file, 'utf8') }
  catch (error) { if (error.code === 'ENOENT') return missing; throw readError(file, error.code) }
  try { const value = JSON.parse(text); validate(value); return value }
  catch { throw readError(file, 'JSON_INVALID') }
}
function encodeJson(name, value, validate) {
  const text = JSON.stringify(value)
  if (text === undefined) throw new TypeError(`${name} 的 JSON 内容不能为空`)
  try { validate(name, JSON.parse(text)) }
  catch { throw new TypeError(`${name} 的 JSON 结构无效，未写入`) }
  return text
}
function ensureFolders() {
  for (const folder of [configFolderPath, storageFilePath]) {
    try { fs.mkdirSync(folder, { recursive: true }) }
    catch (error) { throw writeError(folder, error) }
  }
}
function migrateCommonConfig() {
  const file = filePath(configFolderPath, 'common-job-condition-config.json')
  if (fs.existsSync(file)) return
  const common = copy(defaultCommonJobConditionConfig)
  const boss = readJson(filePath(configFolderPath, 'boss.json'), value => validateConfig('boss.json', value))
  const companies = readJson(filePath(configFolderPath, 'target-company-list.json'), value => validateConfig('target-company-list.json', value))
  if (boss) {
    for (const key of Object.keys(common)) if (Object.hasOwn(boss, key)) common[key] = boss[key]
    const { expectJobRegExpStr, expectJobNameRegExpStr, expectJobTypeRegExpStr, expectJobDescRegExpStr } = boss
    if (expectJobRegExpStr && !expectJobNameRegExpStr && !expectJobTypeRegExpStr && !expectJobDescRegExpStr)
      Object.assign(common, { expectJobNameRegExpStr: expectJobRegExpStr, expectJobTypeRegExpStr: expectJobRegExpStr, expectJobDescRegExpStr: expectJobRegExpStr })
  }
  if (companies) common.expectCompanies = companies
  // Initializers from another process may have won the race. Never replace their file.
  createDefault(file, common)
}

export function ensureConfigFileExist() {
  ensureFolders()
  migrateCommonConfig()
  for (const [name, value] of Object.entries(configDefaults))
    if (!fs.existsSync(filePath(configFolderPath, name))) createDefault(filePath(configFolderPath, name), value)
}
export function ensureStorageFileExist() {
  ensureFolders()
  for (const [name, value] of Object.entries(storageDefaults))
    if (!fs.existsSync(filePath(storageFilePath, name))) createDefault(filePath(storageFilePath, name), value)
}
export function readConfigFile(name) {
  const file = filePath(configFolderPath, name)
  if (taskConfigSnapshot && Object.hasOwn(taskConfigSnapshot, name)) {
    const value = copy(taskConfigSnapshot[name])
    try { validateConfig(name, value) }
    catch { throw readError(process.env.GEEKGEEKRUN_TASK_CONFIG_FILE, 'JSON_INVALID') }
    return value
  }
  if (!fs.existsSync(file) && Object.hasOwn(configDefaults, name)) ensureConfigFileExist()
  return readJson(file, value => validateConfig(name, value))
}
// GUI/queued workers already have resolved snapshots. Standalone workers capture
// an explicitly saved policy once; legacy CLI settings remain usable when absent.
let runPolicyCaptured = false, capturedRunPolicy = null
export function readRunConfigFile(name) {
  const value = readConfigFile(name)
  if (name !== 'boss.json' || (taskConfigSnapshot && Object.hasOwn(taskConfigSnapshot, name))) return value
  if (!runPolicyCaptured) {
    const saved = readConfigFile(RUN_POLICY_FILE)
    if (saved != null) {
      try { capturedRunPolicy = normalizeRunPolicy(saved, { legacy: true }) }
      catch { throw readError(filePath(configFolderPath, RUN_POLICY_FILE), 'JSON_INVALID') }
    }
    runPolicyCaptured = true
  }
  return capturedRunPolicy ? { ...value, ...policyRunConfig(capturedRunPolicy) } : value
}
export function readStorageFile(name, { isJson = true } = {}) {
  const file = filePath(storageFilePath, name)
  if (!fs.existsSync(file) && Object.hasOwn(storageDefaults, name)) ensureStorageFileExist()
  if (isJson) return readJson(file, value => validateStorage(name, value))
  try { return fs.readFileSync(file, 'utf8') }
  catch (error) { if (error.code === 'ENOENT') return null; throw readError(file, error.code) }
}
// These APIs retain Promise compatibility; their short synchronous commit sections
// also preserve call order when callers mix awaited and exit-time writes.
export async function writeConfigFile(name, value, _options = {}) {
  const file = filePath(configFolderPath, name), text = encodeJson(name, value, validateConfig)
  try { return writeFileAtomicSync(file, text) }
  catch (error) { throw writeError(file, error) }
}
export async function writeStorageFile(name, value, { isJson = true } = {}) {
  const file = filePath(storageFilePath, name), text = isJson ? encodeJson(name, value, validateStorage) : value
  try { return writeFileAtomicSync(file, text) }
  catch (error) { throw writeError(file, error) }
}
export async function writeStorageFiles(entries) {
  const captured = entries.map(([name, value]) => [filePath(storageFilePath, name), encodeJson(name, value, validateStorage)])
  try { return writeFilesAtomicSync(captured) }
  catch (error) {
    if (error instanceof AggregateError) throw Object.assign(new Error('存储文件保存失败，部分回滚未能完成；已保留可用的回滚副本，请检查数据目录后重试'),
      { code: 'GGR_FILE_WRITE_FAILED', recoveryFiles: error.recoveryFiles })
    throw writeError('存储文件', error)
  }
}
export async function writeBossSession({ cookies, localStorage }) {
  if (!Array.isArray(cookies) || !cookies.length) throw new TypeError('浏览器尚未返回登录 Cookie，未覆盖已保存的凭证')
  return writeStorageFiles([['boss-cookies.json', cookies], ['boss-local-storage.json', localStorage]])
}
export function getPublicDbFilePath() { return path.join(storageFilePath, 'public.db') }

// Defer migration until an explicit initialization/read, so callers can report a
// corrupt legacy file through their normal error path instead of failing at import.
try { fs.mkdirSync(configFolderPath, { recursive: true }) }
catch (error) { throw writeError(configFolderPath, error) }
