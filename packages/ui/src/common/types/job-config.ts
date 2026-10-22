export type CommonConfigSection = 'salary' | 'city' | 'jobDetail' | 'expectJob' | 'expectCompanies' | 'blockCompanyNameRegExpStr'
export type CommonConfigSelection = Partial<Record<CommonConfigSection, boolean>>

export interface CommonJobConditionForm {
  expectJobNameRegExpStr: string
  expectJobTypeRegExpStr: string
  expectJobDescRegExpStr: string
  isPosterHrFilterEnabled: boolean
  posterHrTitleRegExpStr: string
  jobDetailRegExpMatchLogic: number
  expectCompanies: string
  blockCompanyNameRegExpStr: string
  expectSalaryCalculateWay: number
  expectSalaryLow: number | null
  expectSalaryHigh: number | null
  expectCityList: string[]
}

export interface AnyCombineJobFilter {
  cityList?: string[]
  salaryList?: number[]
  experienceList?: number[]
  degreeList?: number[]
  industryList?: number[]
  scaleList?: number[]
}

export interface StaticCombineJobFilter {
  city?: string | null
  salary: number | null
  experience: number | null
  degree: number | null
  industry: number | null
  scale: number | null
}

export interface SearchKeyword {
  type: string
  enabled: boolean
  keyword: string
  brandId?: string
  label?: string
}

export interface JobSourceForm {
  type: string
  enabled: boolean
  label?: string
  children?: SearchKeyword[]
}

export interface JobSearchForm extends CommonJobConditionForm {
  dingtalkRobotAccessToken: string
  anyCombineRecommendJobFilter: AnyCombineJobFilter
  combineRecommendJobFilterType: number
  autoChatFilterCombinationLimit: number
  staticCombineRecommendJobFilterConditions: StaticCombineJobFilter[]
  expectJobRegExpStr?: string
  posterHrNotMatchStrategy: number
  jobNotMatchStrategy: number
  jobNotActiveStrategy: number
  markAsNotActiveSelectedTimeRange: number
  expectCityNotMatchStrategy: number
  strategyScopeOptionWhenMarkJobCityNotMatch: number
  expectSalaryNotMatchStrategy: number
  strategyScopeOptionWhenMarkSalaryNotMatch: number
  expectWorkExpList: string[]
  expectWorkExpNotMatchStrategy: number
  strategyScopeOptionWhenMarkJobWorkExpNotMatch: number
  isSkipEmptyConditionForCombineRecommendJobFilter: boolean
  __jobSourceList: JobSourceForm[]
  isSageTimeEnabled: boolean
  sageTimeOpTimes: number
  sageTimePauseMinute: number
  blockCompanyNameRegMatchStrategy: number
  fieldsForUseCommonConfig: CommonConfigSelection
}
