# 职决 AI、登录与 BOSS TypeScript SDK 0.2（恢复版）

根据职决 iOS 2.3.0（200300001）的安装包静态恢复，非官方 SDK。运行代码没有第三方依赖，使用 Fetch、ReadableStream、FormData 和可注入 WebSocket。0.2增加登录、会话续期策略、ID命名空间、确认投递、BOSS MQTT/protobuf，以及完整离线示例。提供源码、预编译 ESM、TypeScript 声明、接口目录和本地 mock 测试。

接口目录的“完整”范围是**该构建中能静态定位的 AI 及关联接口**，不代表后端所有路由。wrapper 存在不等于运行时已调用；字段清单是客户端构造/消费记录，未知响应使用开放类型并保留 raw。没有连接生产服务做集成验证。

## 安装和构建

Node.js 22+，或具备上述 Web API 的浏览器。可直接导入包内 `dist/index.js`；重新构建需要开发依赖 TypeScript。

```sh
npm ci --ignore-scripts
npm test
npm run check:example
npm run example:mock
```

```ts
import { ZhijueAIClient, buildDouziText } from './dist/index.js';

const client = new ZhijueAIClient({
  baseUrl: 'https://your-authorized-api.example',
  getAccessToken: async () => yourSessionAccessToken,
  headers: {'X-App-Version': '2.3.0', 'X-Platform': 'ios'},
});

const payload = buildDouziText('请分析我的求职方向', {
  context: {parent: lastEligibleServerMessageId, conversation_id: conversationId},
});
const stream = client.userSay(payload);
try {
  for await (const event of stream) {
    // event.raw 保留原始SSE字段，event.data为trim+JSON解析后的值。
    if (event.event === 'delta') renderYourDelta(event.data);
    if (event.workModeSignal) showPendingWorkMode(event.workModeSignal);
  }
} finally {
  const completion = await stream.completion;
  // done / eof / aborted / consumer_cancelled / error 分开处理。
  // completion.workModeSignal 是待处理信号，不是配置提交回执。
}
```

构造 client、构造 payload、创建 SSE session 都不发送请求；开始迭代流或调用 HTTP 方法才发请求。`completion` 在消费/取消后结束，不要在从未消费的 session 上单独等待它。

## 鉴权和 HTTP

- 可由调用方提供token，也可使用下述登录/session manager；SDK不读取App凭据，不实现UI登录跳转。配置manager时有明确的到期/401策略。
- API 请求默认 `credentials:'include'`，HTTP 默认 `cache:'no-store'`；Node Fetch 没有自动共享 App/browser Cookie jar。
- 可通过 `headers` provider 提供设备/版本等 X 头；SDK 不生成或伪造 App 设备身份。大小写不同的 Authorization 仍只保留一个。
- REST 返回 `{data,raw,status,headers}`。data 优先非 null/undefined 的 `raw.data`，再取 `raw.result`；保留 raw 以核实服务器版本和未知字段。
- 按已见客户端规则，数值 code 0/200/4 成功，401 为鉴权错误，其它数值码为 BusinessError；非数值 code 不据此拒绝。非 2xx 为 HttpError。
- `returnEnvelope:true`在2xx时让data直接为raw并跳过普通业务码拒绝；`allowBusinessCodes:[400]`可处理job more的“没有更多”等状态。两者都不绕过HTTP错误/401。
- 上传采用独立 `result.file_id` 契约，不按 REST 的 data 优先规则取上传结果。
- 写请求、AI SSE、确认投递和BOSS消息不自动重放，不自动开代理，也不将HTTP成功解释成真实任务执行成功。

query数组用重复同名键，空格按encodeURIComponent编码；仅省略null/undefined，保留0/false/空串。SSE transport仅删除body顶层null/undefined/空串，嵌套字段保留；普通REST body不套这层SSE过滤。

外部语音服务 `base=nebula` 必须单独提供 `serviceBases.nebula` 和（如需要）`serviceHeaders.nebula`。外部请求不继承 API Bearer、设备头或 Cookie；其签名/参数必须按接口目录和实际授权环境提供。

## 完整接口目录与通用调用

`ENDPOINTS` 为生成的类型化操作名目录，来源见 [接口契约](contracts/ai-api-catalog.json)。每项保留 method、path、base、transport、默认 query、路径参数；完整 JSON 还有源码 wrapper、调用点、字段表达式和未知边界。

