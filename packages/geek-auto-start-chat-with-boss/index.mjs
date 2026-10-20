import {
  sleep,
  sleepWithRandomDelay
} from '@geekgeekrun/utils/sleep.mjs'

import fs from 'node:fs'
import os from 'node:os'
import { get__dirname } from '@geekgeekrun/utils/legacy-path.mjs';
import path from 'node:path';
import JSON5 from 'json5'
import { EventEmitter } from 'node:events'
import { setDomainLocalStorage } from '@geekgeekrun/utils/puppeteer/local-storage.mjs'

import { readConfigFile, writeStorageFile, writeBossSession, ensureConfigFileExist, readStorageFile, ensureStorageFileExist, storageFilePath } from './runtime-file-utils.mjs'
import {
  countFilterCombinations,
  combineFiltersWithConstraintsGenerator,
  checkAnyCombineBossRecommendFilterHasCondition,
  formatStaticCombineFilters,
} from './combineCalculator.mjs'
import { default as jobFilterConditions } from './internal-config/job-filter-conditions-20241002.json' with { type: 'json' }
import { default as rawIndustryFilterExemption } from './internal-config/job-filter-industry-filter-exemption-20241002.json' with { type: 'json' }
import { ChatStartupFrom } from '@geekgeekrun/sqlite-plugin/dist/entity/ChatStartupLog.js'
import {
  MarkAsNotSuitReason,
  MarkAsNotSuitOp,
  StrategyScopeOptionWhenMarkJobNotMatch,
  SalaryCalculateWay,
  JobDetailRegExpMatchLogic,
  JobSource,
  CombineRecommendJobFilterType
} from '@geekgeekrun/sqlite-plugin/dist/enums.js'
import {
  activeDescList,
  RECOMMEND_JOB_ENTRY_SELECTOR,
  USER_SET_EXPECT_JOB_ENTRIES_SELECTOR,
  SEARCH_BOX_SELECTOR,
} from './constant.mjs'
import { parseSalaryDetails } from '@geekgeekrun/utils/job-values.cjs'
import { waitForSageTimeOrJustContinue } from './sage-time.mjs'
import cityGroupData from './cityGroup.mjs'
import {
  testIfPosterTitleSuit as testIfPosterTitleSuitByConfig,
  resolvePosterHrTitleRegExpStr,
} from './poster-title-filter.mjs'
import { normalizeExperienceSelections, matchesExperience, createJobDetailMatcher, matchesSalary, validateJobFilterConfig,
  normalizeRequiredJobConditions, requiredJobConditionReasons } from './job-filter-config.mjs'
import { missingJobFields, scopedMarkStrategy, ExpiringBlockSet, COOLDOWN_MS } from './job-safety.mjs'
import { NoMatchBatchGuard, loadNextJobBatch, openJobCardForReview, listSkipReason, describeListScope, assertCanGreet, activateSourceAndWait } from './auto-chat-navigation.mjs'
import { readRunSettings } from './run-settings.mjs'
import { isSecurityCheckUrl, waitForSecurityCheck } from './security-check.mjs'
import { classifyBossLoginResponse, bossLoginError } from '@geekgeekrun/utils/boss-login.mjs'
import { bindRunAccount } from './run-account.mjs'
import { applyJobNatureFilter } from './job-nature-filter.mjs'
import { watchJobResponses } from './boss-job-responses.mjs'
import { createRunBudget, budgetStateError } from './run-budget.mjs'
import { createBudgetStore } from './run-budget-store.mjs'
import { attachJobRequestBudget } from './job-request-budget.mjs'
import { isJsonStorageError } from '@geekgeekrun/utils/atomic-json.mjs'
import { normalizeJobSources, readSearchScope, searchPageMatches, searchRequestMatches,
  activateSearchSource, sourceFingerprintEntry, describeSearchSource } from './search-source.mjs'
import { applyCityFilter, normalizeCitySelection } from './city-filter.mjs'
import { launchTaskBrowser, showTaskBrowser } from './task-browser.mjs'
import { clickTaskElement } from './task-page-input.mjs'
import { closeOwnedBrowser } from './browser-cleanup.mjs'
import { applyPageFilters } from './page-filters.mjs'
const flattedCityList = []
;(cityGroupData?.zpData?.cityGroup ?? []).forEach(it => {
  const firstChar = it.firstChar
  it.cityList.forEach(city => {
    flattedCityList.push({
      ...city,
      firstChar
    })
  })
})

const jobFilterConditionsMapByCode = {}
Object.values(jobFilterConditions).forEach(arr => {
  arr.forEach(option => {
    jobFilterConditionsMapByCode[option.code] = option
  })
})

let industryFilterCursorIndex = 0;
const industryFilterExemption = JSON.parse(JSON.stringify(rawIndustryFilterExemption))
const industryFilterConditionsMapByIndex = {}
const industryFilterConditionsMapByCode = {}
const industryFilterConditionCodeToIndexMap = {}
industryFilterExemption.forEach(item => {
  if (!Array.isArray(item.subLevelModelList)) {
    return
  }
  item.subLevelModelList.forEach(option => {
    industryFilterConditionsMapByCode[option.code] = option
    industryFilterConditionsMapByIndex[industryFilterCursorIndex] = option
    industryFilterConditionCodeToIndexMap[option.code] = industryFilterCursorIndex
    industryFilterCursorIndex++
  })
})

ensureConfigFileExist()
ensureStorageFileExist()

const isUiDev = process.env.NODE_ENV === 'development'
export const autoStartChatEventBus = new EventEmitter()

/**
 * @type { import("puppeteer") }
 */
let puppeteer
let jobResponseMonitor = null
let jobRequestBudgetMonitor = null
const checkJobResponses = () => {
  runBudget?.assertTime()
  return jobResponseMonitor?.assertHealthy() ?? Promise.resolve()
}
const guardJobResponses = action => jobResponseMonitor ? jobResponseMonitor.guard(action) : action()
let StealthPlugin
let LaodengPlugin
let AnonymizeUaPlugin
export async function initPuppeteer () {
  // production
  const importResult = await Promise.all(
    [
      import('puppeteer-extra'),
      import('puppeteer-extra-plugin-stealth'),
      import('@geekgeekrun/puppeteer-extra-plugin-laodeng'),
      import('puppeteer-extra-plugin-anonymize-ua')
    ]
  )
  puppeteer = importResult[0].default
  StealthPlugin = importResult[1].default
  LaodengPlugin = importResult[2].default
  AnonymizeUaPlugin = importResult[3].default
  puppeteer.use(StealthPlugin())
  puppeteer.use(LaodengPlugin())
  puppeteer.use(AnonymizeUaPlugin({ makeWindows: false }))
  return {
    puppeteer,
    StealthPlugin,
    LaodengPlugin,
    AnonymizeUaPlugin
  }
}

const commonJobConditionConfig = readConfigFile('common-job-condition-config.json')
validateJobFilterConfig(readConfigFile('boss.json'))
const fieldsForUseCommonConfig = readConfigFile('boss.json').fieldsForUseCommonConfig ?? {}
const requiredJobConditions = normalizeRequiredJobConditions(
  (fieldsForUseCommonConfig.requiredConditions ? commonJobConditionConfig : readConfigFile('boss.json')).requiredJobConditions
)

const targetCompanyList = (
  !fieldsForUseCommonConfig.expectCompanies ?
    readConfigFile('target-company-list.json')
    :
    commonJobConditionConfig.expectCompanies
).filter(it => !!it.trim());
const combineRecommendJobFilterType = readConfigFile('boss.json').combineRecommendJobFilterType ?? CombineRecommendJobFilterType.ANY_COMBINE

const anyCombineRecommendJobFilter = readConfigFile('boss.json').anyCombineRecommendJobFilter
const staticCombineRecommendJobFilterConditions = readConfigFile('boss.json').staticCombineRecommendJobFilterConditions ?? []
let isSkipEmptyConditionForCombineRecommendJobFilter = readConfigFile('boss.json').isSkipEmptyConditionForCombineRecommendJobFilter
if (!checkAnyCombineBossRecommendFilterHasCondition(anyCombineRecommendJobFilter)) {
  isSkipEmptyConditionForCombineRecommendJobFilter = false
}
const expectJobRegExpStr = readConfigFile('boss.json').expectJobRegExpStr
const jobNotMatchStrategy = readConfigFile('boss.json').jobNotMatchStrategy ?? MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_BOSS

const expectCityNotMatchStrategy = readConfigFile('boss.json').expectCityNotMatchStrategy ?? MarkAsNotSuitOp.NO_OP
const expectCityList = normalizeCitySelection(
  !fieldsForUseCommonConfig.city ?
    readConfigFile('boss.json').expectCityList
    :
    commonJobConditionConfig.expectCityList
)

const strategyScopeOptionWhenMarkJobCityNotMatch = readConfigFile('boss.json').strategyScopeOptionWhenMarkJobCityNotMatch ?? StrategyScopeOptionWhenMarkJobNotMatch.ONLY_COMPANY_MATCHED_JOB

// salary
const salaryAmount = value => value == null || value === '' ? null : Number(value)
const expectSalaryLow = salaryAmount(
  !fieldsForUseCommonConfig.salary ? 
    readConfigFile('boss.json').expectSalaryLow
    :
    commonJobConditionConfig.expectSalaryLow
)
const expectSalaryHigh = salaryAmount(
  !fieldsForUseCommonConfig.salary ? 
    readConfigFile('boss.json').expectSalaryHigh
    :
    commonJobConditionConfig.expectSalaryHigh
)
const expectSalaryCalculateWay = (
  !fieldsForUseCommonConfig.salary ?
    readConfigFile('boss.json').expectSalaryCalculateWay
    :
    commonJobConditionConfig.expectSalaryCalculateWay
) ?? SalaryCalculateWay.MONTH_SALARY
const expectSalaryNotMatchStrategy = readConfigFile('boss.json').expectSalaryNotMatchStrategy ?? MarkAsNotSuitOp.NO_OP
const isSalaryFilterEnabled = expectSalaryLow != null || expectSalaryHigh != null
const strategyScopeOptionWhenMarkSalaryNotMatch = readConfigFile('boss.json').strategyScopeOptionWhenMarkSalaryNotMatch ?? StrategyScopeOptionWhenMarkJobNotMatch.ONLY_COMPANY_MATCHED_JOB

// work exp
const expectWorkExpList = normalizeExperienceSelections(readConfigFile('boss.json').expectWorkExpList ?? [])

const expectWorkExpNotMatchStrategy = readConfigFile('boss.json').expectWorkExpNotMatchStrategy ?? MarkAsNotSuitOp.NO_OP
const strategyScopeOptionWhenMarkJobWorkExpNotMatch = readConfigFile('boss.json').strategyScopeOptionWhenMarkJobWorkExpNotMatch ?? StrategyScopeOptionWhenMarkJobNotMatch.ONLY_COMPANY_MATCHED_JOB

let jobDetailRegExpMatchLogic = (
  !fieldsForUseCommonConfig.jobDetail ?
    readConfigFile('boss.json').jobDetailRegExpMatchLogic
    :
    commonJobConditionConfig.jobDetailRegExpMatchLogic
) ?? JobDetailRegExpMatchLogic.EVERY

