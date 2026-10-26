import fs from 'node:fs'
import path from 'node:path'
import { writeJsonAtomicSync } from '@geekgeekrun/utils/atomic-json.mjs'

// Freeze job settings, never cookies/API keys. Every restart of a queued worker uses this file.
const bossKeys = [
  'requiredJobConditions',
  'combineRecommendJobFilterType', 'anyCombineRecommendJobFilter', 'staticCombineRecommendJobFilterConditions',
  'isSkipEmptyConditionForCombineRecommendJobFilter', 'expectJobRegExpStr', 'expectJobNameRegExpStr',
  'expectJobTypeRegExpStr', 'expectJobDescRegExpStr', 'jobDetailRegExpMatchLogic', 'jobNotMatchStrategy',
  'expectCityList', 'expectCityNotMatchStrategy', 'strategyScopeOptionWhenMarkJobCityNotMatch',
  'expectSalaryCalculateWay', 'expectSalaryLow', 'expectSalaryHigh', 'expectSalaryNotMatchStrategy',
  'strategyScopeOptionWhenMarkSalaryNotMatch', 'expectWorkExpList', 'expectWorkExpNotMatchStrategy',
  'strategyScopeOptionWhenMarkJobWorkExpNotMatch', 'isPosterHrFilterEnabled', 'posterHrTitleRegExpStr',
  'posterHrNotMatchStrategy', 'blockCompanyNameRegExpStr', 'blockCompanyNameRegMatchStrategy',
  'markAsNotActiveSelectedTimeRange', 'jobNotActiveStrategy', 'fieldsForUseCommonConfig', 'jobSourceList',
  'autoChatRunMode', 'autoChatRunInBackground', 'collectOnlyMatchingJobs', 'skipUnparseableSalaryJob', 'autoChatPerSourceSuccessLimit',
  'autoChatNoMatchStreakLimit', 'autoChatFilterCombinationLimit', 'autoChatRunBudget', 'autoChatRunPolicy', 'autoChatTimedRest', 'autoChatExpectedAccountId', 'jobListLoadWaitSeconds', 'jobDetailViewWaitSeconds',
  'isSageTimeEnabled', 'sageTimeOpTimes', 'sageTimePauseMinute'
]
const copy = value => JSON.parse(JSON.stringify(value))
export function jobConfigSnapshot(config) {
  return {
    'boss.json': Object.fromEntries(bossKeys.filter(key => Object.hasOwn(config['boss.json'], key)).map(key => [key, copy(config['boss.json'][key])])),
    'common-job-condition-config.json': Object.fromEntries([...bossKeys, 'expectCompanies'].filter(key => Object.hasOwn(config['common-job-condition-config.json'] || {}, key)).map(key => [key, copy(config['common-job-condition-config.json'][key])])),
    'target-company-list.json': copy(config['target-company-list.json'] || [])
  }
}
export function readTaskConfigSnapshot(filePath) {
  let text, data
  try { text = fs.readFileSync(filePath, 'utf8') }
  catch { throw Object.assign(new Error('任务配置快照无法读取，请修复或重新创建任务'), { code: 'GGR_FILE_READ_FAILED' }) }
  try { data = JSON.parse(text) }
  catch { throw Object.assign(new Error('任务配置快照无效，原文件已保留，请修复或重新创建任务'), { code: 'GGR_JSON_INVALID' }) }
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  if (data?.version !== 1 || !record(data.config) || !record(data.config['boss.json']) ||
    !record(data.config['common-job-condition-config.json']) || !Array.isArray(data.config['target-company-list.json']) ||
    data.config['target-company-list.json'].some(value => typeof value !== 'string'))
    throw Object.assign(new Error('任务配置快照无效，原文件已保留，请修复或重新创建任务'), { code: 'GGR_JSON_INVALID' })
  return data.config
}
export function writeTaskConfigSnapshot(folder, runRecordId, config, { resuming = false } = {}) {
  if (!Number.isSafeInteger(Number(runRecordId)) || Number(runRecordId) <= 0) throw new Error('任务编号无效')
  fs.mkdirSync(folder, { recursive: true })
  const filePath = path.join(folder, Number(runRecordId) + '.json')
  const snapshot = jobConfigSnapshot(config)
  if (resuming && fs.existsSync(filePath)) {
    const previous = readTaskConfigSnapshot(filePath)
    if ((previous['boss.json'].autoChatRunMode || 'chat') !== (snapshot['boss.json'].autoChatRunMode || 'chat'))
      throw new Error('恢复任务不能切换收集或打招呼方式，请新建任务')
  }
  writeJsonAtomicSync(filePath, { version: 1, config: snapshot })
  return filePath
}
