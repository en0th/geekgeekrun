import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

// Freeze job settings, never cookies/API keys. Every restart of a queued worker uses this file.
const bossKeys = [
  'combineRecommendJobFilterType', 'anyCombineRecommendJobFilter', 'staticCombineRecommendJobFilterConditions',
  'isSkipEmptyConditionForCombineRecommendJobFilter', 'expectJobRegExpStr', 'expectJobNameRegExpStr',
  'expectJobTypeRegExpStr', 'expectJobDescRegExpStr', 'jobDetailRegExpMatchLogic', 'jobNotMatchStrategy',
  'expectCityList', 'expectCityNotMatchStrategy', 'strategyScopeOptionWhenMarkJobCityNotMatch',
  'expectSalaryCalculateWay', 'expectSalaryLow', 'expectSalaryHigh', 'expectSalaryNotMatchStrategy',
  'strategyScopeOptionWhenMarkSalaryNotMatch', 'expectWorkExpList', 'expectWorkExpNotMatchStrategy',
  'strategyScopeOptionWhenMarkJobWorkExpNotMatch', 'isPosterHrFilterEnabled', 'posterHrTitleRegExpStr',
  'posterHrNotMatchStrategy', 'blockCompanyNameRegExpStr', 'blockCompanyNameRegMatchStrategy',
  'markAsNotActiveSelectedTimeRange', 'jobNotActiveStrategy', 'fieldsForUseCommonConfig', 'jobSourceList',
  'autoChatRunMode', 'collectOnlyMatchingJobs', 'skipUnparseableSalaryJob', 'autoChatPerSourceSuccessLimit',
  'autoChatNoMatchStreakLimit', 'jobListLoadWaitSeconds', 'jobDetailViewWaitSeconds',
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
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (data.version !== 1 || !data.config?.['boss.json'] || !data.config?.['common-job-condition-config.json'] || !Array.isArray(data.config?.['target-company-list.json']))
    throw new Error('任务配置快照无效，请重新创建任务')
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
  const temporary = filePath + '.' + randomUUID() + '.tmp'
  fs.writeFileSync(temporary, JSON.stringify({ version: 1, config: snapshot }))
  fs.renameSync(temporary, filePath)
  return filePath
}