const markAsNotActiveSelectedTimeRange = (() => {
  let n = readConfigFile('boss.json').markAsNotActiveSelectedTimeRange
  if (
    typeof n !== 'number' || isNaN(parseInt(n)) || n >= activeDescList.length || n < 0
  ) {
    n = 7
  }
  return n
})()
const jobNotActiveStrategy = (() => {
  let value = readConfigFile('boss.json').jobNotActiveStrategy ?? MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_BOSS
  if (markAsNotActiveSelectedTimeRange === 0) {
    value = MarkAsNotSuitOp.NO_OP
  }
  return value
})()

let {
  expectJobNameRegExpStr,
  expectJobTypeRegExpStr,
  expectJobDescRegExpStr,
  isPosterHrFilterEnabled,
  posterHrTitleRegExpStr,
} = !fieldsForUseCommonConfig.jobDetail ? readConfigFile('boss.json') : commonJobConditionConfig
if (
  !fieldsForUseCommonConfig.jobDetail &&
  expectJobRegExpStr &&
  !expectJobNameRegExpStr &&
  !expectJobTypeRegExpStr &&
  !expectJobDescRegExpStr
) {
  expectJobNameRegExpStr = expectJobRegExpStr
  expectJobTypeRegExpStr = expectJobRegExpStr
  expectJobDescRegExpStr = expectJobRegExpStr
}

if (
  [
    expectJobNameRegExpStr,
    expectJobTypeRegExpStr,
    expectJobDescRegExpStr,
  ].map(it => Boolean(it?.trim())).every(it => !it)
) {
  jobDetailRegExpMatchLogic = JobDetailRegExpMatchLogic.EVERY
}
const posterHrNotMatchStrategy = readConfigFile('boss.json').posterHrNotMatchStrategy ?? MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_LOCAL
const {
  runMode,
  runInBackground,
  collectOnlyMatchingJobs,
  skipUnparseableSalaryJob,
  perSourceSuccessLimit,
  noMatchStreakLimit,
  filterCombinationLimit,
  jobListLoadWaitSeconds,
  jobDetailViewWaitSeconds
} = readRunSettings(readConfigFile('boss.json'))
// collect mode saves job details only: no chat and no not-suit marks, on BOSS or locally
const isCollectMode = runMode === 'collect'
// collect everything the sources show, without applying the job conditions
const isCollectAll = isCollectMode && !collectOnlyMatchingJobs

let {
  jobSourceList
} = readConfigFile('boss.json')
const normalizedJobSource = normalizeJobSources(jobSourceList)
if (!normalizedJobSource?.length) {
  normalizedJobSource.push({
    type: 'expect'
  })
}
const localStoragePageUrl = `https://www.zhipin.com/desktop/`
const recommendJobPageUrl = `https://www.zhipin.com/web/geek/jobs`

const expectCompanySet = new Set(targetCompanyList)
const enableCompanyAllowList = Boolean(expectCompanySet.size)
const blockCompanyNameRegExpStr = (
  !fieldsForUseCommonConfig.blockCompanyNameRegExpStr ?
    readConfigFile('boss.json').blockCompanyNameRegExpStr
    :
    commonJobConditionConfig.blockCompanyNameRegExpStr
) ?? ''
const blockCompanyNameRegExp = (() => {
  if (!blockCompanyNameRegExpStr?.trim()) {
    return null
  }
  try {
    return new RegExp(blockCompanyNameRegExpStr, 'im')
  }
  catch {
    return null
  }
})()
const blockCompanyNameRegMatchStrategy = readConfigFile('boss.json').blockCompanyNameRegMatchStrategy ?? MarkAsNotSuitOp.NO_OP

/**
 * @type { import('puppeteer').Browser }
 */
let browser
/**
 * @type { import('puppeteer').Page }
 */
let page
let browserClosing = null
let browserOpening = null

const blockBossNotNewChat = new Set()
const blockBossNotActive = new ExpiringBlockSet()
const blockJobNotSuit = new ExpiringBlockSet()

// where the run is among its sources and BOSS page filter combinations; a run restarted after a
// security check, or continued by the user, picks up here instead of starting over
let runPosition = { sourceIndex: 0, filterConditionIndex: 0, fingerprint: '' }
let runBudget = null
let pendingBudgetSeed = null
let legacyBudgetSeed = false
let runAccountId = null
let pendingResume = null
// source rotation counters, reset whenever the run moves to the next source
let sourceSuccessCount = 0
let noMatchStreak = 0
// a rotation trigger fired inside the job-finding promise: leave this source, use the next one
const ROTATE_NEXT_SOURCE_ERROR = 'GGR_ROTATE_NEXT_SOURCE'
function resetSourceRotationCounters () {
  sourceSuccessCount = 0
  noMatchStreak = 0
}
function hasReachedSourceRotationLimit () {
  return (perSourceSuccessLimit > 0 && sourceSuccessCount >= perSourceSuccessLimit) ||
    (noMatchStreakLimit > 0 && noMatchStreak >= noMatchStreakLimit)
}
function sourceLabel (source) {
  if (source?.type === 'search') return `搜索${describeSearchSource(source)}`
  if (source?.type === 'recommend') return '推荐职位'
  if (source?.type === 'expect') return '求职期望推荐'
  return '当前来源'
}
/**
 * Count one collected / greeted job on the current source. Returns true when the per-source
 * success limit is reached and the run must rotate to the next source.
 */
function countSourceSuccess () {
  sourceSuccessCount++
  noMatchStreak = 0
  return perSourceSuccessLimit > 0 && sourceSuccessCount >= perSourceSuccessLimit
}
/**
 * Count one checked job that did not match. Returns true when the no-match streak reaches
 * the limit and the run must rotate to the next source.
 */
function countSourceNoMatch () {
  noMatchStreak++
  return noMatchStreakLimit > 0 && noMatchStreak >= noMatchStreakLimit
}
const blockEntries = (set) =>
  [...set].map((value) => [value, set.deadlines?.get(value) ?? null])
/** what a later run needs to go on from here */
export function exportRunState () {
  return {
    accountId: runAccountId,
    budget: runBudget?.snapshot() ?? pendingBudgetSeed,
    // A depleted budget can stop a resumed worker before it reaches the source loop.
    // Keep its imported cursor until that loop has actually consumed it.
    position: pendingResume ? { ...pendingResume } : { ...runPosition, sourceSuccessCount, noMatchStreak },
    blockedJobs: blockEntries(blockJobNotSuit),
    blockedBossesNotActive: blockEntries(blockBossNotActive),
    blockedBossesNotNewChat: [...blockBossNotNewChat]
  }
}
/**
 * Go on from a saved state. skipCurrentFilter starts after the saved filter combination,
 * e.g. when the run stopped because that combination had nothing usable.
 */
export function importRunState (state, { skipCurrentFilter = false } = {}) {
  if (!state) return
  pendingBudgetSeed = state.budget ?? null
  legacyBudgetSeed = !state.budget
  runAccountId = typeof state.accountId === 'string' && state.accountId.trim() ? state.accountId.trim() : null
  blockJobNotSuit.clear()
  blockBossNotActive.clear()
  blockBossNotNewChat.clear()
  const restore = (set, entries) => {
    for (const [value, deadline] of entries ?? []) {
      if (deadline) set.setExpiry(value, deadline)
      else set.add(value)
    }
  }
  // Old snapshots did not record an account: their block lists cannot safely be reused.
  if (runAccountId) {
    restore(blockJobNotSuit, state.blockedJobs)
    restore(blockBossNotActive, state.blockedBossesNotActive)
    for (const value of state.blockedBossesNotNewChat ?? []) blockBossNotNewChat.add(value)
  }
  if (state.position) {
    pendingResume = {
      ...state.position,
      filterConditionIndex: state.position.filterConditionIndex + (skipCurrentFilter ? 1 : 0)
    }
  }
}
/** the next mainLoop in this process goes on where this one was */
export function resumeFromCurrentPosition () {
  pendingResume = { ...runPosition, sourceSuccessCount, noMatchStreak }
}

function ensureRunBudget () {
  if (runBudget) return runBudget
  const args = process.argv.slice(2)
  const inlineId = args.find(arg => arg.startsWith('--run-record-id='))
  const separateId = args.indexOf('--run-record-id')
  const rawId = inlineId ? inlineId.slice('--run-record-id='.length) : separateId >= 0 ? args[separateId + 1] : 0
  const store = createBudgetStore(storageFilePath, rawId)
  const saved = store.load()
  if (Number(rawId) > 0 && pendingBudgetSeed && !saved)
    throw budgetStateError('该任务的预算台账缺失，请恢复完整的数据目录；为避免少算用量，任务已暂停')
  runBudget = createRunBudget({ limits: readRunSettings(readConfigFile('boss.json')).runBudget,
    saved, seed: pendingBudgetSeed, legacy: legacyBudgetSeed, persist: state => store.save(state),
    onUpdate: budget => autoStartChatEventBus.emit('RUN_BUDGET', budget) })
  process.once('exit', () => { try { runBudget.pause() } catch { /* failed state is already reported */ } })
  return runBudget
}

export function pauseRunBudget () { runBudget?.pause() }
export function resumeRunBudget () { runBudget?.resume() }
export function runBudgetStatus () { return runBudget?.snapshot() ?? pendingBudgetSeed }