逐项参数表见 [AI接口参数参考](contracts/AI接口参数参考.md)，共同传输/鉴权约定见 [sdk-contracts.json](contracts/sdk-contracts.json)。`SOURCE_BUILD`导出本构建及源码hash，便于版本核对。

```ts
import { ENDPOINTS } from './dist/index.js';

// 普通JSON接口：保留精确的参数位置和服务端原始响应。
const history = await client.call('chatMessagesList', {
  query: {conversation_id: conversationId, limit: 30},
});
const task = await client.call('chatTaskGet', {query: {id: taskId}});
const results = await client.call('chatResultsList', {query: {taskId}});
await client.call('chatMessageCompleted', {
  body: {id: sourceMessageId, clickedButton: selectedButton},
});

// 动态path字段不会再自动混到query。
await client.call('chatConversationGet', {path: {id: conversationId}});

// POST不一定把所有字段放在body，例如这两个接口id在query。
await client.call('userResumeRevisionCoverByIdPost', {query: {id: revisionId}});

// 所有已登记SSE端点也可走同一目录。
const retry = client.stream('chatMessageRetry', {
  body: {answer_message_id: assistantId, user_message_id: originalUserId},
});
```

字段清单不自动变成“所有字段必填”；动态表达式不求值，未知字段不删除。通用调用不会复刻各 UI wrapper 的对象转换；例如 `upsert-by-id` 的 `update:false` 放 query、body 删除 update，需按参考文档传入。multipart 用 FormData；binary 默认 Blob，预览存在 JSON/二进制变体时可明确 `responseType:'json'|'blob'|'text'`。

聊天会话未发现可据此实现的 rename/delete/top/clear 路由，SDK没有虚构这些方法。BOSS聊天使用0.2新增的独立MQTT/protobuf模块，不复用助手STOMP。

关联的日报、待确认结果、delivery/list/status与sendConfirmedResume桥接接口单列为辅助操作，也通过call显式调用；SDK不会因收到AI结果或工作模式标记自动确认/发送简历。消息id、taskId、task_result_id与jobId的命名空间按原参数区分，不用一个id互换。

## 高层方法与请求模板

| 方法/模板 | 功能 |
|---|---|
| `userSay` / `retry` / `stopSay` | 对话SSE、轮次重试、服务端停止 |
| `conversations` / `conversation` / `messages` | 会话和原始消息历史 |
| `uploadFile` / `downloadFile` | multipart文件上传与二进制下载 |
| `bootstrap` / `getWorkSettings` | 原始首页和工作设置快照；无SDK本地策略缓存 |
| `setWorkMode` | 仅POST产品 JOB_SEEKING/MARKET_WATCHING |
| `canEnableProxy` / `toggleProxy` | 独立三种proxyMode与enabled操作 |
| `saveCommunication` / `saveDelivery` | 单次设置保存；不自动发额外耦合请求 |
| `buildDouziText` / `buildRecommendText` | 普通对话/推荐请求模板 |
| `buildResumeOptimizationText` / `buildResumeOptimizationInit` | 简历优化文本/初始化模板 |
| `buildModeSelection` | 卡选择的 metadata.parent/style；保留原始wireId |
| `buildAgentJobChat` | 隐藏岗位指令模板；message_id与job_ids分开 |

模板不复刻整个 App 的 store、父消息选择器、市场上下文快照、推荐筛选器、简历选区归一和 UI 权限/状态门禁。调用方提供上下文；复杂/新变体直接用开放 `UserSayRequest`。`buildDouziText` 是普通文本模板；诊断、优化等特殊 metadata/system_hints 应按接口参考自行构造。

推荐引用用 `quote:{type:'list'|'text'|'job',text,normalizedText?,jobId?}`，正文part在引用之前；推荐/简历模板不强加主聊天的platform和metadata过滤。简历模板的 `selectedPath`、`selectedPathName`、`selectedText` 是单个字符串：生成的 `selected_path/selected_path_name` 为数组，而 `selected_text.path/path_name` 仍是字符串。

```ts
const selection = buildModeSelection({
  cardMessageId: card.id,
  wireId: originalOption.id,
  title: originalOption.title,
  context: {parent: lastEligibleServerMessageId, conversation_id: conversationId},
});
```

`selection.metadata.parent` 是目标卡 ID；顶层 parent 是另一个会话上下文，不强制相等。没有合法顶层 parent 时模板会移除顶层 parent/conversation_id。模板不修改原卡或认定服务端保存选择。

