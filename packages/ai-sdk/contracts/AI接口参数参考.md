# AI API 调用参考与SDK契约（当前构建）

源路径 `/Users/abc/Documents/deepseek-harness/zj/HBuilder.app/Pandora/apps/__UNI__49240F0/www/app-service.js`，SHA-256 `85df0d8ca64906e303f261512d32fb695450ec70dcc6862aedcee796533da79e`。本轮重新解析完整脚本，没有把旧22/24项清单假定为完整；未运行App/业务JS、访问服务或读取账号凭据。

全源AST得到 **191 个具体request site、312 个可静态定位的调用site**（303直接函数绑定，9描述性导出名alias/member候选）、225次路径字面量；再补SSE.send覆盖URL的retry与binary/preview helper数据流，归一为 **171 个method+base+path操作**。其中 **47核心AI、77辅助任务/模式/输入上下文/结果投递桥接，共124项include_in_sdk**；47项非AI排除仍保留在catalog供边界审计。另列助手STOMP和服务端返回的ASR socket，未伪装成普通HTTP GET。

`endpoint_registry.json` 是SDK生成的canonical注册表；stable id按method/base/path哈希，name在本轮冻结。`ai_api_catalog.json`含完整注册表、覆盖和排除；`sdk_contracts.json`是共同HTTP/SSE/认证与变体契约；`evidence.json`含原始片段与UTF16/Unicode/UTF8/行号。每项params表示query，path_params单列，body是客户端已见字段，不代表必填闭合后端schema。未闭合输入保留JsonObject/raw请求能力，未知输出必须保留raw。

## 1. REST方法、query与envelope

- `_s(url,query,header,options)`为GET；`ud(url,body,query,header,options)`为POST；jt将params→query、headers→header。POST也可以只带query，例如resume cover-by-id/delete-by-id的id。
- 数组query重复同名键；仅null/undefined省略，0/false/空串保留；调用者明确join(',')才是逗号字符串。SSE的wT只删body顶层null/undefined/空串，不能套到全部REST。
- `$0e`严格先取**非null且非undefined data**，否则取非undefined result（允许null），否则undefined；源UI不fallback原对象。SDK须额外始终保留raw。
- 普通xi在HTTP2xx接受数值code0/200/4，也接受非数值/缺code；其它数值code默认拒绝。HTTP401或数值business401先处理，即使returnEnvelope也不绕过；skipLoginRedirect只改变UI跳转副作用。
- HTTP2xx的returnEnvelope可让caller直接检查原始code，如job more的400=没有更多。SDK必须提供raw/returnEnvelope/allowBusinessCodes入口，不能吞掉这些未知状态；SDK不应自动toast、logout或导航。

证据：SWMA001–SWMA003、SWMA538。

## 2. 认证与跨origin边界

普通app拦截器默认60s、withCredentials=true，validToken为空仍可能fallback原始token；Ip只对当前API同源/相对wapi补X-*。main DOUZI SSE同样有raw token fallback；RECOMMEND、RESUME、job-match只用tryGetValidToken。fetch credentials默认include，plusXHR默认withCredentials=true，所以“resolveHeaders只构造Bearer”不等于整个transport是Bearer-only。

SDK单独配置nebula等serviceBases，不默认继承主API Bearer/headers。ASR sign是主API GET；外部配置POST `/v1/nebula/appid/{appId}/nlpproxy/get?sig=...` 使用签名返回的原始Authorization，body userId/expireTimeSecs（app给86400）。实际识别socket来自响应zpSdkInfo.wssAddress[0]，不能硬编路径或追加未经证实token query。

助手STOMP为wsBase+`/wapi/user/ws`，订阅`/user/queue/douzi`，protocols v12/v11/v10.stomp；app的uni adapter可在upgrade header和CONNECT都传Bearer。**浏览器标准WebSocket无法自设任意upgrade header**；SDK需可注入factory/adapter，不能假装STOMP CONNECT-only等价，也不能自动发token到query。心跳25s，重连5s指数到60s，默认5次，稳定60s清计数。

证据：SWMA004–SWMA006、SWMA010、SWMA012、SWMA013、SWMA023–SWMA025。

## 3. SSE请求变体与完成规则