async function markJobAsNotSuitInRecommendPage (reasonCode) {
  await checkJobResponses()
  /**
   * @type {{chosenReasonInUi?: { code: number, text: string}}}
   */
  const result = {}
  const notSuitableFeedbackButtonProxy = await page.$('.job-detail-box .job-detail-operate .not-suitable')
  if (notSuitableFeedbackButtonProxy) {
    await notSuitableFeedbackButtonProxy.evaluate(el => {
      el.scrollIntoView({
        block: 'center'
      })
    })
    await sleep(200)
    await clickTaskElement(page, notSuitableFeedbackButtonProxy)
    const rawReasonResData = (await (await page.waitForResponse(
      response => {
        if (
          response.url().startsWith('https://www.zhipin.com/wapi/zpgeek/negativefeedback/reasons.json')
        ) {
          return true
        }
        return false
      }
    )).json())?.zpData?.result ?? [];
    const reasonCodeToTextMap = await readStorageFile('job-not-suit-reason-code-to-text-cache.json')
    for(const it of rawReasonResData) {
      reasonCodeToTextMap[it.code] = it.text?.content ?? ''
    }
    await writeStorageFile('job-not-suit-reason-code-to-text-cache.json', reasonCodeToTextMap)
    await sleepWithRandomDelay(2000)
    const chooseReasonDialogProxy = await(async() => {
      const alls = await page.$$('.zp-dialog-wrap.zp-feedback-dialog')
      return alls?.[alls.length - 1]
    })()
    let isOptionChosen = false
    if (chooseReasonDialogProxy) {
      switch (reasonCode) {
        case MarkAsNotSuitReason.COMPANY_NAME_NOT_SUIT: {
          const opProxy = (await chooseReasonDialogProxy.$(`.zp-type-item[title*="公司"]`))
            ?? (await chooseReasonDialogProxy.$(`.zp-type-item[title="面试过/入职过"]`))
            ?? (await chooseReasonDialogProxy.$(`.zp-type-item[title="重复推荐"]`))
            ?? (await chooseReasonDialogProxy.$(`.zp-type-item[title*="距离"]`))
            ?? (await chooseReasonDialogProxy.$(`.zp-type-item[title*="薪资"]`))
          if (opProxy) {
            await clickTaskElement(page, opProxy)
            isOptionChosen = true
          }
          break
        }
        case MarkAsNotSuitReason.BOSS_INACTIVE: {
          const opProxy = (await chooseReasonDialogProxy.$(`.zp-type-item[title="BOSS活跃度低"]`))
            ?? (await chooseReasonDialogProxy.$(`.zp-type-item[title="职位停招/招满"]`))
            ?? (await chooseReasonDialogProxy.$(`.zp-type-item[title="面试过/入职过"]`))
            ?? (await chooseReasonDialogProxy.$(`.zp-type-item[title="重复推荐"]`))
          if (opProxy) {
            await clickTaskElement(page, opProxy)
            isOptionChosen = true
          }
          break
        }
        case MarkAsNotSuitReason.JOB_WORK_EXP_NOT_SUIT:
        case MarkAsNotSuitReason.JOB_CITY_NOT_SUIT: {
          const opProxy = (await chooseReasonDialogProxy.$(`.zp-type-item[title$="城市"]`))
            ?? (await chooseReasonDialogProxy.$(`.zp-type-item[title*="距离"]`))
            ?? (await chooseReasonDialogProxy.$(`.zp-type-item[title*="公司"]`))
            ?? (await chooseReasonDialogProxy.$(`.zp-type-item[title="面试过/入职过"]`))
            ?? (await chooseReasonDialogProxy.$(`.zp-type-item[title="重复推荐"]`))
          if (opProxy) {
            await clickTaskElement(page, opProxy)
            isOptionChosen = true
          }
          break
        }
        case MarkAsNotSuitReason.JOB_SALARY_NOT_SUIT: {
          const opProxy = (await chooseReasonDialogProxy.$(`.zp-type-item[title*="薪资"]`))
            ?? (await chooseReasonDialogProxy.$(`.zp-type-item[title$="城市"]`))
            ?? (await chooseReasonDialogProxy.$(`.zp-type-item[title*="距离"]`))
            ?? (await chooseReasonDialogProxy.$(`.zp-type-item[title*="公司"]`))
            ?? (await chooseReasonDialogProxy.$(`.zp-type-item[title="面试过/入职过"]`))
            ?? (await chooseReasonDialogProxy.$(`.zp-type-item[title="重复推荐"]`))
          if (opProxy) {
            await clickTaskElement(page, opProxy)
            isOptionChosen = true
          }
          break
        }
        case MarkAsNotSuitReason.JOB_NOT_SUIT:
        default: {
          const opProxy = (await chooseReasonDialogProxy.$(`.zp-type-item[title$="职位"]`))
            ?? (await chooseReasonDialogProxy.$(`.zp-type-item[title="面试过/入职过"]`))
            ?? (await chooseReasonDialogProxy.$(`.zp-type-item[title="重复推荐"]`))
          if (opProxy) {
            await clickTaskElement(page, opProxy)
            isOptionChosen = true
          }
          break
        }
      }

      if (isOptionChosen) {
        await sleepWithRandomDelay(1500)
        const confirmButtonProxy = await chooseReasonDialogProxy.$(`.zp-dialog-footer .zp-btn.zp-btn-sure`)
        await clickTaskElement(page, confirmButtonProxy)
        const response = await page.waitForResponse(
          response => {
            if (
              response.url().startsWith('https://www.zhipin.com/wapi/zpgeek/negativefeedback/save.json')
            ) {
              return true
            }
            return false
          }
        )
        /**
         * scene=4&code=41&feedbackReason=&securityId=
         */
        const requestBody = response.request().postData()
        const chosenCode = Number(new URLSearchParams(requestBody).get('code'))
        if (chosenCode) {
          result.chosenReasonInUi = {
            code: chosenCode,
            text: reasonCodeToTextMap[chosenCode]
          }
        }
      } else {
        const cancelButtonProxy = await chooseReasonDialogProxy.$(`.zp-close`)
        await clickTaskElement(page, cancelButtonProxy)
      }

      await sleepWithRandomDelay(2500)
    }
  }
  return result
}

export function testIfPosterTitleSuit (bossInfo) {
  return testIfPosterTitleSuitByConfig(bossInfo, {
    isPosterHrFilterEnabled,
    posterHrTitleRegExpStr,
  })
}

export function testIfJobTitleOrDescriptionSuit (jobInfo, matchLogic) {
  return createJobDetailMatcher({ expectJobNameRegExpStr, expectJobTypeRegExpStr, expectJobDescRegExpStr }, matchLogic)(jobInfo)
}

async function setFilterCondition (selectedFilters) {
  const {
    cityList = [],
    salaryList = [],
    experienceList = [],
    degreeList = [],
    scaleList = [],
    industryList = []
  } = selectedFilters

  const placeholderTexts = ['城市', '薪资待遇', '工作经验', '学历要求', '公司行业', '公司规模']
  const conditionArr = [cityList, salaryList, experienceList, degreeList, industryList, scaleList]

  console.log('current filter condition----')
  for (let i = 0; i < placeholderTexts.length; i++) {
    const text = placeholderTexts[i]
    const condition = conditionArr[i]
    console.log(`${text}：`, condition.length === 0 ? '不限' : condition.map(code => {
      if (text === '公司行业') {
        return industryFilterConditionsMapByCode[code]?.name ?? code
      } else {
        return jobFilterConditionsMapByCode[code]?.name ?? code
      }
    }).join('，'))
  }
  console.log('----------------------------')
  await applyCityFilter(page, cityList, { cityCatalog: flattedCityList })
  await applyPageFilters(page, selectedFilters, {
    catalogs: { ...jobFilterConditions, industryList: Object.values(industryFilterConditionsMapByCode) },
    checkResponses: checkJobResponses,
    onApplied: filters => autoStartChatEventBus.emit('PAGE_FILTERS_APPLIED', { filters }),
    onFailure: data => autoStartChatEventBus.emit('PAGE_FILTER_NOT_APPLIED', data),
  })
  if (!isCollectAll && !await applyJobNatureFilter(page, requiredJobConditions.jobNatures))
    autoStartChatEventBus.emit('TASK_PROGRESS', { detail: '网页求职类型筛选未能确认，将按岗位明确给出的类型逐条核验' })

}