## SSE 的完成和工作模式信号

解析支持 UTF-8 分块、CR/LF/CRLF、BOM、多行 data、注释、id/retry；EOF 不补发缺少空行终止的残帧。保留未设置 event 的状态，不自动补 `'message'`。

原App每帧只保留最后一条data行；SDK默认 `dataLineMode:'app-last-line'`据此生成event.data。event.raw.data始终保留标准多行拼接；需要标准SSE语义时可设 `dataLineMode:'standard'`，不丢原文。

App 的 DONE 规则因消费者不同：

- DOUZI：data 解码为 `[DONE]` 且没有被 delta/notice/control 等先行事件分支截获。
- RECOMMEND：推荐条件等先行事件也可截获 DONE。
- RESUME_OPTIMIZATION：只有无/空 event 的 DONE 算逻辑完成。
- job-match：原消费者按连接关闭收尾，没有已证 DONE 协议；SDK允许EOF，但仍报告 sawDone=false。

默认对话流若没有接受的 DONE，EOF 抛 IncompleteStreamError，并在 completion 标记 eof。可用 `requireDone:false` 观察特殊环境，或显式 `donePredicate` 适配已另行取证的服务端变体。丢弃迭代/`abort()` 只取消本地传输，服务端 stopSay 要单独调用；两者不保证任务后端已停止。

工作模式仅对主聊天 delta-add 的非用户消息识别：

```text
douzi_work_mode_job_seeking → JOB_SEEKING
douzi_work_mode_market_matching / data_market_matching → MARKET_WATCHING
```

递归扫描最多8层，流内最后一个有效标记覆盖旧值；接受的DONE消费该信号。SDK把它作为事件/完成摘要返回，**不自动执行 work-mode POST 或 proxy toggle**。EOF时未消费信号保留在 completion.pendingWorkMode 供诊断，不自动重试。DONE、产品模式保存、代理关闭、办公室刷新是不同回执。

## 助手 STOMP

```ts
import { AssistantStompClient } from './dist/index.js';

const pushes = new AssistantStompClient({
  url: 'wss://your-authorized-api.example/wapi/user/ws',
  getAccessToken: async () => yourSessionAccessToken,
  webSocketFactory: yourPlatformWebSocketFactory,
  onMessage: ({data, frame}) => inspectPush(data),
});
await pushes.connect(); // CONNECTED后订阅 /user/queue/douzi
// ...
pushes.close();
```

factory 收到 `(url, protocols, upgradeHeaders)`。原 App 同时给 upgrade 和 STOMP CONNECT 传 Bearer；原生浏览器 WebSocket 无法设置任意 upgrade header，因此默认浏览器 transport 仅能提供 CONNECT头/浏览器自带Cookie，**不能承诺与原 App 的 upgrade 鉴权等价**。需要该头的环境必须注入适配器；不把 token 改塞 URL。

SDK支持字节级content-length、分块UTF-8、NUL正文、头转义、CONNECTED/ERROR、心跳、显式关闭，不做 App 的指数重连、UI队列、bootstrap或store写入。推送载荷原样交给调用方；eventType/ts不被升级为服务端版本仲裁。

## 登录、Token到期与续期

**当前包没有已证refresh HTTP接口；原refreshToken函数直接抛“单token模式不支持刷新token”。SDK不发送猜测的refresh请求。**

```ts
import { createAuthenticatedClient } from './dist/index.js';

const {client, auth, sessions} = createAuthenticatedClient({baseUrl});
await auth.captchaType();
// proof必须来自真实验证码提供方；远程挑战SDK网络协议未恢复。
await auth.sendPhoneCode(phone, proof);
const login = await auth.loginWithPhoneCode(phone, smsCode, {platform:'ios'});
// 若正向检测到NOT_AUTHORIZED_ZP，需独立完成用户授权流程。
if (login.authorizationRequired === true) showYourAuthorizationFlow();
```

已实现手机号短信登录、入站ZP ticket登录、资料查询、显式BOSS数据授权步骤、logout、会话导入/导出和内存到期管理。短信body的loginDevice是H5，登录body的sessionType是APP；二者不是同一个字段。验证码业务只接受Number转换后的0/200（非有限值按原消费者边界处理），不把通用code4当短信发送成功。SDK会保留调用方显式captcha headers；这是对原wrapper覆盖header问题的修正。