| profile/端点 | body关键区别 | 完成marker的消费者规则 |
|---|---|---|
| DOUZI userSay | main去author、metadata.platform=APP；context parent/cid可覆盖caller；文本/引用/fileInfo、自定义卡、hidden agent_job_chat | 先消费已识别named事件，最后else才检查Yk或data=[DONE]；named delta等携[DONE]不是完成 |
| RECOMMEND userSay | author=user；current_condition；quote metadata；不走main B | 同样前置named事件抢占，最终else才可DONE |
| RESUME_OPTIMIZATION userSay | agent_hint含revisionId；selected_path/name与resume_revision_id；init=resume_polish_init；resume_delta独立队列 | 最终仅无event且data=[DONE]；named[DONE]不算。control/delta等先return，TIP也先消费 |
| POST job/match | body jobDetail；event score与其它data解释文本 | 原consumer无专用DONE判断，非manual close结束UI；EOF不证明匹配业务成功 |
| 专用message/retry | body answer_message_id/user_message_id；URL是SSE.send第三参数override | 复用main profile；没有自动新增APP metadata/author/cid |

SSE parser按空行分帧，trim后JSON.parse data，失败保留string；源实现多条data会保留最后一条而非标准拼接。SDK按app-compatible profile处理时也须保留rawEvent/rawData/rawFrame，允许donePredicate显式覆盖。无Last-Event-ID/通用重连证据；HTTP非2xx和200 JSONcode401的处理与普通xi不同。不要把无DONE EOF自动当成任务/投递成功，亦不要在收到work-mode事件后自动保存设置、开代理或持久化简历。

证据：SWMA007、SWMA008–SWMA014、SWMA017。

## 4. 上传、binary与字段陷阱

- chat upload的sUe/YUe只消费raw.result.file_id，与普通data优先unwrap不同；返回fileInfo是开放对象。SDK仍应正常检查HTTP错误并保留raw，不复制UI弱校验为业务成功保证。
- chat file/upload由uni.uploadFile发送binary part `file`，文件分支可提供规范化fileName，图片分支无此选项；attachment upload/upload-ocr/cover/upload则显式构造FormData。SDK用FormData兼容这些multipart请求，不要固定Content-Type而丢boundary；fileName是binary part文件名，不应编造为必填JSON属性。
- attachment/preview及filename路径、resume preview/report/chat-task预览、file download使用binary/embedded资源。wrapper曾走jt JSON并不代表响应必JSON；registry主transport已校正，transport_variants保留能力边界。
- proxyToggle.mode仅enabled为真且提供mode时传；关闭省略mode。upsert-by-id移除body.update，仅update===false时放query；voice-apply需非空metadata的客户端guard，changes仅非空时附带。
- feedback findByTargetIds用targetEnum，reason/list与report用targetType。编译APP聊天反馈实际platform=MINI_PROGRAM，不能凭平台名改写成APP。

证据：SWMA018–SWMA022；对应各项request/caller片段见表的SWMA引用。

## 5. 核心与辅助调用全表（124项）

调用字段均是本构建观察值/表达式的union；开放/未闭合不等于没有参数。response未证实schema，保留raw。caller列“直/导出”分别是函数绑定计数和唯一导出名候选；零调用也可能经动态module/member访问，不能宣布unused。SSE factory的owner调用不等同send次数；手工补齐的transport路由有单独source范围。

