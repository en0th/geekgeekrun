// Generated from source-bound endpoint_registry.json. Do not hand-edit.
import type { EndpointDefinition } from './types.js';

export const ENDPOINTS = {
  "partnersV2DailyReportByIdGet": {
    "id": "SWMAPI_dfce17febe99",
    "method": "GET",
    "path": "/wapi/partners/v2/daily-report/by-id",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_result_delivery_bridge",
    "defaultQuery": {},
    "pathParams": []
  },
  "partnersV2DailyReportPendingDeliveryJobsGet": {
    "id": "SWMAPI_76d38ebeed31",
    "method": "GET",
    "path": "/wapi/partners/v2/daily-report/pending-delivery-jobs",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_result_delivery_bridge",
    "defaultQuery": {},
    "pathParams": []
  },
  "partnersV2DailyReportPendingRepliesGet": {
    "id": "SWMAPI_2853d5a022ed",
    "method": "GET",
    "path": "/wapi/partners/v2/daily-report/pending-replies",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_result_delivery_bridge",
    "defaultQuery": {},
    "pathParams": []
  },
  "partnersV2DailyReportRealtimeGet": {
    "id": "SWMAPI_38216ebc604a",
    "method": "GET",
    "path": "/wapi/partners/v2/daily-report/realtime",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_result_delivery_bridge",
    "defaultQuery": {},
    "pathParams": []
  },
  "partnersV2DailyReportRealtimePendingRepliesGet": {
    "id": "SWMAPI_84d53816ff1b",
    "method": "GET",
    "path": "/wapi/partners/v2/daily-report/realtime/pending-replies",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_result_delivery_bridge",
    "defaultQuery": {},
    "pathParams": []
  },
  "partnersV2DailyReportSummaryGet": {
    "id": "SWMAPI_79375d8341f4",
    "method": "GET",
    "path": "/wapi/partners/v2/daily-report/summary",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_result_delivery_bridge",
    "defaultQuery": {},
    "pathParams": []
  },
  "partnersV2OfficeRecordListGet": {
    "id": "SWMAPI_56a92fd198c8",
    "method": "GET",
    "path": "/wapi/partners/v2/office-record/list",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_result_delivery_bridge",
    "defaultQuery": {
      "version": 2
    },
    "pathParams": []
  },
  "partnersV2OfficeRecordReadPost": {
    "id": "SWMAPI_b1bed78d7686",
    "method": "POST",
    "path": "/wapi/partners/v2/office-record/read",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_result_delivery_bridge",
    "defaultQuery": {},
    "pathParams": []
  },
  "partnersZpGeekSendConfirmedResumePost": {
    "id": "SWMAPI_38a14c9a51b7",
    "method": "POST",
    "path": "/wapi/partners/zp/geek/sendConfirmedResume",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_result_delivery_bridge",
    "defaultQuery": {},
    "pathParams": []
  },
  "userGeekDeliveryListGet": {
    "id": "SWMAPI_39186d52d185",
    "method": "GET",
    "path": "/wapi/user/geek/delivery/list",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_result_delivery_bridge",
    "defaultQuery": {},
    "pathParams": []
  },
  "userGeekDeliveryListByJobIdsPost": {
    "id": "SWMAPI_05f037011f6e",
    "method": "POST",
    "path": "/wapi/user/geek/delivery/listByJobIds",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_result_delivery_bridge",
    "defaultQuery": {},
    "pathParams": []
  },
  "userFileDownload": {
    "id": "SWMAPI_cfd918fd91a6",
    "method": "GET",
    "path": "/wapi/user/file/v2/download",
    "base": "api",
    "transport": "binary",
    "category": "auxiliary_ai_storage",
    "defaultQuery": {},
    "pathParams": []
  },
  "userFileV2UploadPost": {
    "id": "SWMAPI_d6a90805ebb2",
    "method": "POST",
    "path": "/wapi/user/file/v2/upload",
    "base": "api",
    "transport": "multipart",
    "category": "auxiliary_ai_storage",
    "defaultQuery": {
      "source": "feedback"
    },
    "pathParams": []
  },
  "partnersExpectGetGet": {
    "id": "SWMAPI_d5763bf15c84",
    "method": "GET",
    "path": "/wapi/partners/expect/get",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "partnersExpectUpsertPost": {
    "id": "SWMAPI_cd563790c266",
    "method": "POST",
    "path": "/wapi/partners/expect/upsert",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "partnersJobAgentSearchPost": {
    "id": "SWMAPI_15e99a24da9a",
    "method": "POST",
    "path": "/wapi/partners/job/agent-search",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "partnersJobBrandFullInfo4GeekPost": {
    "id": "SWMAPI_66438348f2f8",
    "method": "POST",
    "path": "/wapi/partners/job/brandFullInfo4Geek",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "partnersJobDetailGet": {
    "id": "SWMAPI_773e746d5d48",
    "method": "GET",
    "path": "/wapi/partners/job/detail",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "partnersJobRecommendPost": {
    "id": "SWMAPI_f71c097a395d",
    "method": "POST",
    "path": "/wapi/partners/job/recommend",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "partnersJobSearchConditionPost": {
    "id": "SWMAPI_4aaa9c939565",
    "method": "POST",
    "path": "/wapi/partners/job/search-condition",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "partnersJobWikiPositionPost": {
    "id": "SWMAPI_1284f823c00e",
    "method": "POST",
    "path": "/wapi/partners/job/wiki/position",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "partnersMarketPreferenceProfileGet": {
    "id": "SWMAPI_4b9d58e87ab6",
    "method": "GET",
    "path": "/wapi/partners/market-preference/profile",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "partnersSuggestHomepageV2Get": {
    "id": "SWMAPI_9ac8d9939f0f",
    "method": "GET",
    "path": "/wapi/partners/suggest/homepage/v2",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "homepageBootstrap": {
    "id": "SWMAPI_e51ec7067b4c",
    "method": "GET",
    "path": "/wapi/partners/v2/homepage/bootstrap",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "partnersV2MarketInsightCompanyDynamicsGet": {
    "id": "SWMAPI_eb53acfc02ca",
    "method": "GET",
    "path": "/wapi/partners/v2/market-insight/company-dynamics",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "partnersV2MarketInsightCompanySourcesGet": {
    "id": "SWMAPI_d844c075670c",
    "method": "GET",
    "path": "/wapi/partners/v2/market-insight/company-sources",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "partnersV2MarketInsightCompetitionGet": {
    "id": "SWMAPI_d785f990cf84",
    "method": "GET",
    "path": "/wapi/partners/v2/market-insight/competition",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "partnersV2MarketInsightWeeklyMarketGet": {
    "id": "SWMAPI_d99a1c56be21",
    "method": "GET",
    "path": "/wapi/partners/v2/market-insight/weekly-market",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userFeedbackFindByTargetIdsPost": {
    "id": "SWMAPI_78b4f7b1abf1",
    "method": "POST",
    "path": "/wapi/user/feedback/findByTargetIds",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userFeedbackReasonListGet": {
    "id": "SWMAPI_fa695497ba93",
    "method": "GET",
    "path": "/wapi/user/feedback/reason/list",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userFeedbackReportPost": {
    "id": "SWMAPI_82b320e2bbff",
    "method": "POST",
    "path": "/wapi/user/feedback/report",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userGeekAgentConfigCheckDeliverPreconditionGet": {
    "id": "SWMAPI_441c1fcefd5a",
    "method": "GET",
    "path": "/wapi/user/geek/agent/config/checkDeliverPrecondition",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userGeekAgentConfigFindLatestGet": {
    "id": "SWMAPI_a96e2abcd24b",
    "method": "GET",
    "path": "/wapi/user/geek/agent/config/findLatest",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userGeekAgentConfigGreetingSuggestGet": {
    "id": "SWMAPI_17a185afcd12",
    "method": "GET",
    "path": "/wapi/user/geek/agent/config/greetingSuggest",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userGeekAgentConfigUpdateAutoDeliveryStatusPost": {
    "id": "SWMAPI_b1e9fc744053",
    "method": "POST",
    "path": "/wapi/user/geek/agent/config/updateAutoDeliveryStatus",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {
      "deliveryMode": "AUTO"
    },
    "pathParams": []
  },
  "userGeekAgentConfigUpdateByIdPost": {
    "id": "SWMAPI_f4470b727945",
    "method": "POST",
    "path": "/wapi/user/geek/agent/config/updateById",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userGeekAgentConfigUpdateGreetingPost": {
    "id": "SWMAPI_e9e68e645b93",
    "method": "POST",
    "path": "/wapi/user/geek/agent/config/updateGreeting",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userGeekAgentTaskTaskPagePost": {
    "id": "SWMAPI_167edaeaffa5",
    "method": "POST",
    "path": "/wapi/user/geek/agent/task/task-page",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "workSettingsGet": {
    "id": "SWMAPI_a161d8416444",
    "method": "GET",
    "path": "/wapi/user/geek/agent/work-settings",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "workCommunicationSet": {
    "id": "SWMAPI_e280645442b9",
    "method": "POST",
    "path": "/wapi/user/geek/agent/work-settings/communication",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "workDeliverySet": {
    "id": "SWMAPI_72a011b97182",
    "method": "POST",
    "path": "/wapi/user/geek/agent/work-settings/delivery",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "workModeSet": {
    "id": "SWMAPI_c93e9bf96f33",
    "method": "POST",
    "path": "/wapi/user/geek/agent/work-settings/work-mode",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userGeekResumeAttachmentChatUploadPost": {
    "id": "SWMAPI_fab38841a619",
    "method": "POST",
    "path": "/wapi/user/geek/resume/attachment/chat-upload",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userGeekResumeAttachmentCoverUploadPost": {
    "id": "SWMAPI_bf5f1df9f97b",
    "method": "POST",
    "path": "/wapi/user/geek/resume/attachment/cover/upload",
    "base": "api",
    "transport": "multipart",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userGeekResumeAttachmentDefaultPost": {
    "id": "SWMAPI_976f96e9f8d0",
    "method": "POST",
    "path": "/wapi/user/geek/resume/attachment/default",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userGeekResumeAttachmentDeletePost": {
    "id": "SWMAPI_97f9ce675f3e",
    "method": "POST",
    "path": "/wapi/user/geek/resume/attachment/delete",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userGeekResumeAttachmentExtractAvatarGet": {
    "id": "SWMAPI_b967d9b2d013",
    "method": "GET",
    "path": "/wapi/user/geek/resume/attachment/extract-avatar",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userGeekResumeAttachmentHasDefaultGet": {
    "id": "SWMAPI_e56540acc682",
    "method": "GET",
    "path": "/wapi/user/geek/resume/attachment/has-default",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userGeekResumeAttachmentListPost": {
    "id": "SWMAPI_44bdab7adb64",
    "method": "POST",
    "path": "/wapi/user/geek/resume/attachment/list",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userGeekResumeAttachmentPreviewGet": {
    "id": "SWMAPI_d04abfd54cb9",
    "method": "GET",
    "path": "/wapi/user/geek/resume/attachment/preview",
    "base": "api",
    "transport": "binary",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userGeekResumeAttachmentPreviewFilenameGet": {
    "id": "SWMAPI_ef1d73f4981a",
    "method": "GET",
    "path": "/wapi/user/geek/resume/attachment/preview/{filename}",
    "base": "api",
    "transport": "binary",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": [
      "filename"
    ]
  },
  "userGeekResumeAttachmentUploadPost": {
    "id": "SWMAPI_5d2880f8e2f9",
    "method": "POST",
    "path": "/wapi/user/geek/resume/attachment/upload",
    "base": "api",
    "transport": "multipart",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userGeekResumeAttachmentUploadOcrPost": {
    "id": "SWMAPI_0069b3bc77fc",
    "method": "POST",
    "path": "/wapi/user/geek/resume/attachment/upload-ocr",
    "base": "api",
    "transport": "multipart",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userGeekResumeZpAttachmentPreviewGet": {
    "id": "SWMAPI_7124e29ae1ef",
    "method": "GET",
    "path": "/wapi/user/geek/resume/zp/attachment/preview",
    "base": "api",
    "transport": "binary",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userGeekResumeZpAttachmentPreviewFilenameGet": {
    "id": "SWMAPI_713565fc2cb7",
    "method": "GET",
    "path": "/wapi/user/geek/resume/zp/attachment/preview/{filename}",
    "base": "api",
    "transport": "binary",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": [
      "filename"
    ]
  },
  "userNotificationsPermissionPost": {
    "id": "SWMAPI_b1b692cc91a2",
    "method": "POST",
    "path": "/wapi/user/notifications/permission",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userNotificationsSettingGet": {
    "id": "SWMAPI_66c7edcf227c",
    "method": "GET",
    "path": "/wapi/user/notifications/setting",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userNotificationsSettingPut": {
    "id": "SWMAPI_8481c376ede0",
    "method": "PUT",
    "path": "/wapi/user/notifications/setting",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userNotificationsSettingEventPut": {
    "id": "SWMAPI_3a3eac240651",
    "method": "PUT",
    "path": "/wapi/user/notifications/setting/event",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userResumeV2AutocompleteMajorGet": {
    "id": "SWMAPI_5d0ee7347c37",
    "method": "GET",
    "path": "/wapi/user/resumeV2/autocomplete/major",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userResumeV2CertificateGet": {
    "id": "SWMAPI_d377e24dcdfd",
    "method": "GET",
    "path": "/wapi/user/resumeV2/certificate",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userResumeV2CitiesGet": {
    "id": "SWMAPI_347328fd9481",
    "method": "GET",
    "path": "/wapi/user/resumeV2/cities",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userResumeV2EnumsGet": {
    "id": "SWMAPI_938e9f45b6bf",
    "method": "GET",
    "path": "/wapi/user/resumeV2/enums",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userResumeV2GetCompleteResumeGet": {
    "id": "SWMAPI_cd5df61f75fc",
    "method": "GET",
    "path": "/wapi/user/resumeV2/getCompleteResume",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userResumeV2PositionsGet": {
    "id": "SWMAPI_1b03708338e9",
    "method": "GET",
    "path": "/wapi/user/resumeV2/positions",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userResumeV2SavePost": {
    "id": "SWMAPI_a2f98afab20a",
    "method": "POST",
    "path": "/wapi/user/resumeV2/save",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userResumeV2SchoolsGet": {
    "id": "SWMAPI_618c9423248d",
    "method": "GET",
    "path": "/wapi/user/resumeV2/schools",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userResumeV2StudentPositionsGet": {
    "id": "SWMAPI_a72f8d6be6f3",
    "method": "GET",
    "path": "/wapi/user/resumeV2/student/positions",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userResumeV2ZpResumeSyncPost": {
    "id": "SWMAPI_19825ac7b2d8",
    "method": "POST",
    "path": "/wapi/user/resumeV2/zp/resume/sync",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userSpecialFocusGet": {
    "id": "SWMAPI_a672beda690f",
    "method": "GET",
    "path": "/wapi/user/special-focus",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userSpecialFocusPost": {
    "id": "SWMAPI_0a64881612fc",
    "method": "POST",
    "path": "/wapi/user/special-focus",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "userSpecialFocusIdDelete": {
    "id": "SWMAPI_51300a647648",
    "method": "DELETE",
    "path": "/wapi/user/special-focus/{id}",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": [
      "id"
    ]
  },
  "userToolNebulaSignGetGet": {
    "id": "SWMAPI_b957c31c0d53",
    "method": "GET",
    "path": "/wapi/user/tool/nebula/sign/get",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "proxyCanEnable": {
    "id": "SWMAPI_6d568ad05605",
    "method": "GET",
    "path": "/wapi/user/v2/agent/proxy/can-enable",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "proxyPause": {
    "id": "SWMAPI_e7989c80d975",
    "method": "POST",
    "path": "/wapi/user/v2/agent/proxy/pause",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "proxyToggle": {
    "id": "SWMAPI_b6ec4dc85f70",
    "method": "POST",
    "path": "/wapi/user/v2/agent/proxy/toggle",
    "base": "api",
    "transport": "rest_json",
    "category": "auxiliary_ai_task_mode_context",
    "defaultQuery": {},
    "pathParams": []
  },
  "nebulaAsrConfigGet": {
    "id": "SWMAPI_23c9c94f6a0b",
    "method": "POST",
    "path": "/v1/nebula/appid/{appId}/nlpproxy/get",
    "base": "nebula",
    "transport": "rest_json",
    "category": "auxiliary_ai_voice_external",
    "defaultQuery": {},
    "pathParams": [
      "appId"
    ]
  },
  "partnersMemoryChangesPendingGet": {
    "id": "SWMAPI_98932deb100b",
    "method": "GET",
    "path": "/wapi/partners/memory/changes/pending",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "partnersMemoryCooldownConfirmPost": {
    "id": "SWMAPI_f4cd51bd64ad",
    "method": "POST",
    "path": "/wapi/partners/memory/cooldown/confirm",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "partnersMemoryCooldownDismissPost": {
    "id": "SWMAPI_1d091a3d922c",
    "method": "POST",
    "path": "/wapi/partners/memory/cooldown/dismiss",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "partnersMemoryCooldownPendingGet": {
    "id": "SWMAPI_f67f2a01034d",
    "method": "GET",
    "path": "/wapi/partners/memory/cooldown/pending",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "partnersMemoryDeletePost": {
    "id": "SWMAPI_059b3e315a83",
    "method": "POST",
    "path": "/wapi/partners/memory/delete",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "partnersMemoryListGet": {
    "id": "SWMAPI_ad4958c48cb6",
    "method": "GET",
    "path": "/wapi/partners/memory/list",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "partnersMemorySwitchPost": {
    "id": "SWMAPI_53282ce96aed",
    "method": "POST",
    "path": "/wapi/partners/memory/switch",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "partnersMemorySwitchStatusGet": {
    "id": "SWMAPI_f1a78a56ebe6",
    "method": "GET",
    "path": "/wapi/partners/memory/switch/status",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "chatMessagesList": {
    "id": "SWMAPI_7f28856d57db",
    "method": "GET",
    "path": "/wapi/partners/v2/chat/conversation/messages",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {
      "limit": "20"
    },
    "pathParams": []
  },
  "chatConversationGet": {
    "id": "SWMAPI_eab5aec8243f",
    "method": "GET",
    "path": "/wapi/partners/v2/chat/conversation/{id}",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": [
      "id"
    ]
  },
  "chatConversationsList": {
    "id": "SWMAPI_49a7c836c92b",
    "method": "GET",
    "path": "/wapi/partners/v2/chat/conversations",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "chatFileDownload": {
    "id": "SWMAPI_28efaecd842b",
    "method": "GET",
    "path": "/wapi/partners/v2/chat/file/download",
    "base": "api",
    "transport": "binary",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "chatFileUpload": {
    "id": "SWMAPI_c8cc2a5db03a",
    "method": "POST",
    "path": "/wapi/partners/v2/chat/file/upload",
    "base": "api",
    "transport": "multipart",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "chatJobMessageMore": {
    "id": "SWMAPI_37d9870e5a59",
    "method": "POST",
    "path": "/wapi/partners/v2/chat/job/message/more",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "chatJobMessageRead": {
    "id": "SWMAPI_b50f8f98dc71",
    "method": "POST",
    "path": "/wapi/partners/v2/chat/job/message/read",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "chatJobTaskMore": {
    "id": "SWMAPI_c7bbb9782eef",
    "method": "POST",
    "path": "/wapi/partners/v2/chat/job/task/more",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "chatMessageCompleted": {
    "id": "SWMAPI_a39068c344ac",
    "method": "POST",
    "path": "/wapi/partners/v2/chat/message/completed",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "chatMessageRetry": {
    "id": "SWMAPI_a73b2422f454",
    "method": "POST",
    "path": "/wapi/partners/v2/chat/message/retry",
    "base": "api",
    "transport": "sse",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "chatRecordsList": {
    "id": "SWMAPI_f823305d1ce5",
    "method": "GET",
    "path": "/wapi/partners/v2/chat/record/list",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "chatResultsList": {
    "id": "SWMAPI_2261719b28ac",
    "method": "GET",
    "path": "/wapi/partners/v2/chat/result/list",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "chatResultRead": {
    "id": "SWMAPI_1b6c7c8a5be4",
    "method": "POST",
    "path": "/wapi/partners/v2/chat/result/read",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "chatRecentPendingDeliveries": {
    "id": "SWMAPI_1a4b65864812",
    "method": "GET",
    "path": "/wapi/partners/v2/chat/result/recentAiPendingDelivery",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "chatTodayRecommendations": {
    "id": "SWMAPI_417f6f10d6fd",
    "method": "GET",
    "path": "/wapi/partners/v2/chat/result/todayRecommendJobByResume",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "chatStopSay": {
    "id": "SWMAPI_26542bcf8529",
    "method": "POST",
    "path": "/wapi/partners/v2/chat/stopSay",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "chatTagMessages": {
    "id": "SWMAPI_acfb80374bbd",
    "method": "GET",
    "path": "/wapi/partners/v2/chat/tag/messages",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "chatTaskGet": {
    "id": "SWMAPI_d0044e3f5e3e",
    "method": "GET",
    "path": "/wapi/partners/v2/chat/task/detail",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "chatTasksList": {
    "id": "SWMAPI_2d88abfb6bf4",
    "method": "GET",
    "path": "/wapi/partners/v2/chat/task/list",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "chatTasksUnfinished": {
    "id": "SWMAPI_defa5cb98261",
    "method": "GET",
    "path": "/wapi/partners/v2/chat/task/unfinishedByConversation",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "chatUserSay": {
    "id": "SWMAPI_1dc194441f4c",
    "method": "POST",
    "path": "/wapi/partners/v2/chat/userSay",
    "base": "api",
    "transport": "sse",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "userDiagnosisGuideHintsTaskByDateGet": {
    "id": "SWMAPI_acfd0c42c80d",
    "method": "GET",
    "path": "/wapi/user/diagnosis/guide-hints/task/by-date",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "userDiagnosisTaskGet": {
    "id": "SWMAPI_a418894517d6",
    "method": "GET",
    "path": "/wapi/user/diagnosis/task",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "userResumeRevisionAnalyzeLatestTaskGet": {
    "id": "SWMAPI_779946414419",
    "method": "GET",
    "path": "/wapi/user/resume-revision/analyze/latest-task",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "resumeRevisionChatTaskPreview": {
    "id": "SWMAPI_054c4efaa9e3",
    "method": "GET",
    "path": "/wapi/user/resume-revision/chat-task/preview",
    "base": "api",
    "transport": "binary",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "userResumeRevisionCoverByIdPost": {
    "id": "SWMAPI_718600c29db8",
    "method": "POST",
    "path": "/wapi/user/resume-revision/cover-by-id",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "userResumeRevisionDeleteByIdPost": {
    "id": "SWMAPI_7db5ab13c0a5",
    "method": "POST",
    "path": "/wapi/user/resume-revision/delete-by-id",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "userResumeRevisionDetailByAttachmentGet": {
    "id": "SWMAPI_ab13beaf0297",
    "method": "GET",
    "path": "/wapi/user/resume-revision/detail-by-attachment",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "userResumeRevisionDetailByIdGet": {
    "id": "SWMAPI_6c9f72483b82",
    "method": "GET",
    "path": "/wapi/user/resume-revision/detail-by-id",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "userResumeRevisionDetailByMessageGet": {
    "id": "SWMAPI_851c1f83c277",
    "method": "GET",
    "path": "/wapi/user/resume-revision/detail-by-message",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "userResumeRevisionHealthDiagnosisPost": {
    "id": "SWMAPI_67bd2ff71b3b",
    "method": "POST",
    "path": "/wapi/user/resume-revision/health-diagnosis",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "userResumeRevisionOptimizeRecordsGet": {
    "id": "SWMAPI_ca57f391742e",
    "method": "GET",
    "path": "/wapi/user/resume-revision/optimize-records",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {
      "pageNo": 1,
      "pageSize": 10
    },
    "pathParams": []
  },
  "resumeRevisionPreview": {
    "id": "SWMAPI_29a3d9650194",
    "method": "GET",
    "path": "/wapi/user/resume-revision/preview",
    "base": "api",
    "transport": "binary",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "userResumeRevisionRecentGet": {
    "id": "SWMAPI_a1f94a00c8e5",
    "method": "GET",
    "path": "/wapi/user/resume-revision/recent",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "resumeRevisionReportPreview": {
    "id": "SWMAPI_3c736afb35f1",
    "method": "GET",
    "path": "/wapi/user/resume-revision/report/preview",
    "base": "api",
    "transport": "binary",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "userResumeRevisionUpsertByIdPost": {
    "id": "SWMAPI_ab4ba38f4433",
    "method": "POST",
    "path": "/wapi/user/resume-revision/upsert-by-id",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "userResumeRevisionVoiceApplyPost": {
    "id": "SWMAPI_3491c916b81c",
    "method": "POST",
    "path": "/wapi/user/resume-revision/voice-apply",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "userResumeRevisionVoiceWorkbenchStateGet": {
    "id": "SWMAPI_e07f0107e53e",
    "method": "GET",
    "path": "/wapi/user/resume-revision/voice/workbench-state",
    "base": "api",
    "transport": "rest_json",
    "category": "core_ai",
    "defaultQuery": {},
    "pathParams": []
  },
  "jobMatchStream": {
    "id": "SWMAPI_2596e72dcea9",
    "method": "POST",
    "path": "/wapi/partners/job/match",
    "base": "api",
    "transport": "sse",
    "category": "core_ai_sse_match",
    "defaultQuery": {},
    "pathParams": []
  }
} as const satisfies Record<string,EndpointDefinition>;

export type EndpointName = keyof typeof ENDPOINTS;