登录TTL按数值accessExpiresIn→数值expiresIn→7200秒，转换成绝对毫秒deadline；数值字符串不会被当作TTL，0表示立即到期。无效负数/NaN等被SDK拒绝。登录结果中的refreshToken不自动adopt为已证双token流程。

```ts
const {client, auth, sessions} = createAuthenticatedClient({baseUrl}, {
  renew: async ({session, reason, signal}) => {
    // 仅接调用方已经另行验证的换新机制；这里没有默认URL。
    // 可对接你的宿主授权提供方；没有该能力时省略renew并重新登录。
    return yourVerifiedRenewalAdapter({session, reason, signal});
    // 返回{accessToken, expiresAt(毫秒), userId?}，不得切换账号。
  },
});
await sessions.renewNow(); // 未配置adapter则明确抛ReauthenticationRequiredError
```

manager把同一会话的并发续期合并为一个Promise，默认提前30秒检查；未配置adapter时仍允许未到期token，到期则要求重登，不回退发送过期raw token。401按当时的会话epoch和token revision处理，迟到旧401不会清掉新账号或同token换新期限。

默认只对manager管理的GET在401后续期并重试一次；第二次401结束。POST、SSE和写动作不自动重放。低层显式retryOnUnauthorized可用于调用方已确认可重试的读操作，高层确认投递始终禁用。旧账号的在途响应拒绝交给新账号；API准备headers之前就绑定epoch。账号改变会取消该client的旧SSE；`client.dispose()`清监听/取消流并禁止继续使用。

SDK默认只在内存保留token；`sessions.exportSession()`是显式的秘密数据导出，持久化由调用方安全存储实现。`snapshot()`/JSON序列化manager不带token。导入用`setSession()`，它是新的账号边界；logout即使服务端失败也清本地，但不会清掉已经替换的新账号。

登录凭据、资料和BOSS授权分层：LoginBootstrapError表示凭据已取得但profile失败；这时不要盲目重用短信码。跳过profile且登录不含userInfo时authorizationRequired为unknown；false也只表示未命中已见UI条件，不是服务端授权证明。冻结/验证码错误/邀请码等BusinessError.code可用LOGIN_ERROR_CODES识别。微信caller/wrapper参数不一致、guest/native一键登录及远程验证码挑战接口未恢复，不能宣称支持其完整流程。

## 任务结果与确认投递的ID

`ScopedId`同时有TypeScript类型和运行时namespace；HTTP/IM低级API仍开放原始字段。高层TaskDeliveryClient用于避免最常见的误接：

| ID | 进入哪里 |
|---|---|
| AiConversationId C | task/list query conversationId |
| AiTaskId T | result/list query taskId |
| AiTaskResultId R | result/read body id；不能直接代替待确认卡id |
| PendingResultId P | sendConfirmedResume body messageId |
| PendingJobId / PendingBossId | 确认body jobDetail.jobId/bossId |
| DeliveryZpJobId / RecordBossUid | 独立投递记录及初始聊天路由 |
| BossPeerUid | 岗位再查询后最终peer，可能覆盖初始路由UID |
| ZpUserId | IM token接口返回的自己UID，不是AppUserId |
| BossClientMessageId / BossServerMessageId | cmid与扩展ACK的mid；不能互换 |
| MQTT packetId | 连接级16bit传输标识，不是任何业务messageId |

`bindPendingDelivery`要求从独立pending查询中选P并提供运行时关联说明；不会转换R.id。`bindDeliveryRecord`同样要求确认→记录的外部关联。说明字段是SDK/harness元数据，不加到服务器body，也不证明后台存在对应join。

使用managed session时推荐`TaskDeliveryClient.bindPending(...)`，或给全局bindPendingDelivery传入原查询的`client.sessionOptions()`；selection固定该epoch，换账号后confirm拒绝。缓存行本身没有已证account字段，SDK不能自主证明行归属；读取、选择、提交必须保留同一次scope，完整示例已这样做。

确认只在raw.code严格等于0且raw.result.status为ADD_FRIEND或DELIVERED时算App接受；ADD_FRIEND不能证明简历附件发送完成。缺扩展ACK、网络错误或中途换账号时，不自动重发确认/聊天。读回执、实际附件和最终业务结果分别报告。

## BOSS HTTP 与 MQTT/protobuf