| SDK name | 方法与path | transport | query / path | body已见字段 | 默认query | 直/导出 | 证据 |
|---|---|---|---|---|---|---|---|
| `partnersV2DailyReportByIdGet` | GET `/wapi/partners/v2/daily-report/by-id` | rest_json | id | 开放/未静态闭合 | `{}` | 2/0 | SWMA139,SWMA142 |
| `partnersV2DailyReportPendingDeliveryJobsGet` | GET `/wapi/partners/v2/daily-report/pending-delivery-jobs` | rest_json | ids | 开放/未静态闭合 | `{}` | 1/0 | SWMA143 |
| `partnersV2DailyReportPendingRepliesGet` | GET `/wapi/partners/v2/daily-report/pending-replies` | rest_json | reportId | 开放/未静态闭合 | `{}` | 1/0 | SWMA144 |
| `partnersV2DailyReportRealtimeGet` | GET `/wapi/partners/v2/daily-report/realtime` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 1/0 | SWMA140 |
| `partnersV2DailyReportRealtimePendingRepliesGet` | GET `/wapi/partners/v2/daily-report/realtime/pending-replies` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 1/0 | SWMA141 |
| `partnersV2DailyReportSummaryGet` | GET `/wapi/partners/v2/daily-report/summary` | rest_json | date | 开放/未静态闭合 | `{}` | 1/0 | SWMA199 |
| `partnersV2OfficeRecordListGet` | GET `/wapi/partners/v2/office-record/list` | rest_json | version | 开放/未静态闭合 | `{"version":2}` | 2/0 | SWMA046 |
| `partnersV2OfficeRecordReadPost` | POST `/wapi/partners/v2/office-record/read` | rest_json | 开放/未静态闭合 | ids | `{}` | 2/0 | SWMA047 |
| `partnersZpGeekSendConfirmedResumePost` | POST `/wapi/partners/zp/geek/sendConfirmedResume` | rest_json | 开放/未静态闭合 | jobDetail, messageId | `{}` | 1/0 | SWMA101 |
| `userGeekDeliveryListGet` | GET `/wapi/user/geek/delivery/list` | rest_json | deliveryBy, deliveryStatus, viewed | 开放/未静态闭合 | `{}` | 1/0 | SWMA103,SWMA539 |
| `userGeekDeliveryListByJobIdsPost` | POST `/wapi/user/geek/delivery/listByJobIds` | rest_json | 开放/未静态闭合 | ids, includeDeleted | `{}` | 7/0 | SWMA104 |
| `userFileDownload` | GET `/wapi/user/file/v2/download` | binary | fileId, t | 开放/未静态闭合 | `{}` | 0/0 | SWMA529,SWMA530 |
| `userFileV2UploadPost` | POST `/wapi/user/file/v2/upload` | multipart | 开放/未静态闭合 | 开放/未静态闭合 | `{"source":"feedback"}` | 0/0 | SWMA203 |
| `partnersExpectGetGet` | GET `/wapi/partners/expect/get` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 4/0 | SWMA145 |
| `partnersExpectUpsertPost` | POST `/wapi/partners/expect/upsert` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 3/0 | SWMA146 |
| `partnersJobAgentSearchPost` | POST `/wapi/partners/job/agent-search` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 1/0 | SWMA202 |
| `partnersJobBrandFullInfo4GeekPost` | POST `/wapi/partners/job/brandFullInfo4Geek` | rest_json | brandId, jobId | 开放/未静态闭合 | `{}` | 1/0 | SWMA097 |
| `partnersJobDetailGet` | GET `/wapi/partners/job/detail` | rest_json | encryptId, source | 开放/未静态闭合 | `{}` | 3/0 | SWMA098 |
| `partnersJobRecommendPost` | POST `/wapi/partners/job/recommend` | rest_json | 开放/未静态闭合 | positionCode | `{}` | 1/0 | SWMA099 |
| `partnersJobSearchConditionPost` | POST `/wapi/partners/job/search-condition` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 1/0 | SWMA210 |
| `partnersJobWikiPositionPost` | POST `/wapi/partners/job/wiki/position` | rest_json | positionCode | 开放/未静态闭合 | `{}` | 1/0 | SWMA100 |
| `partnersMarketPreferenceProfileGet` | GET `/wapi/partners/market-preference/profile` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 1/0 | SWMA209 |
| `partnersSuggestHomepageV2Get` | GET `/wapi/partners/suggest/homepage/v2` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 2/0 | SWMA149 |
| `homepageBootstrap` | GET `/wapi/partners/v2/homepage/bootstrap` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 1/0 | SWMA137 |
| `partnersV2MarketInsightCompanyDynamicsGet` | GET `/wapi/partners/v2/market-insight/company-dynamics` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 1/0 | SWMA214 |
| `partnersV2MarketInsightCompanySourcesGet` | GET `/wapi/partners/v2/market-insight/company-sources` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 1/0 | SWMA215 |
| `partnersV2MarketInsightCompetitionGet` | GET `/wapi/partners/v2/market-insight/competition` | rest_json | codes, level | 开放/未静态闭合 | `{}` | 2/0 | SWMA212,SWMA213 |
| `partnersV2MarketInsightWeeklyMarketGet` | GET `/wapi/partners/v2/market-insight/weekly-market` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 1/0 | SWMA211 |
| `userFeedbackFindByTargetIdsPost` | POST `/wapi/user/feedback/findByTargetIds` | rest_json | 开放/未静态闭合 | targetEnum, targetIds | `{}` | 1/0 | SWMA152 |
| `userFeedbackReasonListGet` | GET `/wapi/user/feedback/reason/list` | rest_json | targetType | 开放/未静态闭合 | `{}` | 2/0 | SWMA153 |
| `userFeedbackReportPost` | POST `/wapi/user/feedback/report` | rest_json | 开放/未静态闭合 | attachmentIds, commentText, feedbackType, jobId, platform, reasonIds, targetId, targetType | `{}` | 3/0 | SWMA154 |
| `userGeekAgentConfigCheckDeliverPreconditionGet` | GET `/wapi/user/geek/agent/config/checkDeliverPrecondition` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 1/0 | SWMA059 |
| `userGeekAgentConfigFindLatestGet` | GET `/wapi/user/geek/agent/config/findLatest` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 4/0 | SWMA060 |
| `userGeekAgentConfigGreetingSuggestGet` | GET `/wapi/user/geek/agent/config/greetingSuggest` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 1/0 | SWMA061 |
| `userGeekAgentConfigUpdateAutoDeliveryStatusPost` | POST `/wapi/user/geek/agent/config/updateAutoDeliveryStatus` | rest_json | deliveryMode, enabled | 开放/未静态闭合 | `{"deliveryMode":"AUTO"}` | 3/0 | SWMA062 |
| `userGeekAgentConfigUpdateByIdPost` | POST `/wapi/user/geek/agent/config/updateById` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 2/0 | SWMA063 |
| `userGeekAgentConfigUpdateGreetingPost` | POST `/wapi/user/geek/agent/config/updateGreeting` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 1/0 | SWMA064 |
| `userGeekAgentTaskTaskPagePost` | POST `/wapi/user/geek/agent/task/task-page` | rest_json | 开放/未静态闭合 | page, pageSize, taskType | `{}` | 1/0 | SWMA151 |
| `workSettingsGet` | GET `/wapi/user/geek/agent/work-settings` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 2/0 | SWMA036,SWMA133 |
| `workCommunicationSet` | POST `/wapi/user/geek/agent/work-settings/communication` | rest_json | 开放/未静态闭合 | autoChatEnabled | `{}` | 1/0 | SWMA037 |
| `workDeliverySet` | POST `/wapi/user/geek/agent/work-settings/delivery` | rest_json | 开放/未静态闭合 | enabled, matchStrategy, method, preferences | `{}` | 1/0 | SWMA038 |
| `workModeSet` | POST `/wapi/user/geek/agent/work-settings/work-mode` | rest_json | 开放/未静态闭合 | workMode | `{}` | 1/0 | SWMA134 |
| `userGeekResumeAttachmentChatUploadPost` | POST `/wapi/user/geek/resume/attachment/chat-upload` | rest_json | id | 开放/未静态闭合 | `{}` | 1/0 | SWMA032,SWMA105 |
| `userGeekResumeAttachmentCoverUploadPost` | POST `/wapi/user/geek/resume/attachment/cover/upload` | multipart | 开放/未静态闭合 | file | `{}` | 2/0 | SWMA106,SWMA196,SWMA197 |
| `userGeekResumeAttachmentDefaultPost` | POST `/wapi/user/geek/resume/attachment/default` | rest_json | 开放/未静态闭合 | id | `{}` | 5/0 | SWMA033,SWMA107 |
| `userGeekResumeAttachmentDeletePost` | POST `/wapi/user/geek/resume/attachment/delete` | rest_json | 开放/未静态闭合 | id | `{}` | 3/0 | SWMA034,SWMA108 |
| `userGeekResumeAttachmentExtractAvatarGet` | GET `/wapi/user/geek/resume/attachment/extract-avatar` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 0/0 | SWMA109 |
| `userGeekResumeAttachmentHasDefaultGet` | GET `/wapi/user/geek/resume/attachment/has-default` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 0/0 | SWMA110 |
| `userGeekResumeAttachmentListPost` | POST `/wapi/user/geek/resume/attachment/list` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 10/0 | SWMA035,SWMA057,SWMA111 |
| `userGeekResumeAttachmentPreviewGet` | GET `/wapi/user/geek/resume/attachment/preview` | binary | _t, download, filename, id, ifDownload | 开放/未静态闭合 | `{}` | 0/0 | SWMA112,SWMA540 |
| `userGeekResumeAttachmentPreviewFilenameGet` | GET `/wapi/user/geek/resume/attachment/preview/{filename}` | binary | path filename; query download | 开放/未静态闭合 | `{}` | 0/0 | SWMA113 |
| `userGeekResumeAttachmentUploadPost` | POST `/wapi/user/geek/resume/attachment/upload` | multipart | 开放/未静态闭合 | file | `{}` | 1/0 | SWMA114,SWMA198 |
| `userGeekResumeAttachmentUploadOcrPost` | POST `/wapi/user/geek/resume/attachment/upload-ocr` | multipart | 开放/未静态闭合 | file | `{}` | 0/0 | SWMA115 |
| `userGeekResumeZpAttachmentPreviewGet` | GET `/wapi/user/geek/resume/zp/attachment/preview` | binary | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 0/0 | SWMA116 |
| `userGeekResumeZpAttachmentPreviewFilenameGet` | GET `/wapi/user/geek/resume/zp/attachment/preview/{filename}` | binary | path filename; query 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 0/0 | SWMA117 |
| `userNotificationsPermissionPost` | POST `/wapi/user/notifications/permission` | rest_json | 开放/未静态闭合 | status | `{}` | 1/0 | SWMA039 |
| `userNotificationsSettingGet` | GET `/wapi/user/notifications/setting` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 2/0 | SWMA040 |
| `userNotificationsSettingPut` | PUT `/wapi/user/notifications/setting` | rest_json | 开放/未静态闭合 | enablePush, reminderTypes | `{}` | 2/0 | SWMA041 |
| `userNotificationsSettingEventPut` | PUT `/wapi/user/notifications/setting/event` | rest_json | 开放/未静态闭合 | events | `{}` | 1/0 | SWMA042 |
| `userResumeV2AutocompleteMajorGet` | GET `/wapi/user/resumeV2/autocomplete/major` | rest_json | query | 开放/未静态闭合 | `{}` | 1/0 | SWMA118 |
| `userResumeV2CertificateGet` | GET `/wapi/user/resumeV2/certificate` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 0/0 | SWMA119 |
| `userResumeV2CitiesGet` | GET `/wapi/user/resumeV2/cities` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 3/0 | SWMA120,SWMA147 |
| `userResumeV2EnumsGet` | GET `/wapi/user/resumeV2/enums` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 3/0 | SWMA121 |
| `userResumeV2GetCompleteResumeGet` | GET `/wapi/user/resumeV2/getCompleteResume` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 3/0 | SWMA122 |
| `userResumeV2PositionsGet` | GET `/wapi/user/resumeV2/positions` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 5/0 | SWMA123,SWMA148 |
| `userResumeV2SavePost` | POST `/wapi/user/resumeV2/save` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 12/0 | SWMA124 |
| `userResumeV2SchoolsGet` | GET `/wapi/user/resumeV2/schools` | rest_json | search | 开放/未静态闭合 | `{}` | 1/0 | SWMA125 |
| `userResumeV2StudentPositionsGet` | GET `/wapi/user/resumeV2/student/positions` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 0/0 | SWMA126 |
| `userResumeV2ZpResumeSyncPost` | POST `/wapi/user/resumeV2/zp/resume/sync` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 0/1 | SWMA127 |
| `userSpecialFocusGet` | GET `/wapi/user/special-focus` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 1/0 | SWMA043 |
| `userSpecialFocusPost` | POST `/wapi/user/special-focus` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 0/0 | SWMA044 |
| `userSpecialFocusIdDelete` | DELETE `/wapi/user/special-focus/{id}` | rest_json | path id; query 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 1/0 | SWMA045 |
| `userToolNebulaSignGetGet` | GET `/wapi/user/tool/nebula/sign/get` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 1/0 | SWMA096 |
| `proxyCanEnable` | GET `/wapi/user/v2/agent/proxy/can-enable` | rest_json | mode | 开放/未静态闭合 | `{}` | 1/0 | SWMA135 |
| `proxyPause` | POST `/wapi/user/v2/agent/proxy/pause` | rest_json | 开放/未静态闭合 | paused, reason | `{}` | 2/0 | SWMA030 |
| `proxyToggle` | POST `/wapi/user/v2/agent/proxy/toggle` | rest_json | 开放/未静态闭合 | enabled, mode | `{}` | 3/0 | SWMA031,SWMA136 |
| `nebulaAsrConfigGet` | POST `/v1/nebula/appid/{appId}/nlpproxy/get` | rest_json | path appId; query sig | expireTimeSecs, userId | `{}` | 0/0 | SWMA095 |
| `partnersMemoryChangesPendingGet` | GET `/wapi/partners/memory/changes/pending` | rest_json | trigger | 开放/未静态闭合 | `{}` | 1/0 | SWMA183 |
| `partnersMemoryCooldownConfirmPost` | POST `/wapi/partners/memory/cooldown/confirm` | rest_json | 开放/未静态闭合 | category, cooldownKey | `{}` | 2/0 | SWMA184 |
| `partnersMemoryCooldownDismissPost` | POST `/wapi/partners/memory/cooldown/dismiss` | rest_json | 开放/未静态闭合 | cooldownKey | `{}` | 2/0 | SWMA185 |
| `partnersMemoryCooldownPendingGet` | GET `/wapi/partners/memory/cooldown/pending` | rest_json | category | 开放/未静态闭合 | `{}` | 1/0 | SWMA186 |
| `partnersMemoryDeletePost` | POST `/wapi/partners/memory/delete` | rest_json | 开放/未静态闭合 | memoryKey | `{}` | 1/0 | SWMA187 |
| `partnersMemoryListGet` | GET `/wapi/partners/memory/list` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 1/0 | SWMA188 |
| `partnersMemorySwitchPost` | POST `/wapi/partners/memory/switch` | rest_json | 开放/未静态闭合 | enabled | `{}` | 1/0 | SWMA189 |
| `partnersMemorySwitchStatusGet` | GET `/wapi/partners/memory/switch/status` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 1/0 | SWMA190 |
| `chatMessagesList` | GET `/wapi/partners/v2/chat/conversation/messages` | rest_json | conversation_id, limit, message_id | 开放/未静态闭合 | `{"limit":"20"}` | 12/0 | SWMA079 |
| `chatConversationGet` | GET `/wapi/partners/v2/chat/conversation/{id}` | rest_json | path id; query 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 1/0 | SWMA078 |
| `chatConversationsList` | GET `/wapi/partners/v2/chat/conversations` | rest_json | limit, offset, relatedId, type | 开放/未静态闭合 | `{}` | 5/0 | SWMA080 |
| `chatFileDownload` | GET `/wapi/partners/v2/chat/file/download` | binary | _t, fileId | 开放/未静态闭合 | `{}` | 0/0 | SWMA531 |
| `chatFileUpload` | POST `/wapi/partners/v2/chat/file/upload` | multipart | 开放/未静态闭合 | file | `{}` | 2/0 | SWMA067,SWMA068 |
| `chatJobMessageMore` | POST `/wapi/partners/v2/chat/job/message/more` | rest_json | 开放/未静态闭合 | id | `{}` | 1/0 | SWMA081 |
| `chatJobMessageRead` | POST `/wapi/partners/v2/chat/job/message/read` | rest_json | 开放/未静态闭合 | id, jobId | `{}` | 1/0 | SWMA082 |
| `chatJobTaskMore` | POST `/wapi/partners/v2/chat/job/task/more` | rest_json | 开放/未静态闭合 | id | `{}` | 1/0 | SWMA083 |
| `chatMessageCompleted` | POST `/wapi/partners/v2/chat/message/completed` | rest_json | 开放/未静态闭合 | clickButtonStyle, clickedButton, hidden, id, selectedId, selectedTitle | `{}` | 9/0 | SWMA084 |
| `chatMessageRetry` | POST `/wapi/partners/v2/chat/message/retry` | sse | 开放/未静态闭合 | answer_message_id, user_message_id | `{}` | 0/0 | SWMA532 |
| `chatRecordsList` | GET `/wapi/partners/v2/chat/record/list` | rest_json | taskId | 开放/未静态闭合 | `{}` | 3/0 | SWMA085 |
| `chatResultsList` | GET `/wapi/partners/v2/chat/result/list` | rest_json | taskId | 开放/未静态闭合 | `{}` | 5/0 | SWMA086 |
| `chatResultRead` | POST `/wapi/partners/v2/chat/result/read` | rest_json | 开放/未静态闭合 | id | `{}` | 3/0 | SWMA087 |
| `chatRecentPendingDeliveries` | GET `/wapi/partners/v2/chat/result/recentAiPendingDelivery` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 1/0 | SWMA088 |
| `chatTodayRecommendations` | GET `/wapi/partners/v2/chat/result/todayRecommendJobByResume` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 1/0 | SWMA089 |
| `chatStopSay` | POST `/wapi/partners/v2/chat/stopSay` | rest_json | 开放/未静态闭合 | conversation_id | `{}` | 3/0 | SWMA090 |
| `chatTagMessages` | GET `/wapi/partners/v2/chat/tag/messages` | rest_json | conversation_id, tag, taskInfo | 开放/未静态闭合 | `{}` | 1/0 | SWMA091 |
| `chatTaskGet` | GET `/wapi/partners/v2/chat/task/detail` | rest_json | id | 开放/未静态闭合 | `{}` | 3/0 | SWMA092 |
| `chatTasksList` | GET `/wapi/partners/v2/chat/task/list` | rest_json | conversationId | 开放/未静态闭合 | `{}` | 7/0 | SWMA093 |
| `chatTasksUnfinished` | GET `/wapi/partners/v2/chat/task/unfinishedByConversation` | rest_json | 开放/未静态闭合 | 开放/未静态闭合 | `{}` | 1/0 | SWMA094 |
| `chatUserSay` | POST `/wapi/partners/v2/chat/userSay` | sse | 开放/未静态闭合 | agent_hint, author, content, conversation_id, current_condition, metadata, parent | `{}` | 19/0 | SWMA138,SWMA150,SWMA195 |
| `userDiagnosisGuideHintsTaskByDateGet` | GET `/wapi/user/diagnosis/guide-hints/task/by-date` | rest_json | checkTimeout, date | 开放/未静态闭合 | `{}` | 4/0 | SWMA128,SWMA130 |
| `userDiagnosisTaskGet` | GET `/wapi/user/diagnosis/task` | rest_json | taskId | 开放/未静态闭合 | `{}` | 5/0 | SWMA129,SWMA131,SWMA132 |
| `userResumeRevisionAnalyzeLatestTaskGet` | GET `/wapi/user/resume-revision/analyze/latest-task` | rest_json | attachmentId | 开放/未静态闭合 | `{}` | 4/0 | SWMA077 |
| `resumeRevisionChatTaskPreview` | GET `/wapi/user/resume-revision/chat-task/preview` | binary | _t, filename, ifDownload, taskId | 开放/未静态闭合 | `{}` | 0/0 | SWMA533,SWMA534 |
| `userResumeRevisionCoverByIdPost` | POST `/wapi/user/resume-revision/cover-by-id` | rest_json | id | 开放/未静态闭合 | `{}` | 1/0 | SWMA192 |
| `userResumeRevisionDeleteByIdPost` | POST `/wapi/user/resume-revision/delete-by-id` | rest_json | id | 开放/未静态闭合 | `{}` | 3/0 | SWMA193 |
| `userResumeRevisionDetailByAttachmentGet` | GET `/wapi/user/resume-revision/detail-by-attachment` | rest_json | attachmentId | 开放/未静态闭合 | `{}` | 2/0 | SWMA074 |
| `userResumeRevisionDetailByIdGet` | GET `/wapi/user/resume-revision/detail-by-id` | rest_json | id | 开放/未静态闭合 | `{}` | 8/0 | SWMA076 |
| `userResumeRevisionDetailByMessageGet` | GET `/wapi/user/resume-revision/detail-by-message` | rest_json | messageId | 开放/未静态闭合 | `{}` | 1/0 | SWMA075 |
| `userResumeRevisionHealthDiagnosisPost` | POST `/wapi/user/resume-revision/health-diagnosis` | rest_json | 开放/未静态闭合 | resumeRevisionId | `{}` | 1/0 | SWMA071 |
| `userResumeRevisionOptimizeRecordsGet` | GET `/wapi/user/resume-revision/optimize-records` | rest_json | pageNo, pageSize, path, resumeRevisionId | 开放/未静态闭合 | `{"pageNo":1,"pageSize":10}` | 2/0 | SWMA070 |
| `resumeRevisionPreview` | GET `/wapi/user/resume-revision/preview` | binary | _t, filename, id, ifDownload, templateId | 开放/未静态闭合 | `{}` | 0/0 | SWMA535,SWMA541 |
| `userResumeRevisionRecentGet` | GET `/wapi/user/resume-revision/recent` | rest_json | limit, offset | 开放/未静态闭合 | `{}` | 6/0 | SWMA194 |
| `resumeRevisionReportPreview` | GET `/wapi/user/resume-revision/report/preview` | binary | _t, filename, ifDownload, taskId | 开放/未静态闭合 | `{}` | 0/0 | SWMA536,SWMA537 |
| `userResumeRevisionUpsertByIdPost` | POST `/wapi/user/resume-revision/upsert-by-id` | rest_json | update | analysisTaskId, attachmentId, content, id, messageId, metadata, optimizeFlow | `{}` | 6/0 | SWMA073 |
| `userResumeRevisionVoiceApplyPost` | POST `/wapi/user/resume-revision/voice-apply` | rest_json | 开放/未静态闭合 | changes, resumeRevision | `{}` | 3/0 | SWMA072 |
| `userResumeRevisionVoiceWorkbenchStateGet` | GET `/wapi/user/resume-revision/voice/workbench-state` | rest_json | resumeRevisionId | 开放/未静态闭合 | `{}` | 4/0 | SWMA069 |
| `jobMatchStream` | POST `/wapi/partners/job/match` | sse | 开放/未静态闭合 | jobDetail | `{}` | 0/0 | SWMA191 |