async function toRecommendPage (hooks) {
  let userInfoPromise = page.waitForResponse((response) => {
      if (response.url().startsWith('https://www.zhipin.com/wapi/zpuser/wap/getUserInfo.json')) {
        return true
      }
      return false
    }, { timeout: 30 * 1000 }).then(async (res) => ({
      body: await res.json().catch(() => null), httpStatus: res.status()
    })).catch(() => ({ body: null, httpStatus: 0 }))
  page.goto(recommendJobPageUrl, { timeout: 1 * 1000 }).catch(e => { void e })
  await sleep(3000)
  await page.waitForFunction(() => {
    return document.readyState === 'complete'
  }, { timeout: 30 * 1000, polling: 100 }).catch(() => {
    throw bossLoginError({ status: 'unknown', detail: 'BOSS页面未能完成加载，凭证已保留；请检查网络或在浏览器中完成验证' })
  })
  if (isSecurityCheckUrl(page.url())) {
    throw new Error('AUTO_CHAT_SECURITY_CHECK')
  }
  if (
    page.url().startsWith('https://www.zhipin.com/web/common/403.html') ||
    page.url().startsWith('https://www.zhipin.com/web/common/error.html')
  ) {
    throw new Error("ACCESS_IS_DENIED")
  }

  // A login redirect cannot become a job page until authentication succeeds.
  // Classify it before waiting for the job-page URL, otherwise it stalls and restarts.
  const loginRedirect = /^https:\/\/www\.zhipin\.com\/web\/user\/(?:[?#]|$)/.test(page.url())
  const { body: userInfoResponse, httpStatus } = loginRedirect
    ? { body: { code: 7, message: 'BOSS要求重新登录' }, httpStatus: 401 }
    : await userInfoPromise
  const loginResult = classifyBossLoginResponse(httpStatus, userInfoResponse)
  if (loginResult.status !== 'valid' && loginResult.status !== 'invalid')
    throw bossLoginError(loginResult)
  if (loginResult.status === 'valid') {
    await page.waitForFunction(({ recommendJobPageUrl }) => {
      return location.href.startsWith(recommendJobPageUrl) && document.readyState === 'complete'
    }, { timeout: 30 * 1000, polling: 100 }, { recommendJobPageUrl }).catch(() => {
      throw bossLoginError({ status: 'unknown', detail: '登录后未能确认岗位页面，凭证已保留；请在BOSS检查页面后恢复任务' })
    })
    runAccountId = bindRunAccount(runAccountId, userInfoResponse.zpData.encryptUserId)
  }
  hooks.pageLoaded?.call()
  await hooks.userInfoResponse?.promise({ userInfoResponse, browser, httpStatus })
  if (loginResult.status !== 'valid') {
    autoStartChatEventBus.emit('LOGIN_STATUS_INVALID', {
      userInfoResponse
    })
    await writeStorageFile('boss-cookies.json', [])
    throw new Error("LOGIN_STATUS_INVALID")
  } else {
    await storeStorage(page)
  }

  const computedSourceList = []
  await checkJobResponses()
  for (const source of normalizedJobSource) {
    switch (source.type) {
      case 'recommend': {
        computedSourceList.push({
          type: source.type,
          selector: RECOMMEND_JOB_ENTRY_SELECTOR,
          async getIsCurrentActiveSource () {
            return await page.evaluate(
              ({ RECOMMEND_JOB_ENTRY_SELECTOR }) => {
                return !!document.querySelector(RECOMMEND_JOB_ENTRY_SELECTOR)?.classList.contains('active')
              }, {
                RECOMMEND_JOB_ENTRY_SELECTOR
              }
            )
          },
          async setToActiveSource() {
            // not first navigation and should choose a job (except job)
            // click first expect job
            const expectJobTabHandler = await page.$(RECOMMEND_JOB_ENTRY_SELECTOR)
            await clickTaskElement(page, expectJobTabHandler) // switch to first condition
          }
        })
        continue
      }
      case 'expect': {
        await page.waitForSelector('.c-expect-select')
        // an account without any 求职期望 on BOSS has nothing to pick here; waiting for an
        // entry would time out and restart the browser over and over
        await page.waitForSelector(USER_SET_EXPECT_JOB_ENTRIES_SELECTOR, { timeout: 8 * 1000 }).catch(() => null)
        const allExpectJobEntryHandles = await page.$$(USER_SET_EXPECT_JOB_ENTRIES_SELECTOR)
        if (!allExpectJobEntryHandles.length) {
          console.log('no 求职期望 on this BOSS account, skipping the expect job source')
          autoStartChatEventBus.emit('TASK_PROGRESS', { detail: 'BOSS账号未设置求职期望，已跳过“按求职期望推荐”来源' })
          break
        }
        allExpectJobEntryHandles.forEach((it, index) => {
          computedSourceList.push({
            type: source.type,
            selector: `${USER_SET_EXPECT_JOB_ENTRIES_SELECTOR}:nth-child(${index + 1})`,
            async getIsCurrentActiveSource () {
              return await page.evaluate(
                ({
                  USER_SET_EXPECT_JOB_ENTRIES_SELECTOR,
                  index
                }) => {
                  return !!document.querySelector(`${USER_SET_EXPECT_JOB_ENTRIES_SELECTOR}:nth-child(${index + 1})`)?.classList.contains('active')
                }, {
                  USER_SET_EXPECT_JOB_ENTRIES_SELECTOR,
                  index
                }
              )
            },
            async setToActiveSource() {
              // not first navigation and should choose a job (except job)
              // click first expect job
              const expectJobTabHandler = await page.$(`${USER_SET_EXPECT_JOB_ENTRIES_SELECTOR}:nth-child(${index + 1})`)
              await clickTaskElement(page, expectJobTabHandler) // switch to first condition
            }
          })
        })
        break
      }
      case 'search': {
        computedSourceList.push({
          type: source.type,
          keyword: source.keyword,
          positionCodes: source.positionCodes,
          confirmed: false,
          async getIsCurrentActiveSource () {
            const scope = await readSearchScope(page)
            return this.confirmed && scope ? searchPageMatches(scope, source) : false
          },
          async setToActiveSource() {
            await activateSearchSource(page, source, SEARCH_BOX_SELECTOR)
          }
        })
      }
    }
  }
  if (!computedSourceList.length) {
    // e.g. only the expect source is enabled and the account has no 求职期望
    throw new Error('AUTO_CHAT_NO_USABLE_SOURCE')
  }


  // the same sources and filter settings as the saved position, or it means nothing
  const positionFingerprint = JSON.stringify([
    computedSourceList.map(sourceFingerprintEntry),
    combineRecommendJobFilterType,
    staticCombineRecommendJobFilterConditions,
    anyCombineRecommendJobFilter,
    ...(combineRecommendJobFilterType === CombineRecommendJobFilterType.ANY_COMBINE
      ? [{ scheduleVersion: 2, filterCombinationLimit, skipEmpty: isSkipEmptyConditionForCombineRecommendJobFilter }]
      : [])
  ])
  const resumeFrom = pendingResume?.fingerprint === positionFingerprint &&
    Number.isInteger(pendingResume.sourceIndex) && pendingResume.sourceIndex >= 0 &&
    pendingResume.sourceIndex < computedSourceList.length ? pendingResume : null
  const savedCount = value => Number.isSafeInteger(value) && value >= 0 ? value : 0
  sourceSuccessCount = savedCount(resumeFrom?.sourceSuccessCount)
  noMatchStreak = savedCount(resumeFrom?.noMatchStreak)
  let currentSourceIndex =
    resumeFrom && resumeFrom.sourceIndex < computedSourceList.length ? resumeFrom.sourceIndex : 0
  // filter combinations of the first source to pass over; past the last one, the next source
  let skipFilterConditions =
    resumeFrom && resumeFrom.sourceIndex === currentSourceIndex ? resumeFrom.filterConditionIndex : 0
  // Publish the validated cursor before the first browser wait. A stop in the
  // security-dialog/source setup window must retain its fingerprint as well as counts.
  runPosition = { sourceIndex: currentSourceIndex, filterConditionIndex: skipFilterConditions, fingerprint: positionFingerprint }
  pendingResume = null
  if (resumeFrom) {
    autoStartChatEventBus.emit('TASK_PROGRESS', { detail: '从上次的职位来源和筛选组合继续' })
  }
  afterPageLoad: while (true) {
    // check set security question tip modal
    let setSecurityQuestionTipModelProxy
    try {
      setSecurityQuestionTipModelProxy = await page.waitForSelector('.dialog-wrap.dialog-account-safe', { timeout: 3 * 1000 })
    }
    catch(err) {
      console.log(`cannot find set security question tip modal, just continue`)
    }
    if (
      setSecurityQuestionTipModelProxy
    ) {
      await sleep(1000)
      setSecurityQuestionTipModelProxy = await page.$('.dialog-wrap.dialog-account-safe')
      const closeButtonProxy = await setSecurityQuestionTipModelProxy?.$('.close')

      if (setSecurityQuestionTipModelProxy && closeButtonProxy) {
        await clickTaskElement(page, closeButtonProxy)
      }
    }

    const filterConditions =
      combineRecommendJobFilterType === CombineRecommendJobFilterType.STATIC_COMBINE
        ? formatStaticCombineFilters(staticCombineRecommendJobFilterConditions)
          : combineFiltersWithConstraintsGenerator(anyCombineRecommendJobFilter, {
            limit: filterCombinationLimit, skipEmpty: isSkipEmptyConditionForCombineRecommendJobFilter, preferSelected: true
          })
    const budgetApplies = combineRecommendJobFilterType === CombineRecommendJobFilterType.ANY_COMBINE &&
      countFilterCombinations(anyCombineRecommendJobFilter, isSkipEmptyConditionForCombineRecommendJobFilter).total > BigInt(filterCombinationLimit)
    if (budgetApplies) autoStartChatEventBus.emit('TASK_PROGRESS', {
      detail: `自动组合每个来源最多查看${filterCombinationLimit}种，优先已选条件；达到预算后换源`, state: 'searching'
    })
    let expectJobList
    let filterConditionIndex = -1
    iterateFilterCondition: for (
      const filterCondition of filterConditions
    ) {
      // A pause/yield can happen after the threshold was reached, before the source changed.
      if (hasReachedSourceRotationLimit()) break iterateFilterCondition
      filterConditionIndex++
      if (filterConditionIndex < skipFilterConditions) {
        continue iterateFilterCondition
      }
      runPosition = { sourceIndex: currentSourceIndex, filterConditionIndex, fingerprint: positionFingerprint }
      autoStartChatEventBus.emit('RUN_POSITION', { ...runPosition })
      console.log(`current filter condition index to apply: ${filterConditionIndex}`, JSON.stringify(filterCondition))
      findInCurrentFilterCondition: while(true) {
        await sleepWithRandomDelay(2500)

        await Promise.all([
          Promise.race([
            page.waitForSelector(USER_SET_EXPECT_JOB_ENTRIES_SELECTOR),
            page.waitForSelector(RECOMMEND_JOB_ENTRY_SELECTOR),
          ]),
          Promise.race([
            page.waitForSelector(".job-list-container .rec-job-list"),
            page.waitForSelector(".recommend-result-job .job-empty-wrapper")
          ])
        ])
        // await page.click(USER_SET_EXPECT_JOB_ENTRIES_SELECTOR)
        await sleep(3000)
        let onPageCurrentSourceIndex = -1
        for (let i=0; i < computedSourceList.length; i++) {
          const computedSource = computedSourceList[i]
          if (await computedSource.getIsCurrentActiveSource()) {
            onPageCurrentSourceIndex = i
            break
          }
        }
        expectJobList = await page.evaluate(`document.querySelector('.c-expect-select')?.__vue__?.expectList`)
        if (onPageCurrentSourceIndex === currentSourceIndex) {
          // first navigation and can immediately start chat (recommend job)
        } else {
          const source = computedSourceList[currentSourceIndex]
          jobResponseMonitor?.expectSearch()
          try {
            await guardJobResponses(() => activateSourceAndWait(page, () => source.setToActiveSource(), {
              matchesResponse: response => source.type === 'search'
                ? searchRequestMatches(response.request(), source)
                : response.url().startsWith('https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json')
            }))
            if (source.type === 'search') {
              source.confirmed = true
              jobResponseMonitor?.expectSearch(request => searchRequestMatches(request, source))
            }
          } catch (error) {
            await checkJobResponses()
            if (source.type === 'search' && error?.name === 'TimeoutError') {
              const failure = new Error('AUTO_CHAT_SEARCH_FILTER_NOT_APPLIED')
              failure.detail = '未能确认BOSS已应用搜索内容和平台职位类目，任务已暂停；请检查页面后恢复'
              throw failure
            }
            throw error
          }
          await checkJobResponses()
          await storeStorage(page)
          await sleepWithRandomDelay(2000)
          await waitForSageTimeOrJustContinue({
            tag: 'afterJobSourceChosen',
            hooks
          })
        }
        await sleepWithRandomDelay(1500)
        await setFilterCondition(filterCondition)
        await sleep(1500) // TODO: accurately check if job list request sent and response received after set condition
        await page.waitForFunction(() => {
          return !document.querySelector('.job-recommend-result .job-rec-loading')
        }, { polling: 100 })
        await checkJobResponses()
        try {
          // the greeting went out and the per-source success limit is reached: rotate below
          let chatSourceRotationDone = false
          const { targetJobIndex, targetJobData, matchedJobId } = await new Promise(async (resolve, reject) => {
            try {
              const searchGuard = new NoMatchBatchGuard()
              const listSkipReasons = new Map()
              // job list
              let  recommendJobListElProxy
              try {
                recommendJobListElProxy= await page.waitForSelector('.job-list-container .rec-job-list', { timeout: 5 * 1000 })
              } catch {}
              if (!recommendJobListElProxy){
                await hooks.encounterEmptyRecommendJobList?.promise({
                  pageQuery: await page.evaluate(() => new URL(location.href).searchParams.toString())
                })
                throw new Error('CANNOT_FIND_EXCEPT_JOB_IN_THIS_FILTER_CONDITION')
              }
              let jobListData = []
              async function updateJobListData () {
                jobListData = await page.evaluate(`document.querySelector('.page-jobs-main')?.__vue__?.jobList`)
                if (!Array.isArray(jobListData)) throw new Error('AUTO_CHAT_LIST_STALLED')
                for (const row of jobListData) {
                  if (isCollectAll) break
                  const salary = parseSalaryDetails(row.salaryDesc || '')
                  const unparseableSalary = salary.status !== 'parsed'
                  const reason = (skipUnparseableSalaryJob && unparseableSalary ? '薪资无法识别或面议' : '') || listSkipReason(row, {
                    cities: expectCityList, cityStrategy: expectCityNotMatchStrategy,
                    experiences: expectWorkExpList, experienceStrategy: expectWorkExpNotMatchStrategy,
                    salaryEnabled: !!isSalaryFilterEnabled, salaryStrategy: expectSalaryNotMatchStrategy,
                    salaryMatches: checkIfSalarySuit(row.salaryDesc || ''),
                    invalidSalary: unparseableSalary
                  })
                  if (reason) { blockJobNotSuit.add(row.encryptJobId); listSkipReasons.set(row.encryptJobId, reason) }
                }
                const listSummary = describeListScope(jobListData, {
                  allow: [...expectCompanySet], skipReasons: listSkipReasons,
                  blocked: row => blockJobNotSuit.has(row.encryptJobId) || blockBossNotNewChat.has(row.encryptBossId) || blockBossNotActive.has(row.encryptBossId)
                })
                autoStartChatEventBus.emit('TASK_PROGRESS', { detail: '按当前求职条件检查岗位', listSummary })

              }
              await updateJobListData()

              let hasReachLastPage = false
              let targetJobIndex = -1
              // the one job that passed every check; only this job may be greeted
              let matchedJobId = null
              let targetJobData, selectedJobData // they show be same; one is from list, another is from detail
              function checkIfSalarySuit(salaryDesc) {
                return matchesSalary(parseSalaryDetails(salaryDesc), { low: expectSalaryLow, high: expectSalaryHigh, unit: Number(expectSalaryCalculateWay) })
              }
              function getTempTargetJobIndexToCheckDetail () {
                // collecting everything: any job not handled yet this run or cooling down
                if (isCollectAll) return jobListData.findIndex(it => !blockJobNotSuit.has(it.encryptJobId))
                return jobListData.findIndex(it => {
                  return !blockBossNotNewChat.has(it.encryptBossId) &&
                    !blockBossNotActive.has(it.encryptBossId) &&
                    !blockJobNotSuit.has(it.encryptJobId) &&
                    (
                      (
                        enableCompanyAllowList ?
                          [...expectCompanySet].find(
                            name => it.brandName?.toLowerCase?.()?.includes(name.toLowerCase())
                          )
                          :
                          true
                      ) || (
                        // enter job detail to mark as not suit for city filter
                        (
                          Array.isArray(expectCityList) &&
                          expectCityList.length &&
                          [
                            MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_BOSS,
                            MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_LOCAL
                          ].includes(expectCityNotMatchStrategy) &&
                          strategyScopeOptionWhenMarkJobCityNotMatch === StrategyScopeOptionWhenMarkJobNotMatch.ALL_JOB
                        ) ? !expectCityList.includes(it.cityName) : false
                      ) || (
                        // enter job detail to mark as not suit for work exp filter
                        (
                          Array.isArray(expectWorkExpList) &&
                          expectWorkExpList.length &&
                          [
                            MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_BOSS,
                            MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_LOCAL
                          ].includes(expectWorkExpNotMatchStrategy) &&
                          strategyScopeOptionWhenMarkJobWorkExpNotMatch === StrategyScopeOptionWhenMarkJobNotMatch.ALL_JOB
                        ) ? !matchesExperience(expectWorkExpList, it.jobExperience) : false
                      ) || (
                        // enter job detail to mark as not suit for salary filter
                        (
                          isSalaryFilterEnabled &&
                          [
                            MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_BOSS,
                            MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_LOCAL
                          ].includes(expectSalaryNotMatchStrategy) &&
                          strategyScopeOptionWhenMarkSalaryNotMatch === StrategyScopeOptionWhenMarkJobNotMatch.ALL_JOB
                        ) ? !checkIfSalarySuit(it.salaryDesc) : false
                      ) || (
                        // enter job detail to mark as not suit for company name filter
                        !!blockCompanyNameRegExp &&
                        blockCompanyNameRegExp.test(it.brandName?.toLowerCase?.() ?? '') &&
                          [
                            MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_BOSS,
                            MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_LOCAL
                          ].includes(blockCompanyNameRegMatchStrategy)
                      )
                    )
                })
              }
              continueFind: while (targetJobIndex < 0 && !hasReachLastPage) {
                // between jobs: the task queue may ask this run to make way for a queued task
                runBudget?.checkpoint()
                await hooks.checkpoint?.promise()
                // when disable company allow list, we will believe that the first one in the list is your expect job.
                let tempTargetJobIndexToCheckDetail = getTempTargetJobIndexToCheckDetail()
                while (tempTargetJobIndexToCheckDetail < 0 && !hasReachLastPage) {
                  searchGuard.beforeLoad()
                  autoStartChatEventBus.emit('TASK_PROGRESS', { detail: `当前列表没有${isCollectMode ? '待收集' : '可沟通'}岗位，正在检查下一批；连续5批没有可处理的会换下一个来源`, state: 'searching' })
                  const nextBatch = await guardJobResponses(() => loadNextJobBatch({ page, list: recommendJobListElProxy, checkResponses: checkJobResponses }))
                  hasReachLastPage = !nextBatch.hasMore
                  searchGuard.loadedBatch()
                  await waitForSageTimeOrJustContinue({ tag: 'afterJobListPageFetched', hooks })
                  // user-adjustable pace; faster paging raises the risk of BOSS rate limiting
                  await sleep(jobListLoadWaitSeconds * 1000)
                  await updateJobListData()
                  tempTargetJobIndexToCheckDetail = getTempTargetJobIndexToCheckDetail()
                }

                if (tempTargetJobIndexToCheckDetail < 0 && hasReachLastPage) {
                  // has reach last page and not find target job
                  reject(new Error('CANNOT_FIND_EXCEPT_JOB_IN_THIS_FILTER_CONDITION'))
                  return
                }

                //#region here to check detail
                if (tempTargetJobIndexToCheckDetail >= 0) {
                  // scroll that target element into view
                  await page.evaluate(`
                    targetEl = document.querySelector("ul.rec-job-list").children[${tempTargetJobIndexToCheckDetail}]
                    targetEl.scrollIntoView({
                      behavior: 'smooth',
                      block: ${Math.random() > 0.5 ? '\'center\'' : '\'end\''}
                    })
                  `)

                  await sleepWithRandomDelay(200)
                  await sleep(500)
                  await openJobCardForReview({
                    page, list: recommendJobListElProxy, index: tempTargetJobIndexToCheckDetail,
                    jobId: jobListData[tempTargetJobIndexToCheckDetail]?.encryptJobId,
                    checkResponses: checkJobResponses
                  })
                  // sleepWithRandomDelay adds up to 1s on top, so the wait never looks fixed
                  await sleepWithRandomDelay(jobDetailViewWaitSeconds * 1000)
                  await waitForSageTimeOrJustContinue({
                    tag: 'afterJobDetailFetched',
                    hooks
                  })
                  await checkJobResponses()
                  targetJobData = await page.evaluate('document.querySelector(".job-detail-box").__vue__.data')
                  selectedJobData = await page.evaluate('document.querySelector(".page-jobs-main").__vue__.currentJob')
                  // save the job detail info
                  await hooks.jobDetailIsGetFromRecommendList?.promise(targetJobData)
                  autoStartChatEventBus.emit('TASK_PROGRESS', { kind: 'viewed', detail: '已查看岗位详情' })
                  if (isCollectAll) {
                    blockJobNotSuit.add(targetJobData.jobInfo.encryptId)
                    autoStartChatEventBus.emit('TASK_PROGRESS', { kind: 'collected', detail: '已保存岗位信息' })
                    searchGuard.reset()
                    if (countSourceSuccess()) {
                      autoStartChatEventBus.emit('TASK_PROGRESS', { detail: `本来源已保存 ${sourceSuccessCount} 个岗位，达到换源数量（${perSourceSuccessLimit}），切换下一个来源`, state: 'searching' })
                      reject(new Error(ROTATE_NEXT_SOURCE_ERROR))
                      return
                    }
                    continue continueFind
                  }
                  const parsedSalary = parseSalaryDetails(selectedJobData.salaryDesc || '')
                  const missing = missingJobFields({
                    jobName: targetJobData.jobInfo?.jobName,
                    jobTypeName: targetJobData.jobInfo?.positionName,
                    jobDescription: targetJobData.jobInfo?.postDescription,
                    cityName: selectedJobData.cityName, companyName: selectedJobData.brandName,
                    experienceName: selectedJobData.jobExperience, bossTitle: targetJobData.bossInfo?.title,
                    salaryLow: parsedSalary.low, salaryHigh: parsedSalary.high, salaryMonth: parsedSalary.month,
                    active: targetJobData.bossInfo?.activeTimeDesc
                  }, { title: !!expectJobNameRegExpStr?.trim(), category: !!expectJobTypeRegExpStr?.trim(),
                    description: !!expectJobDescRegExpStr?.trim(), city: !!expectCityList.length,
                    company: enableCompanyAllowList || !!blockCompanyNameRegExp, experience: !!expectWorkExpList.length,
                    hr: isPosterHrFilterEnabled, salary: !!isSalaryFilterEnabled })
                  missing.push(...requiredJobConditionReasons(targetJobData, requiredJobConditions))
                  if (missing.length) {
                    blockJobNotSuit.add(targetJobData.jobInfo.encryptId)
                    autoStartChatEventBus.emit('TASK_PROGRESS', { kind: 'skipped', detail: missing.join('；') + '，不发送、不标记' })
                    if (countSourceNoMatch()) {
                      autoStartChatEventBus.emit('TASK_PROGRESS', { detail: `连续 ${noMatchStreak} 个岗位不符合条件，达到止损数量（${noMatchStreakLimit}），切换下一个来源`, state: 'searching' })
                      reject(new Error(ROTATE_NEXT_SOURCE_ERROR))
                      return
                    }
                    continue continueFind
                  }

                  //#region collect not suit reasons
                  const notSuitReasonIdToStrategyMap = {}
                  const notSuitConditionHandleMap = {
                    async companyName() {
                      blockJobNotSuit.add(targetJobData.jobInfo.encryptId)
                      if (blockCompanyNameRegMatchStrategy === MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_LOCAL && !await page.$('.job-detail-box .job-detail-operate .not-suitable')) {
                        try {
                          await hooks.jobMarkedAsNotSuit.promise(
                            targetJobData,
                            {
                              markFrom: ChatStartupFrom.AutoFromRecommendList,
                              markReason: MarkAsNotSuitReason.COMPANY_NAME_NOT_SUIT,
                              extInfo: null,
                              markOp: MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_LOCAL,
                              jobSource: JobSource[computedSourceList[currentSourceIndex]?.type]
                            }
                          )
                        } catch {
                        }
                      }
                      else if (blockCompanyNameRegMatchStrategy === MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_BOSS) {
                        try {
                          await waitForSageTimeOrJustContinue({
                            tag: 'beforeJobNotSuitMarked',
                            hooks
                          })
                          const { chosenReasonInUi } = await markJobAsNotSuitInRecommendPage(MarkAsNotSuitReason.COMPANY_NAME_NOT_SUIT)
                          await hooks.jobMarkedAsNotSuit.promise(
                            targetJobData,
                            {
                              markFrom: ChatStartupFrom.AutoFromRecommendList,
                              markReason: MarkAsNotSuitReason.COMPANY_NAME_NOT_SUIT,
                              extInfo: {
                                chosenReasonInUi
                              },
                              markOp: MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_BOSS,
                              jobSource: JobSource[computedSourceList[currentSourceIndex]?.type]
                            }
                          )
                        } catch(err) {
                          console.log(`mark boss inactive failed`, err)
                        }
                      }
                    },
                    async active() {
                      blockBossNotActive.add(targetJobData.jobInfo.encryptUserId)
                      if (jobNotActiveStrategy === MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_LOCAL || !await page.$('.job-detail-box .job-detail-operate .not-suitable')) {
                        try {
                          await hooks.jobMarkedAsNotSuit.promise(
                            targetJobData,
                            {
                              markFrom: ChatStartupFrom.AutoFromRecommendList,
                              markReason: MarkAsNotSuitReason.BOSS_INACTIVE,
                              extInfo: null,
                              markOp: MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_LOCAL,
                              jobSource: JobSource[computedSourceList[currentSourceIndex]?.type]
                            }
                          )
                        } catch {
                        }
                      }
                      else if (jobNotActiveStrategy === MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_BOSS) {
                        try {
                          await waitForSageTimeOrJustContinue({
                            tag: 'beforeJobNotSuitMarked',
                            hooks
                          })
                          const { chosenReasonInUi } = await markJobAsNotSuitInRecommendPage(MarkAsNotSuitReason.BOSS_INACTIVE)
                          await hooks.jobMarkedAsNotSuit.promise(
                            targetJobData,
                            {
                              markFrom: ChatStartupFrom.AutoFromRecommendList,
                              markReason: MarkAsNotSuitReason.BOSS_INACTIVE,
                              extInfo: {
                                bossActiveTimeDesc: targetJobData.bossInfo.activeTimeDesc,
                                chosenReasonInUi
                              },
                              markOp: MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_BOSS,
                              jobSource: JobSource[computedSourceList[currentSourceIndex]?.type]
                            }
                          )
                        } catch(err) {
                          console.log(`mark boss inactive failed`, err)
                        }
                      }
                    },
                    async city() {
                      blockJobNotSuit.add(targetJobData.jobInfo.encryptId)
                      if (expectCityNotMatchStrategy === MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_LOCAL || !await page.$('.job-detail-box .job-detail-operate .not-suitable')) {
                        try {
                          await hooks.jobMarkedAsNotSuit.promise(
                            targetJobData,
                            {
                              markFrom: ChatStartupFrom.AutoFromRecommendList,
                              markReason: MarkAsNotSuitReason.JOB_CITY_NOT_SUIT,
                              extInfo: null,
                              markOp: MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_LOCAL,
                              jobSource: JobSource[computedSourceList[currentSourceIndex]?.type]
                            }
                          )
                        } catch {
                        }
                      }
                      else if (expectCityNotMatchStrategy === MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_BOSS) {
                        try {
                          await waitForSageTimeOrJustContinue({
                            tag: 'beforeJobNotSuitMarked',
                            hooks
                          })
                          const { chosenReasonInUi } = await markJobAsNotSuitInRecommendPage(MarkAsNotSuitReason.JOB_CITY_NOT_SUIT)
                          await hooks.jobMarkedAsNotSuit.promise(
                            targetJobData,
                            {
                              markFrom: ChatStartupFrom.AutoFromRecommendList,
                              markReason: MarkAsNotSuitReason.JOB_CITY_NOT_SUIT,
                              extInfo: {
                                chosenReasonInUi
                              },
                              markOp: MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_BOSS,
                              jobSource: JobSource[computedSourceList[currentSourceIndex]?.type]
                            }
                          )
                        } catch(err) {
                          console.log(`mark job city not suit failed`, err)
                        }
                      }
                    },
                    async workExp() {
                      blockJobNotSuit.add(targetJobData.jobInfo.encryptId)
                      if (expectWorkExpNotMatchStrategy === MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_LOCAL || !await page.$('.job-detail-box .job-detail-operate .not-suitable')) {
                        try {
                          await hooks.jobMarkedAsNotSuit.promise(
                            targetJobData,
                            {
                              markFrom: ChatStartupFrom.AutoFromRecommendList,
                              markReason: MarkAsNotSuitReason.JOB_WORK_EXP_NOT_SUIT,
                              extInfo: null,
                              markOp: MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_LOCAL,
                              jobSource: JobSource[computedSourceList[currentSourceIndex]?.type]
                            }
                          )
                        } catch {
                        }
                      }
                      else if (expectWorkExpNotMatchStrategy === MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_BOSS) {
                        try {
                          await waitForSageTimeOrJustContinue({
                            tag: 'beforeJobNotSuitMarked',
                            hooks
                          })
                          const { chosenReasonInUi } = await markJobAsNotSuitInRecommendPage(MarkAsNotSuitReason.JOB_WORK_EXP_NOT_SUIT)
                          await hooks.jobMarkedAsNotSuit.promise(
                            targetJobData,
                            {
                              markFrom: ChatStartupFrom.AutoFromRecommendList,
                              markReason: MarkAsNotSuitReason.JOB_WORK_EXP_NOT_SUIT,
                              extInfo: {
                                chosenReasonInUi
                              },
                              markOp: MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_BOSS,
                              jobSource: JobSource[computedSourceList[currentSourceIndex]?.type]
                            }
                          )
                        } catch(err) {
                          console.log(`mark job work exp not suit failed`, err)
                        }
                      }
                    },
                    async posterTitle() {
                      blockJobNotSuit.add(targetJobData.jobInfo.encryptId)
                      const extInfo = {
                        posterTitle: targetJobData.bossInfo?.title ?? null,
                        posterHrTitleRegExpStr: resolvePosterHrTitleRegExpStr(posterHrTitleRegExpStr),
                      }
                      if (posterHrNotMatchStrategy === MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_LOCAL || !await page.$('.job-detail-box .job-detail-operate .not-suitable')) {
                        try {
                          await hooks.jobMarkedAsNotSuit.promise(
                            targetJobData,
                            {
                              markFrom: ChatStartupFrom.AutoFromRecommendList,
                              markReason: MarkAsNotSuitReason.POSTER_TITLE_NOT_SUIT,
                              extInfo,
                              markOp: MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_LOCAL,
                              jobSource: JobSource[computedSourceList[currentSourceIndex]?.type]
                            }
                          )
                        } catch {
                        }
                      }
                      else if (posterHrNotMatchStrategy === MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_BOSS) {
                        try {
                          await waitForSageTimeOrJustContinue({
                            tag: 'beforeJobNotSuitMarked',
                            hooks
                          })
                          const { chosenReasonInUi } = await markJobAsNotSuitInRecommendPage(MarkAsNotSuitReason.POSTER_TITLE_NOT_SUIT)
                          await hooks.jobMarkedAsNotSuit.promise(
                            targetJobData,
                            {
                              markFrom: ChatStartupFrom.AutoFromRecommendList,
                              markReason: MarkAsNotSuitReason.POSTER_TITLE_NOT_SUIT,
                              extInfo: {
                                ...extInfo,
                                chosenReasonInUi
                              },
                              markOp: MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_BOSS,
                              jobSource: JobSource[computedSourceList[currentSourceIndex]?.type]
                            }
                          )
                        } catch(err) {
                          console.log(`mark poster title not suit failed`, err)
                        }
                      }
                    },
                    async jobDetail() {
                      blockJobNotSuit.add(targetJobData.jobInfo.encryptId)
                      if (jobNotMatchStrategy === MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_LOCAL || !await page.$('.job-detail-box .job-detail-operate .not-suitable')) {
                        try {
                          await hooks.jobMarkedAsNotSuit.promise(
                            targetJobData,
                            {
                              markFrom: ChatStartupFrom.AutoFromRecommendList,
                              markReason: MarkAsNotSuitReason.JOB_NOT_SUIT,
                              extInfo: null,
                              markOp: MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_LOCAL,
                              jobSource: JobSource[computedSourceList[currentSourceIndex]?.type]
                            }
                          )
                        } catch {
                        }
                      }
                      else if (jobNotMatchStrategy === MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_BOSS) {
                        try {
                          await waitForSageTimeOrJustContinue({
                            tag: 'beforeJobNotSuitMarked',
                            hooks
                          })
                          const { chosenReasonInUi } = await markJobAsNotSuitInRecommendPage(MarkAsNotSuitReason.JOB_NOT_SUIT)
                          await hooks.jobMarkedAsNotSuit.promise(
                            targetJobData,
                            {
                              markFrom: ChatStartupFrom.AutoFromRecommendList,
                              markReason: MarkAsNotSuitReason.JOB_NOT_SUIT,
                              extInfo: {
                                bossActiveTimeDesc: targetJobData.bossInfo.activeTimeDesc,
                                chosenReasonInUi
                              },
                              markOp: MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_BOSS,
                              jobSource: JobSource[computedSourceList[currentSourceIndex]?.type]
                            }
                          )
                        } catch(err) {
                          console.log(`mark job detail not suit failed`, err)
                        }
                      }
                    },
                    async salary() {
                      blockJobNotSuit.add(targetJobData.jobInfo.encryptId)
                      if (expectSalaryNotMatchStrategy === MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_LOCAL || !await page.$('.job-detail-box .job-detail-operate .not-suitable')) {
                        try {
                          await hooks.jobMarkedAsNotSuit.promise(
                            targetJobData,
                            {
                              markFrom: ChatStartupFrom.AutoFromRecommendList,
                              markReason: MarkAsNotSuitReason.JOB_SALARY_NOT_SUIT,
                              extInfo: {
                                salaryDesc: selectedJobData.salaryDesc,
                              },
                              markOp: MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_LOCAL,
                              jobSource: JobSource[computedSourceList[currentSourceIndex]?.type]
                            }
                          )
                        } catch {
                        }
                      }
                      else if (expectSalaryNotMatchStrategy === MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_BOSS) {
                        try {
                          await waitForSageTimeOrJustContinue({
                            tag: 'beforeJobNotSuitMarked',
                            hooks
                          })
                          const { chosenReasonInUi } = await markJobAsNotSuitInRecommendPage(MarkAsNotSuitReason.JOB_SALARY_NOT_SUIT)
                          await hooks.jobMarkedAsNotSuit.promise(
                            targetJobData,
                            {
                              markFrom: ChatStartupFrom.AutoFromRecommendList,
                              markReason: MarkAsNotSuitReason.JOB_SALARY_NOT_SUIT,
                              extInfo: {
                                salaryDesc: selectedJobData.salaryDesc,
                                chosenReasonInUi
                              },
                              markOp: MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_BOSS,
                              jobSource: JobSource[computedSourceList[currentSourceIndex]?.type]
                            }
                          )
                        } catch(err) {
                          console.log(`mark job salary not suit failed`, err)
                        }
                      }
                    }
                  }

                  if (
                    !!blockCompanyNameRegExp && blockCompanyNameRegExp.test(selectedJobData.brandName ?? '')
                  ) {
                    notSuitReasonIdToStrategyMap.companyName = blockCompanyNameRegMatchStrategy
                  }
                  //#region
                  // null
                  // 刚刚活跃 // 今日活跃 // 昨日活跃 // 3日内活跃 // 本周活跃 // 2周内活跃
                  // 本月活跃 // 2月内活跃 // 3月内活跃 // 4月内活跃 // 5月内活跃 // 近半年活跃 // 半年前活跃
                  //#endregion
                  let activeTimeDescForCompare = targetJobData.bossInfo.activeTimeDesc
                  // handle empty string case
                  if (activeTimeDescForCompare === '') {
                    activeTimeDescForCompare = '半年前活跃'
                  }
                  const indexOfActiveText = activeDescList.indexOf(activeTimeDescForCompare)
                  if (
                    markAsNotActiveSelectedTimeRange > 0 &&
                    indexOfActiveText > 0 && indexOfActiveText <= markAsNotActiveSelectedTimeRange
                  ) {
                    // click prevent recommend button
                    notSuitReasonIdToStrategyMap.active = jobNotActiveStrategy
                  }
                  if (
                    (Array.isArray(expectCityList) && expectCityList.length) && !expectCityList.includes(selectedJobData.cityName)
                  ) {
                    notSuitReasonIdToStrategyMap.city = expectCityNotMatchStrategy
                  }
                  if (
                    (Array.isArray(expectWorkExpList) && expectWorkExpList.length) && !matchesExperience(expectWorkExpList, selectedJobData.jobExperience)
                  ) {
                    notSuitReasonIdToStrategyMap.workExp = expectWorkExpNotMatchStrategy
                  }
                  if (
                    isPosterHrFilterEnabled && !testIfPosterTitleSuit(targetJobData.bossInfo)
                  ) {
                    notSuitReasonIdToStrategyMap.posterTitle = posterHrNotMatchStrategy
                  }
                  if (
                    !testIfJobTitleOrDescriptionSuit(targetJobData.jobInfo, jobDetailRegExpMatchLogic)
                  ) {
                    notSuitReasonIdToStrategyMap.jobDetail = jobNotMatchStrategy
                  }
                  if (
                    !checkIfSalarySuit(selectedJobData.salaryDesc)
                  ) {
                    notSuitReasonIdToStrategyMap.salary = expectSalaryNotMatchStrategy
                  }
                  // #endregion
                  console.log('not suit reason and related strategy: ', notSuitReasonIdToStrategyMap)
                  for (const [key, scope] of [['city', strategyScopeOptionWhenMarkJobCityNotMatch], ['salary', strategyScopeOptionWhenMarkSalaryNotMatch], ['workExp', strategyScopeOptionWhenMarkJobWorkExpNotMatch]]) {
                    if (key in notSuitReasonIdToStrategyMap) notSuitReasonIdToStrategyMap[key] = scopedMarkStrategy(notSuitReasonIdToStrategyMap[key], scope, [...expectCompanySet], selectedJobData.brandName)
                  }
                  if (Object.keys(notSuitReasonIdToStrategyMap).length) autoStartChatEventBus.emit('TASK_PROGRESS', { kind: 'skipped', detail: '岗位不符合求职条件：' + Object.keys(notSuitReasonIdToStrategyMap).map(key => ({ companyName: '排除公司', active: '招聘者活跃度', city: '工作城市', workExp: '岗位经验', posterTitle: '招聘者身份', jobDetail: '岗位名称、分类或描述', salary: '期望薪资' }[key] || key)).join('、') })

                  // collect mode never marks: a job that doesn't match is just skipped
                  if (isCollectMode && Object.keys(notSuitReasonIdToStrategyMap).length) {
                    blockJobNotSuit.add(targetJobData.jobInfo.encryptId)
                    if (countSourceNoMatch()) {
                      autoStartChatEventBus.emit('TASK_PROGRESS', { detail: `连续 ${noMatchStreak} 个岗位不符合条件，达到止损数量（${noMatchStreakLimit}），切换下一个来源`, state: 'searching' })
                      reject(new Error(ROTATE_NEXT_SOURCE_ERROR))
                      return
                    }
                    continue continueFind
                  }
                  // #region execute mark logic
                  // 1. find the one mark on Boss
                  const markOnBossCondition = Object.keys(notSuitReasonIdToStrategyMap).find(k => notSuitReasonIdToStrategyMap[k] === MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_BOSS)
                  if (markOnBossCondition) {
                    await notSuitConditionHandleMap[markOnBossCondition]()
                    blockJobNotSuit.setExpiry(targetJobData.jobInfo.encryptId, Date.now() + COOLDOWN_MS)
                    if (countSourceNoMatch()) {
                      autoStartChatEventBus.emit('TASK_PROGRESS', { detail: `连续 ${noMatchStreak} 个岗位不符合条件，达到止损数量（${noMatchStreakLimit}），切换下一个来源`, state: 'searching' })
                      reject(new Error(ROTATE_NEXT_SOURCE_ERROR))
                      return
                    }
                    continue continueFind
                  }
                  // 2. if there is no condition to mark Boss, then find the one mark on local db
                  const markOnLocalDbCondition = Object.keys(notSuitReasonIdToStrategyMap).find(k => notSuitReasonIdToStrategyMap[k] === MarkAsNotSuitOp.MARK_AS_NOT_SUIT_ON_LOCAL)
                  if (markOnLocalDbCondition) {
                    await notSuitConditionHandleMap[markOnLocalDbCondition]()
                    blockJobNotSuit.setExpiry(targetJobData.jobInfo.encryptId, Date.now() + COOLDOWN_MS)
                    if (markOnLocalDbCondition === 'active') blockBossNotActive.setExpiry(targetJobData.jobInfo.encryptUserId, Date.now() + COOLDOWN_MS)
                    if (countSourceNoMatch()) {
                      autoStartChatEventBus.emit('TASK_PROGRESS', { detail: `连续 ${noMatchStreak} 个岗位不符合条件，达到止损数量（${noMatchStreakLimit}），切换下一个来源`, state: 'searching' })
                      reject(new Error(ROTATE_NEXT_SOURCE_ERROR))
                      return
                    }
                    continue continueFind
                  }
                  // 3.
                  const noOpCondition = Object.keys(notSuitReasonIdToStrategyMap).find(k => notSuitReasonIdToStrategyMap[k] === MarkAsNotSuitOp.NO_OP)
                  if (noOpCondition) {
                    // Skipping must never fall through to a local mark.
                    blockJobNotSuit.add(targetJobData.jobInfo.encryptId)
                    if (countSourceNoMatch()) {
                      autoStartChatEventBus.emit('TASK_PROGRESS', { detail: `连续 ${noMatchStreak} 个岗位不符合条件，达到止损数量（${noMatchStreakLimit}），切换下一个来源`, state: 'searching' })
                      reject(new Error(ROTATE_NEXT_SOURCE_ERROR))
                      return
                    }
                    continue continueFind
                  }
                  // #endregion
                  if (
                    // test company again - when allow list not include target company, just skip
                    enableCompanyAllowList && ![...expectCompanySet].find(
                      name => selectedJobData.brandName?.toLowerCase?.()?.includes(name.toLowerCase())
                    ) ||
                    // check if job has been marked as not suit or not active
                    blockJobNotSuit.has(targetJobData.jobInfo.encryptId) ||
                    blockBossNotActive.has(targetJobData.jobInfo.encryptUserId)
                  ) {
                    // just skip
                    blockJobNotSuit.add(targetJobData.jobInfo.encryptId)
                    autoStartChatEventBus.emit('TASK_PROGRESS', { kind: 'skipped', detail: '公司范围不符合或岗位已跳过' })
                    if (countSourceNoMatch()) {
                      autoStartChatEventBus.emit('TASK_PROGRESS', { detail: `连续 ${noMatchStreak} 个岗位不符合条件，达到止损数量（${noMatchStreakLimit}），切换下一个来源`, state: 'searching' })
                      reject(new Error(ROTATE_NEXT_SOURCE_ERROR))
                      return
                    }
                    continue continueFind
                  }
                  if (isCollectMode) {
                    await hooks.jobMatchedForCollection?.promise(targetJobData)
                    blockJobNotSuit.add(targetJobData.jobInfo.encryptId)
                    autoStartChatEventBus.emit('TASK_PROGRESS', { kind: 'collected', detail: '已保存符合条件的岗位' })
                    searchGuard.reset()
                    if (countSourceSuccess()) {
                      autoStartChatEventBus.emit('TASK_PROGRESS', { detail: `本来源已保存 ${sourceSuccessCount} 个岗位，达到换源数量（${perSourceSuccessLimit}），切换下一个来源`, state: 'searching' })
                      reject(new Error(ROTATE_NEXT_SOURCE_ERROR))
                      return
                    }
                    continue continueFind
                  }
                  const startChatButtonInnerHTML = await page.evaluate('document.querySelector(".job-detail-box .op-btn.op-btn-chat")?.innerHTML.trim()')
                  if (startChatButtonInnerHTML !== '立即沟通') {
                    blockBossNotNewChat.add(targetJobData.jobInfo.encryptUserId)
                    autoStartChatEventBus.emit('TASK_PROGRESS', { kind: 'skipped', detail: '岗位不可立即沟通' })
                    if (countSourceNoMatch()) {
                      autoStartChatEventBus.emit('TASK_PROGRESS', { detail: `连续 ${noMatchStreak} 个岗位不符合条件，达到止损数量（${noMatchStreakLimit}），切换下一个来源`, state: 'searching' })
                      reject(new Error(ROTATE_NEXT_SOURCE_ERROR))
                      return
                    }
                    continue continueFind
                  }
                  targetJobIndex = tempTargetJobIndexToCheckDetail
                  matchedJobId = targetJobData.jobInfo.encryptId
                  //#endregion
                }

                if (targetJobIndex < 0 && hasReachLastPage) {
                  // has reach last page and not find target job
                  reject(new Error('CANNOT_FIND_EXCEPT_JOB_IN_THIS_FILTER_CONDITION'))
                  return
                }
              }

              // The loop also ends when the last batch is loaded while the job just looked at was
              // skipped (`continue continueFind` bypasses the last-page check above). That job did
              // not match, so finding nothing must never fall through to greeting it.
              if (targetJobIndex < 0 || !matchedJobId) {
                reject(new Error('CANNOT_FIND_EXCEPT_JOB_IN_THIS_FILTER_CONDITION'))
                return
              }
              resolve(
                {
                  targetJobIndex,
                  targetJobData,
                  matchedJobId
                }
              )
            } catch(err) {
              reject(err)
            }
          })
          // last line of defence before a message goes out
          assertCanGreet({ isCollectMode, targetJobIndex, matchedJobId, targetJobId: targetJobData?.jobInfo?.encryptId,
            detail: targetJobData, requiredConditions: requiredJobConditions })
          await waitForSageTimeOrJustContinue({
            tag: 'beforeJobChatStartup',
            hooks
          })
          await sleepWithRandomDelay(1000)
          const startChatButtonInnerHTML = await page.evaluate('document.querySelector(".job-detail-box .op-btn.op-btn-chat")?.innerHTML.trim()')

          await hooks.newChatWillStartup?.promise(targetJobData)
          const startChatButtonProxy = await page.$('.job-detail-box .op-btn.op-btn-chat')
          await sleep(500)
          //#region click the chat button
          await checkJobResponses()
          runBudget?.checkpoint()
          await clickTaskElement(page, startChatButtonProxy)

          const waitAddFriendResponse = async () => {
            const addFriendResponse = await page.waitForResponse(
              response => {
                if (
                  response.url().startsWith('https://www.zhipin.com/wapi/zpgeek/friend/add.json') && response.url().includes(`jobId=${targetJobData.jobInfo.encryptId}`)
                ) {
                  return true
                }
                return false
              }
            );
            await sleepWithRandomDelay(3000)
            let res
            try {
              res = await addFriendResponse.json()
              return res
            }
            catch(err) {
              await sleep(2000)
              if (page.url().startsWith('https://www.zhipin.com/web/geek/chat')) {
                throw new Error('PAGE_JUMPED_TO_CHAT_PAGE')
              }
              else {
                throw err
              }
            }
          }
          const waitAndHandleChatSuccess = async ({ hasGoToChatPage = false } = {}) => {
            await hooks.newChatStartup?.promise(
              targetJobData,
              {
                chatStartupFrom: ChatStartupFrom.AutoFromRecommendList,
                jobSource: JobSource[computedSourceList[currentSourceIndex]?.type]
              }
            )
            blockBossNotNewChat.add(targetJobData.jobInfo.encryptUserId)
            const rotateSource = countSourceSuccess()
            autoStartChatEventBus.emit('TASK_PROGRESS', { kind: 'sent', detail: 'BOSS已确认开聊成功' })
            await storeStorage(page)
            if (rotateSource) {
              autoStartChatEventBus.emit('TASK_PROGRESS', { detail: `本来源已开聊 ${sourceSuccessCount} 个岗位，达到换源数量（${perSourceSuccessLimit}），切换下一个来源`, state: 'searching' })
              chatSourceRotationDone = true
              return
            }
            await sleepWithRandomDelay(1500)
            if (hasGoToChatPage) {
              await page.goBack()
              await page.waitForFunction(() => {
                return location.href.startsWith(`https://www.zhipin.com/web/geek/jobs`) && document.readyState === 'complete'
              }, { polling: 100 })
              await sleepWithRandomDelay(2000)
            }
            const closeDialogButtonProxy = await page.$('.greet-boss-dialog .greet-boss-footer .cancel-btn')
            if (closeDialogButtonProxy) {
              await clickTaskElement(page, closeDialogButtonProxy)
              await sleepWithRandomDelay(2000)
            }
          }
          const handleAddFriendResponse = async (res, { hasGoToChatPage = false } = {}) => {
            const access = classifyBossLoginResponse(200, res)
            if (access.status === 'restricted' || access.status === 'invalid') throw bossLoginError(access)
            if (res.code === 0) {
              await waitAndHandleChatSuccess({ hasGoToChatPage })
            }
            else if (
              res.zpData.bizCode === 1 &&
              res.zpData.bizData?.chatRemindDialog?.blockLevel === 0 &&
              /剩\d+次沟通机会/.test(res.zpData.bizData?.chatRemindDialog?.content)
            ) {
              await waitForSageTimeOrJustContinue({
                tag: 'beforeJobChatStartupAfterTwiceConfirm',
                hooks
              })
              const confirmButton = await page.waitForSelector('.chat-block-dialog .chat-block-footer .sure-btn')
              await checkJobResponses()
              await clickTaskElement(page, confirmButton)
              const nextRes = await waitAddFriendResponse()
              await handleAddFriendResponse(nextRes)
            }
            else if (
              res.zpData.bizCode === 1 &&
              /猎头/.test(res.zpData.bizData?.chatRemindDialog?.content)
            ) {
              await waitForSageTimeOrJustContinue({
                tag: 'beforeJobChatStartupAfterTwiceConfirm',
                hooks
              })
              const confirmButton = await page.waitForSelector(`xpath///*[contains(@class, "chat-block-dialog")]//*[contains(@class, "chat-block-footer")]//*[contains(text(), "继续")]`)
              await checkJobResponses()
              await clickTaskElement(page, confirmButton)
              const nextRes = await waitAddFriendResponse()
              await handleAddFriendResponse(nextRes)
            }
            else if (
              res.zpData.bizCode === 1 &&
              res.zpData.bizData?.chatRemindDialog?.blockLevel === 0 && 
              (
                res.zpData.bizData?.chatRemindDialog?.content === `今日沟通人数已达上限，请明天再试` ||
                /明天再来/.test(res.zpData.bizData?.chatRemindDialog?.content)
              )
            ) {
              // startup chat error, may the chance of today has used out
              await storeStorage(page)
              throw new Error('STARTUP_CHAT_ERROR_DUE_TO_TODAY_CHANCE_HAS_USED_OUT')
            }
            else {
              console.error(
                JSON.stringify(res, null, 2)
              )
              throw new Error('STARTUP_CHAT_ERROR_WITH_UNKNOWN_ERROR')
            }
          }
          let res
          try {
            res = await waitAddFriendResponse()
            await handleAddFriendResponse(res)
          }
          catch (err) {
            if (err instanceof Error && err.message === 'PAGE_JUMPED_TO_CHAT_PAGE') {
              await handleAddFriendResponse({
                code: 0
              }, { hasGoToChatPage: true })
            }
            else {
              throw err
            }
          }
          if (chatSourceRotationDone) {
            await sleepWithRandomDelay(3 * 1000)
            break iterateFilterCondition
          }
        } catch (err) {
          if (err instanceof Error) {
            switch (err.message) {
              case 'CANNOT_FIND_EXCEPT_JOB_IN_THIS_FILTER_CONDITION': {
                await sleepWithRandomDelay(25 * 1000)
                continue iterateFilterCondition;
              }
              case ROTATE_NEXT_SOURCE_ERROR: {
                await sleepWithRandomDelay(3 * 1000)
                break iterateFilterCondition
              }
              case 'AUTO_CHAT_NO_MATCH_BATCH_LIMIT': {
                autoStartChatEventBus.emit('TASK_PROGRESS', { detail: '连续5批岗位没有可处理的，切换下一个来源', state: 'searching' })
                await sleepWithRandomDelay(3 * 1000)
                break iterateFilterCondition
              }
              case 'STARTUP_CHAT_ERROR_DUE_TO_TODAY_CHANCE_HAS_USED_OUT': {
                let nextTrySeconds = 60 * 60
                const msg = `Today chance has used out. Just explore positions you\'ve chatted. New chat will be tried to start after ${nextTrySeconds} seconds.`
                hooks.errorEncounter?.call(msg)
                console.error(msg)
                await sleep(nextTrySeconds * 1000)
                throw err
              }
              case 'STARTUP_CHAT_ERROR_WITH_UNKNOWN_ERROR': {
                hooks.errorEncounter?.call([err.message, err.stack].join('\n'))
                throw err
              }
              default: {
                hooks.errorEncounter?.call([err.message, err.stack].join('\n'))
                throw err
              }
            }
          } else {
            hooks.errorEncounter?.call(err)
            throw err
          }
        }
      }
    }
    if (budgetApplies && filterConditionIndex + 1 >= filterCombinationLimit && !hasReachedSourceRotationLimit()) {
      autoStartChatEventBus.emit('TASK_PROGRESS', {
        detail: `已达到当前来源的${filterCombinationLimit}种组合预算，结束该来源`, state: 'searching'
      })
    }
    skipFilterConditions = 0
    // for of reach terminal
    if (
      currentSourceIndex + 1 >= computedSourceList.length
    ) {
      // one-way rotation: every source has been worked once, the run ends successfully
      hooks.noPositionFoundForCurrentJob?.call()
      autoStartChatEventBus.emit('TASK_PROGRESS', { detail: '所有职位来源都已轮换完成，任务结束', state: 'stopped' })
      throw new Error('AUTO_CHAT_ALL_SOURCES_ROTATED')
    } else {
      hooks.noPositionFoundForCurrentJob?.call()
      currentSourceIndex += 1
      resetSourceRotationCounters()
      runPosition = { sourceIndex: currentSourceIndex, filterConditionIndex: 0, fingerprint: positionFingerprint }
      autoStartChatEventBus.emit('RUN_POSITION', { ...runPosition })
      await sleep((10 + 15 * Math.random()) * 1000)
      autoStartChatEventBus.emit('TASK_PROGRESS', { detail: `切换到下一个来源：${sourceLabel(computedSourceList[currentSourceIndex])}`, state: 'searching' })
    }
  }
}

export async function mainLoop (hooks) {
  const budget = ensureRunBudget()
  budget.resume()
  try { return await budget.guard(() => runBrowserLoop(hooks)) }
  finally { budget.pause() }
}

async function runBrowserLoop (hooks) {
  if (!puppeteer) {
    await initPuppeteer()
  }
  try {
    const opening = launchTaskBrowser(puppeteer, { background: runInBackground })
    browserOpening = opening
    let launched
    try { launched = await opening }
    finally { if (browserOpening === opening) browserOpening = null }
    if (browserClosing) {
      await browserClosing
      throw new Error('AUTO_CHAT_TASK_STOPPING')
    }
    browser = launched.browser
    hooks.puppeteerLaunched?.call(browser)
    page = launched.page
    jobRequestBudgetMonitor?.dispose()
    jobRequestBudgetMonitor = await attachJobRequestBudget(page, runBudget)
    jobResponseMonitor?.dispose()
    jobResponseMonitor = watchJobResponses(page, {
      onBlocked: error => autoStartChatEventBus.emit('TASK_PROGRESS', { detail: error.detail, state: 'blocked' }),
      onListResponse: summary => {
        console.debug('BOSS_LIST_RESPONSE', JSON.stringify(summary))
        autoStartChatEventBus.emit('BOSS_LIST_RESPONSE', summary)
      }
    })
    hooks.pageGotten?.call(page)
    const ownPage = page
    // tell the task as soon as BOSS shows a verification page, and when the user has passed it
    let onSecurityCheck = false
    ownPage.on('framenavigated', (frame) => {
      if (frame !== ownPage.mainFrame()) return
      const checking = isSecurityCheckUrl(frame.url())
      if (checking && !onSecurityCheck) {
        try { runBudget?.pause() } catch { /* guard() reports the failed budget */ }
        autoStartChatEventBus.emit('SECURITY_CHECK', { url: frame.url() })
      }
      if (!checking && onSecurityCheck) autoStartChatEventBus.emit('SECURITY_CHECK_PASSED')
      onSecurityCheck = checking
    })
    //set cookies
    const bossCookies = readStorageFile('boss-cookies.json')
    await hooks.cookieWillSet?.promise({ cookies: bossCookies, browser })
    const bossLocalStorage = readStorageFile('boss-local-storage.json')
    for(let i = 0; i < bossCookies.length; i++){
      if (Object.hasOwn(bossCookies[i], 'sameSite')) {
        bossCookies[i].sameSite = 'unspecified'
      }
      await page.setCookie(bossCookies[i]);
    }
    await setDomainLocalStorage(browser, localStoragePageUrl, bossLocalStorage, { page })
    if (!runInBackground) await page.bringToFront()
    autoStartChatEventBus.emit('TASK_PROGRESS', { detail: runInBackground ? 'BOSS浏览器在后台最小化运行' : 'BOSS浏览器使用普通窗口' })
    // __GGR_INJECT_ANTI_ANTI_DEBUGGER__
    await hooks.mainFlowWillLaunch?.promise({
      jobNotMatchStrategy,
      jobNotActiveStrategy,
      expectCityNotMatchStrategy,
      expectSalaryNotMatchStrategy,
      expectWorkExpNotMatchStrategy,
      blockCompanyNameRegMatchStrategy,
      posterHrNotMatchStrategy,
      blockJobNotSuit,
      blockBossNotActive,
      blockBossNotNewChat
    })
    await toRecommendPage(hooks)
    // goto search

    // ;await browser.close()
  } catch (err) {
    // a verification page needs the user: keep the window open for them (see waitUntilSecurityCheckPassed)
    let onSecurityCheck = false
    try {
      onSecurityCheck = !!page && !page.isClosed() && isSecurityCheckUrl(page.url())
    } catch {
      //
    }
    if (onSecurityCheck) {
      console.error(err)
      throw new Error('AUTO_CHAT_SECURITY_CHECK', { cause: err })
    }
    await closeBrowserWindow()
    throw err
  }
}

/**
 * The task is paused on a BOSS verification page: show it and wait for the user to pass it.
 * Resolves 'passed' (the new site cookies are saved) or 'closed'.
 */
export async function waitUntilSecurityCheckPassed () {
  return runBudget ? runBudget.guard(waitForVerification) : waitForVerification()
}

async function waitForVerification () {
  const ownPage = page
  if (!ownPage) return 'closed'
  await showTaskBrowser(ownPage).catch(() => ownPage.bringToFront().catch(() => void 0))
  const result = await waitForSecurityCheck({
    currentUrl: async () => ownPage.url(),
    isClosed: () => ownPage.isClosed() || !browser?.connected,
    sleep
  })
  if (result === 'passed') {
    // the page goes back to where it was and gets the new site cookies
    await sleep(3000)
    await storeStorage(ownPage)
  }
  return result
}

export function closeBrowserWindow () {
  if (browserClosing) return browserClosing
  try { runBudget?.pause() } catch { /* The stopped budget is saved independently. */ }
  jobRequestBudgetMonitor?.dispose()
  jobRequestBudgetMonitor = null
  jobResponseMonitor?.dispose()
  jobResponseMonitor = null
  const ownBrowser = browser
  const opening = browserOpening
  browser = null
  page = null
  browserClosing = (async () => {
    // A stop may arrive after Chrome is spawned but before Puppeteer returns it.
    // Keep the worker alive until that owned browser can be closed as well.
    let pendingBrowser
    if (opening) {
      try { pendingBrowser = (await opening).browser } catch { /* launch cleans up its failed browser */ }
    }
    await Promise.all([...new Set([ownBrowser, pendingBrowser].filter(Boolean))].map(browser => closeOwnedBrowser(browser)))
  })().finally(() => { browserClosing = null })
  return browserClosing
}

async function storeStorage (page) {
  try {
    const [cookies, localStorage] = await Promise.all([
      page.cookies(),
      page.evaluate(() => JSON.stringify(window.localStorage)).then(res => JSON.parse(res))
    ])
    await writeBossSession({ cookies, localStorage })
  } catch (error) {
    if (isJsonStorageError(error)) throw error
    // A transient navigation/capture failure must not erase the saved session.
    console.warn('暂时未能捕获BOSS登录状态，已保留原文件')
  }
}