```ts
import { BossHttpClient, BossImClient, createBossNodeWebSocketFactory } from './dist/index.js';

const boss = new BossHttpClient(client);
const credentials = await boss.getCredentials({forceRefresh:false,sessionEpoch:sessions.epoch});
const peer = await boss.resolvePeer({jobId:deliveryJobId,friendId:initialPeer}, {sessionEpoch:sessions.epoch});
const im = new BossImClient({credentials,
  webSocketFactory:createBossNodeWebSocketFactory(YourNodeWebSocketConstructor)});
const unbind = sessions.onSessionChange(() => im.disconnect());
try {
  await im.connect(); // 等CONNACK；不把ready/init视为已认证
  const history = await boss.history({userId:credentials.zpUserId,friendId:peer.friendId});
  const sent = im.sendText({to:peer.friendId,text:'你的明确发送内容'});
  const ack = await sent.brokerAck; // packetId+cmid匹配且扩展server mid有效
  // sent.read另行表示已读；不保证发生，不要用本地cmid充当server mid。
} finally { unbind(); im.disconnect(); }
```

实时文本使用独立ZP token、webTicket2、productId以及MQTT4/proto2，不发送App Bearer到broker。getCredentials是独立取IM凭据，不是App token refresh；forceRefresh=true只表示这两个请求参数，不保证后端返回新凭据。断线/认证失败后须显式重新取凭据/新建连接，写不重发。

WebSocket factory必须支持实际upgrade headers与mqtt子协议。createBossNodeWebSocketFactory适配由调用方注入、支持headers的Node EventEmitter风格实现（例如平台已有的ws兼容构造器）；不增加运行依赖。标准浏览器/global WebSocket不能满足这些头，SDK不会静默丢弃或把额外凭据搬到URL。

普通2字节PUBACK只完成brokerReceived；18字节扩展且双键匹配才完成brokerAck；messageRead按确认后的serverMid和peer/source关联。原App只验证truthy ACK cmid，SDK双键检查属于增强设计。原型schema来自同包，实时服务器兼容性尚无抓包验证。超过Number安全范围的uint64使用string/BigInt；已变成不安全Number的输入会被拒绝。HTTP是否接受超范围string ID仍需运行时确认。

## 完整调用示例与离线运行

完整、可编译示例见 [full-workflow.ts](examples/full-workflow.ts)。它显式执行：登录→AI SSE→按C取任务→按T取结果/标已读→独立pending→运行时R→P关联→一次确认→独立状态/记录→运行时确认→记录关联→岗位再查peer→IM凭据→CONNACK→历史→文本→扩展ACK。任务/结果查询有有界只读轮询，默认最多10次/间隔1秒；没有重发写动作。

```sh
npm test
npm run example:mock
```

[mock-workflow.mjs](examples/mock-workflow.mjs)只用注入Fetch和模拟IM，不打开真实HTTP/WebSocket。fixture有20个互异逻辑ID，并故意让R.id与P.id、AppUser与ZpUser、岗位投递ID与记录ZP岗位ID、初始peer与最终peer不同，防止“所有ID恰好相等”掩盖误接。两个必需运行时关联是mock元数据，绝非真实服务端响应。

WorkflowStageError保留失败stage、确认是否尝试/接受、聊天是否queued/扩展ACK。没有证据时结果仍写unknown；确认已接受后历史/IM失败，不会倒退声称“确认未发生”，也不会自动补发。真实环境调用示例会产生明确的登录/投递/聊天请求；仅在调用方主动运行并提供实际会话、关联与adapter时执行。

## 验证与限制

测试只使用注入的 mock Fetch/WebSocket 和合成数据，覆盖接口目录派发、参数位置、鉴权隔离、业务错误、multipart/binary、SSE分块/终结/取消、标记消费和STOMP。没有调用业务服务，没有用真实账号、消息或任务作测试。未知的服务端 schema、模式政策、提交顺序和实际任务结果仍需运行时证据。

## 移动端集成扩展（0.2.1）

新增 `selectPendingRow(rows, pendingId, scope)`、`buildPendingRowConfirmation(selection)` 与 `TaskDeliveryClient.confirmPending(selection)`，支持用户从独立待确认列表选中一行后确认投递，无需编造 AI task/result → pending 的关联。原有 `confirm` / `bindPendingDelivery` 仍要求显式关联证据。`BossHttpClient.resolvePeer` 也会核对独立补查返回的岗位 ID，并拒绝采用无关行的招聘方 UID。完整接入、原生网络桥与运行时未知项见仓库根目录 `MOBILE.md`。