## 6. 未见的远程操作与非AI排除

本构建conversation路径字面量仅有conversation/{id} GET、conversation/messages GET、conversations GET；远程rename/delete/top/pin/clear未找到。clearConversationMessages/resetSession只是本地状态方法，不能因此生成删除会话RPC。quick_reply主要是SSE+userSay选择，没有独立setter；主页suggestions有真实GET接口。不能据此断言服务端不存在其它版本端点，但SDK不能凭名称编造它们。

结果投递桥接单列auxiliary_ai_result_delivery_bridge：delivery/list、listByJobIds、sendConfirmedResume、daily-report全部六个路径及office-record/list与read。listByJobIds虽用POST，仍是列表读取。office-record/read仅标办公室记录已读；list固定version=2。sendConfirmedResume是真实投递写操作，只允许调用方显式调用；SDK不能因SSE、卡片、待确认结果而自动触发。已见sender的messageId取pending raw item.id转Number，不能按同名字段当作普通AI消息M.id。以上均仅静态分析，本轮未执行。

以下非AI项目仅保留为审计边界，include_in_sdk=false；例如账号登录、BOSS独立IM、普通独立投递、push/APM/更新等，不纳入AI registry默认便利方法。通用requestRaw仍可让调用者使用另行验证的接口。

| 方法 | path | 原因/边界 |
|---|---|---|
| POST | `/auth/login` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| POST | `/wapi/chat/exchange/accept` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| POST | `/wapi/chat/exchange/reject` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| POST | `/wapi/chat/history` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| GET | `/wapi/chat/message` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| POST | `/wapi/partners/app-update/wgt/check` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| POST | `/wapi/partners/app-update/wgt/{releaseId}/download-complete` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| GET | `/wapi/partners/user/focus-brands` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| POST | `/wapi/partners/zp/geek/sendResume` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| POST | `/wapi/user/agreement/agree` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| GET | `/wapi/user/agreement/detail` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| GET | `/wapi/user/agreement/list` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| GET | `/wapi/user/agreement/zp/get` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| POST | `/wapi/user/auth/login/invite-code` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| POST | `/wapi/user/auth/logout` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| POST | `/wapi/user/auth/phone/login` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| POST | `/wapi/user/auth/phone/sendLoginVerifyCodeV2` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| POST | `/wapi/user/auth/wechat/account-binding` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| POST | `/wapi/user/auth/wechat/bindLogin` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| POST | `/wapi/user/auth/wechat/code2SessionLogin` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| GET | `/wapi/user/auth/zp/chat/ticket/h5` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| GET | `/wapi/user/auth/zp/chat/ticket/mp` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| GET | `/wapi/user/auth/zp/chat/ticket/pc` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| GET | `/wapi/user/auth/zp/chat/token/h5` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| GET | `/wapi/user/auth/zp/chat/token/mp` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| GET | `/wapi/user/auth/zp/chat/token/pc` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| POST | `/wapi/user/auth/zp/get/login` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| GET | `/wapi/user/auth/zp/get/login/info` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| GET | `/wapi/user/auth/zp/hasWechat` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| POST | `/wapi/user/auth/zp/home-banner/login` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| GET | `/wapi/user/auth/zp/qrcode/login` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| POST | `/wapi/user/auth/zp/resume/login` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| GET | `/wapi/user/auth/zp/resume/login/info` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| POST | `/wapi/user/auth/zp/updateIdentity` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| POST | `/wapi/user/cancel/confirm` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| POST | `/wapi/user/cancel/send-verify-code` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| GET | `/wapi/user/check-nickname` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| POST | `/wapi/user/guide/check` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| POST | `/wapi/user/guide/complete` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| GET | `/wapi/user/info` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| POST | `/wapi/user/push/token/click` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| POST | `/wapi/user/push/token/register` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| POST | `/wapi/user/push/token/unregister` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| GET | `/wapi/user/report/reason/tree` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| POST | `/wapi/user/report/submit` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| POST | `/wapi/user/updateInfo` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |
| GET | `/wapi/zppassport/captcha/getTypeV2` | non_ai_excluded；wrapper/调用site仅证明客户端能力 |

## 7. SDK生成与验证边界

注册表的字段类型应保持开放，核心convenience只在已证实契约上加类型；低级call(name,{path,query,body})和requestRaw要保留未知schema/原始响应。HTTP/JSON、SSE、multipart、binary和外部service base不能混用。动态filename等模板应由path参数编码，不能删掉或变成query；普通path key已从params/query union剔除。

本次QA检查operation name/id唯一、动态path字段、方法/transport、source范围与SHA、跨origin ASR标记、returnEnvelope能力、POST query字段和条件参数。没有用真实token或业务端点作在线测试；SDK实现/本地fixture测试由根任务完成，不能把静态catalog称为服务器实测的完整公开API文档。
