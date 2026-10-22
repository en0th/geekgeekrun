# 上游 Issues 和 PR 对当前项目的改进审计

审计日期：2026年10月20日。审计基线：`en0th/geekgeekrun`，`master`，提交 `429102c`，UI `0.22.1`。

执行范围补充：按用户确认，后续修复面向当前单账号主线；多账号功能留在原分支。下文“账号隔离”是审计时对顺序更换登录身份后历史混用的描述，不代表主线新增多账号能力。实际交付与性能验证见[单账号主线交付记录](upstream-p1-implementation-2026-10-20.md)。

2026-10-20 续审进展：登录分类、硬条件、计薪单位、全国、组合预算及恢复已完成前两轮真实只收集验收；本轮补上字面岗位/JD 屏蔽词，修复浏览卡片句柄未释放和历史全表扫描，并以任务 #35–#37 验证预览与执行一致、0 发送、0 标记。详见[续修与性能验收](upstream-single-account-round2-2026-10-20.md)。下文首轮审计数据保留为当时基线。

同日后续：UI 两套全量类型检查已为 0 诊断；后台最小化运行及连续换岗已通过真实只收集任务 #40–#42，应用焦点验收为 0 次失焦。详见[后台运行验收](upstream-single-account-background-acceptance-2026-10-20.md)。

继续完成 macOS 退出、重复启动及同一任务重启恢复，以及薪资/经验/学历/行业/规模的选择、清空联合回读。真实只收集任务 #44 从累计 5 条恢复至 12 条，预算未重置；#49、#50 的控件和请求参数一致。详见[生命周期及筛选验收](upstream-single-account-lifecycle-filters-2026-10-20.md)。

2026-10-21 继续刷新上游打开列表及候选问题，本轮修复筛选后的列表同步缺口，并回收详情就绪及搜索输入句柄。实际选择、清空及推荐→两个不同关键词的轮换均已只收集验证，详见[列表一致性与资源回收验收](upstream-single-account-round3-2026-10-21.md)。这是对首轮全量存档的增量续审，不代表重新读取全部历史正文。

2026-10-22 补充渲染器与启动测量：首屏脚本 2.57MB→0.73MB，受控启动中位数 2.70s→0.71s，并修复 #65 相关的安装构建吞错及进程诊断缺口。真实只收集 #58、生产界面延迟加载及导入导出往返均通过，详见[渲染器与构建续审](upstream-single-account-renderer-performance-2026-10-22.md)。

**有值得修复和移植的内容。优先处理账号隔离、严格筛选、登录异常分类和实习薪资；性能方面优先限制组合数量、消除重复保存。** 上游 PR #117、#129、#110 可以提供实现参考，#118 和 #85 需要更多改造。

审计时项目所在外置盘已满，原报告保存在本机会话目录；本文件是该次审计存档。审计阶段未修改业务代码或执行真实 BOSS 发送。后续实现见[上游审计 P1 修复交付](upstream-p1-implementation-2026-10-20.md)。

## 审计范围和版本关系

- 全量清点 [上游 Issues](https://github.com/geekgeekrun/geekgeekrun/issues?q=is%3Aissue)：109 个，其中 52 个打开、57 个关闭；读取正文和当前可见评论，图片附件未作为复现依据。
- 全量检查 [上游 PR](https://github.com/geekgeekrun/geekgeekrun/pulls?q=is%3Apr)：16 个，其中 6 个打开、8 个关闭未合并、2 个显示已合并；同时检查补丁和当前源码。
- 实时列表包含 2026年10月19日新增的 #129；搜索缓存中的“5 个打开 PR”已经过时。
- 审计时上游 `master` 为 `c4ebdb0882d8dbecfd9864f980f6d13bd1eb4b2a`，是当前 HEAD 的祖先；当前分支在它之后有 42 个提交。新增价值主要来自未合入的 PR 和 Issue 暴露的缺口。
- 很多报告来自 `0.17.4` 或更早版本。下文区分源码可确认的缺口、已有对应实现和仍需现场复现的现象，不以 Issue 是否关闭代替代码判断。

## 优先修复的缺口

| 优先级 | 项目 | 上游依据 | 当前结论 |
| --- | --- | --- | --- |
| P1 | 切换账号后历史去重相互影响 | [#116](https://github.com/geekgeekrun/geekgeekrun/issues/116)、[#19](https://github.com/geekgeekrun/geekgeekrun/issues/19) | 历史标记和开聊记录查询没有按当前账号过滤，源码可确认 |
| P1 | 公司规模等条件缺少本地硬校验 | [#114](https://github.com/geekgeekrun/geekgeekrun/issues/114)、[#61](https://github.com/geekgeekrun/geekgeekrun/issues/61) | 页面召回条件与最终投递条件存在差别，规模没有进入最终检查 |
| P1 | 登录失败与访问受限混为一类 | [#126](https://github.com/geekgeekrun/geekgeekrun/issues/126)、[#125](https://github.com/geekgeekrun/geekgeekrun/issues/125)、[#75](https://github.com/geekgeekrun/geekgeekrun/issues/75) | 非零 JSON 返回容易归为登录无效，运行时另有清空 Cookie 后重登的路径 |
| P1 | 实习求职类型和日薪支持不完整 | [#112](https://github.com/geekgeekrun/geekgeekrun/issues/112)、[#97](https://github.com/geekgeekrun/geekgeekrun/issues/97)、[PR #117](https://github.com/geekgeekrun/geekgeekrun/pull/117) | 已有未知薪资跳过开关，但没有求职类型维度或完整日薪数据模型 |
| P2 | 全国和城市选择的执行语义 | [#120](https://github.com/geekgeekrun/geekgeekrun/issues/120)、[#115](https://github.com/geekgeekrun/geekgeekrun/issues/115)、[PR #111](https://github.com/geekgeekrun/geekgeekrun/pull/111) | 全国被旧选择器排除，新界面也没有显式选项；直接加入“全国”会造成误过滤 |

### 账号隔离应在拿到登录身份后恢复历史

`packages/sqlite-plugin/src/handlers.ts:335` 的 `getNotSuitMarkRecordsInLastSomeDays` 和 `:347` 的 `getChatStartupRecordsInLastSomeDays` 都只有日期条件。两种记录的实体已经有 `encryptCurrentUserId`，查询没有使用它。

`packages/sqlite-plugin/src/index.ts:166` 把查询结果恢复到本次任务的冷却集合，并根据近期开聊岗位恢复 BOSS 去重集合。因此账号 A 的记录会影响账号 B。无需删除整个职位库即可修复。

历史恢复目前挂在 `mainFlowWillLaunch`，发生在 `toRecommendPage` 获取用户信息之前，不能只在原位置补一个可能尚不存在的 user ID。应在成功验证当前用户后恢复其历史，缺失身份时停止发送，账号切换时重建集合。

验收：A、B 两个账号分别去重；A 的 7 天标记和 30 天开聊历史只对 A 生效；共享职位与公司基础资料仍可复用。

### 搜索条件应与必须满足的投递条件分开

`packages/geek-auto-start-chat-with-boss/index.mjs:556` 将城市、薪资、经验、学历、行业和规模交给页面筛选器。控件没找到时可以 `continue`，选择后也缺少逐项回读核验。

最终检查约在同文件 `1518` 至 `1565`，包含公司名称、活跃度、城市、经验、招聘者身份、岗位文本和薪资，没有规模、学历、行业等检查。**页面召回条件不自动成为本地投递硬条件。** “任意组合”还会遍历部分条件和空条件，不能描述为始终同时满足所有选项。

应新增明确的硬条件配置和统一的本地判断，只把用户设为必须满足的字段作为硬限制。必需字段缺失时跳过并说明原因；页面条件应用失败时明确报告。规模解析也应补 `20人以下`，现有 `parseCompanyScale` 对它返回 `[null, null]`。

验收：要求 100 人以上时不能发送给 0–20 人公司；组合换源、任务恢复、控件缺失和数据不足都不能放宽硬条件。

### 登录分类需要保留异常与受限状态

`packages/ui/src/common/boss-login.mjs:23` 的 `interpretUserInfoResponse` 对非零 JSON 响应，在非 5xx 情况下进入 `invalid`。离线输入 `{code:37,message:'环境存在异常'}`，结果也是 `invalid`。这验证了分类行为，不能据此认定所有登录 Issue 都有同一服务端原因。

运行时 `packages/ui/src/main/features/cookie-invalid-handle-plugin.ts:98` 则会在用户信息返回非零时清空 Cookie 并重新登录。当前 URL 安全验证暂停机制已经存在，但不能覆盖所有返回 JSON 的受限情况。

建议统一启动和运行时分类，分别表达未登录、访问受限、服务异常、超时、页面未就绪；只有明确认证失效才清理凭证。受限或验证码状态应暂停并保留现场，避免反复重启和重登。

### 日薪需要明确单位和求职类型

离线调用 `packages/sqlite-plugin/src/utils/parser.ts:40` 的实际解析器：

| 薪资文本 | 当前结果 |
| --- | --- |
| `15-20K·13薪` | 正确解析为 15、20、13 薪 |
| `150-250元/天` | 上下限均为 null |
| `300元/天` | 上下限均为 null |
| `5000-8000元/月` | 上下限均为 null |
| `1.5-2万元/月` | 上下限均为 null |

默认 `skipUnparseableSalaryJob=true`，这些岗位在核心 `index.mjs:1044` 的列表阶段被跳过。关闭开关只能允许部分未知薪资岗位继续检查；开启数值薪资限制时，未知薪资仍不能满足要求。

PR #117 提供全职、兼职、实习选择与日薪放行，**没有将日薪解析为可计算的数值**，其说明明确保留实习薪资为 NULL。仅移植该 PR 不能算完成实习薪资筛选。

建议保存原始文本、金额上下限、计薪单位、薪数及解析状态，分别处理日薪、月薪、年薪与面议，不默默把日薪折算为月薪。求职类型需贯通当前 `/ux` 界面、搜索配置、组合遍历、最终判断和任务快照。

### 全国应作为特殊语义而不是城市名称

`cityGroup.mjs` 已有全国代码 `100010000`，旧 `CityChooser.vue` 两处热门城市列表却明确排除了它，新 `Ux/index.js:612` 的候选城市也没有全国。

本地城市判断使用 `includes(actualCity)`。离线验证选中 `['全国']`、岗位城市为上海时，`listSkipReason` 返回“城市不符合”。仅增加选项会制造新错误。

应把全国规范化为不限制本地城市，同时在站点搜索层选择全国并回读实际值。清空期望城市只能证明取消本地限制，不能单凭这一点保证搜索源在全国召回。

PR #111 可借鉴选中后回读与 `CITY_FILTER_NOT_APPLIED` 错误。其函数只查找已渲染且可见的城市选项，仍要补非热门城市的切换与加载。

## 可以提升性能的具体位置

上游没有一个可直接套用、并已证明能提高当前版本吞吐的性能 PR。[#92](https://github.com/geekgeekrun/geekgeekrun/issues/92) 只有“约一分钟投一个”的现象描述。以下是当前代码能够确认的改进机会。

| 顺序 | 改进 | 代码依据 | 可验证收益 |
| --- | --- | --- | --- |
| 1 | 给任意组合设置预算，优先使用明确的固定组合 | `combineCalculator.mjs:61`、`:100` | 减少重复切换筛选器和大量低价值遍历 |
| 2 | 统一详情入库，按岗位和内容版本去重 | `sqlite-plugin/src/index.ts:114`、`:188`，核心 `index.mjs:1179` | 减少重复查询、保存和可能重复的变更日志 |
| 3 | 使用现有 Set 的 `has`，避免逐岗位复制排除集合后 `includes` | 核心 `index.mjs` 约 `1632` | 减少随历史规模增长的分配和线性查找 |
| 4 | 根据列表或响应变化判断加载完成，分别保留用户节奏 | 核心 `index.mjs:992`、`:1012`，`auto-chat-navigation.mjs:20` | 减少无效等待、跨进程轮询和错过响应引起的超时 |

实际调用组合计数函数，选择 3 个城市、3 档薪资、4 档经验、3 档学历、3 档规模、5 个行业，包含空条件时得到 **425,984 个组合**。生成器按需产出，主要问题是潜在遍历次数和站点交互成本，不等于启动就一次性分配这些对象。换源数量和连续不匹配阈值可提前退出，但不能代替预算，尤其阈值允许设为 0。

网络 `response` 监听会保存 `job/detail.json`，打开详情后的业务 hook 又保存详情及招聘状态。两条路径处理同次更新时存在重复工作和并发读旧值的窗口。应确定单一入口，或按岗位与内容版本合并，测量 SQL 次数后评估收益。

换源时存在先 `setToActiveSource()`、后注册 `waitForResponse` 的路径，可能错过快速响应。应先注册监听再触发动作，并将完成判定与用户要求的停顿分开。当前默认列表等待 5 秒、详情阅读 2 秒及周期休息已有配置，不建议把等待简单设为 0 来追求吞吐。

可参考 [#74](https://github.com/geekgeekrun/geekgeekrun/issues/74) 的单次 LLM 调用生成评分及草稿思路，以岗位内容、简历、模型和提示词版本作为缓存依据。这属于待实现的成本优化，缓存草稿不能代替对最新 HR 消息的判断。以上机会均未测量真实站点的端到端提速比例。

## 全部 PR 的采用结论

| PR | 审计时状态 | 当前项目采用方式 |
| --- | --- | --- |
| [#129](https://github.com/geekgeekrun/geekgeekrun/pull/129) 暗色模式 | 打开 | P2，借用主题 hook、跟随系统和跨窗口同步，适配新 Ux、语义色和原生材质 |
| [#118](https://github.com/geekgeekrun/geekgeekrun/pull/118) 多轮对话与工具调用 | 打开 | P2，拆分评估；可借用 JD 和会话上下文，TLS、密钥及发送状态需要改造 |
| [#117](https://github.com/geekgeekrun/geekgeekrun/pull/117) 求职类型和日薪 | 打开 | P1，优先移植类型筛选并补完整薪资单位模型，不能只放行日薪 |
| [#111](https://github.com/geekgeekrun/geekgeekrun/pull/111) 城市 DOM 修复 | 关闭未合并 | 只抽取城市回读与失败处理；补丁包含 110 个提交、240 个不同路径，混入后端拆分、MCP、CLI 和运行时 |
| [#110](https://github.com/geekgeekrun/geekgeekrun/pull/110) 简历图片 | 打开 | P2，可移植；保留默认关闭、成功开聊后发送及局部失败处理，适配快照、目录和新界面 |
| [#93](https://github.com/geekgeekrun/geekgeekrun/pull/93) 招聘端配置导入导出 | 关闭未合并 | 不直接引入招聘端页面；借鉴多文件导入预览和失败回滚 |
| [#91](https://github.com/geekgeekrun/geekgeekrun/pull/91) 招聘端界面重组 | 关闭未合并 | 当前求职端已重做导航，本轮不采用 |
| [#90](https://github.com/geekgeekrun/geekgeekrun/pull/90) 招聘端评分阈值 | 关闭未合并 | 针对当前不存在的招聘端评分模块，本轮不采用 |
| [#87](https://github.com/geekgeekrun/geekgeekrun/pull/87) 招聘者身份过滤 | 打开 | 已合入：`2eacc389` 是 HEAD 祖先，另有配置修复 `2327c6c`；无需重复合并 |
| [#85](https://github.com/geekgeekrun/geekgeekrun/pull/85) 搜索评价和运行保护 | 打开 | P2，仅借鉴缺失数据、一致性和关键词退化诊断；当前已有多项等价保护，不整包覆盖 |
| [#84](https://github.com/geekgeekrun/geekgeekrun/pull/84) 自动化运行技能 | 关闭未合并 | #85 前身，脚本和机器路径需跨平台改造 |
| [#83](https://github.com/geekgeekrun/geekgeekrun/pull/83) 招聘端自动化修复 | 关闭未合并 | 与 #82 相同 head `23c820d4`，避免重复计算收益；主要是招聘端 |
| [#82](https://github.com/geekgeekrun/geekgeekrun/pull/82) 招聘端自动化修复 | 关闭未合并 | 同 #83，本轮不采用 |
| [#79](https://github.com/geekgeekrun/geekgeekrun/pull/79) 招聘端功能 | 显示已合并 | 当前源码没有该招聘端包，引入属于新增产品范围，并非求职端小修复或性能补丁 |
| [#78](https://github.com/geekgeekrun/geekgeekrun/pull/78) 全面 TypeScript 改造 | 关闭未合并 | 跨包重写，缺少当前版本性能收益依据，本轮不采用 |
| [#2](https://github.com/geekgeekrun/geekgeekrun/pull/2) 自动复聊 | 显示已合并 | `8347fb0f` 已是当前 HEAD 祖先，基础功能已有 |

### 三个功能 PR 的适配重点

**PR #129**：当前 `packages/ui/src/main/flow/OPEN_SETTING_WINDOW/index.ts:29` 将 `nativeTheme.themeSource` 固定为 `light`，`app-theme.css` 也是亮色语义色。只增加 `html.dark` 和旧页面样式，会遗漏默认使用的 `/ux` 界面和原生材质。应沿用当前语义色系统，将外观接入现有设置页。

**PR #110**：`sendResumeImageAfterGreeting`、`resumeImagePath` 不在当前 `task-config-snapshot.mjs` 根级白名单中。worker 优先读快照，直接拼接 PR 后将读不到这些新配置。导入器还固定使用 home 下的 `.geekgeekrun/resume-images`，需与当前数据目录机制协调。首版可先支持图片，PDF/Word 转换单独评估依赖与打包成本；发送继续校验会话对象和结果。

**PR #118**：`gpt-request.mjs` 新增 `https.Agent({ rejectUnauthorized: false })`，关闭 TLS 证书校验，不能带入当前项目。它基于旧参数接口，而当前已有 timeout、maxRetries、thinking 的供应商适配及兼容重试。应在当前接口上增加工具参数与结构化结果，适配密钥脱敏。JD 与消息作为数据使用；文本、简历、邮件各自具备开关、去重和状态确认。

### PR #85 的依赖和行为缺口

`runtime-protection.mjs` 导入 `ReliabilityRejectReason`，当前 `sqlite-plugin/src/enums.ts` 没有此导出，PR 补丁也没有相应枚举修改。当前已有 `missingJobFields`、`openJobCardForReview`、`assertCanGreet`、停滞保护和换源阈值，应对照后抽取缺少部分。

评分和关键词退化可用于诊断，不能越过账号、硬条件和同岗位发送检查。脚本含特定 Windows 目录，需改为当前运行目录机制。

对 #117、#129、#110、#118、#85 的只读 `git apply --check` 均发现上下文冲突，补丁不能直接套入当前工作树；这不等于功能无法实现。

## 已覆盖与仍可补全的需求

| 上游需求 | 当前状态 | 后续价值 |
| --- | --- | --- |
| [#66](https://github.com/geekgeekrun/geekgeekrun/issues/66)、[#69](https://github.com/geekgeekrun/geekgeekrun/issues/69) 只收集和导出 | 已有收集模式和 xlsx、CSV、JSON 导出 | 保留收集模式不发送、不标记的回归 |
| [#113](https://github.com/geekgeekrun/geekgeekrun/issues/113) 知识库和查询 | 数据表检索、统计、导出已有 | Markdown/Obsidian、查询接口、按会话增量同步仍未完成 |
| [#27](https://github.com/geekgeekrun/geekgeekrun/issues/27) 公司黑名单 | 已有排除关键词、正则和策略 | 不必重复造功能 |
| [#25](https://github.com/geekgeekrun/geekgeekrun/issues/25) 慢模型超时 | 已有可配置超时、重试与 thinking | 保留当前契约，避免被旧 PR 覆盖 |
| [#29](https://github.com/geekgeekrun/geekgeekrun/issues/29) 周期休息 | 已有全局节奏和休息 | [#30](https://github.com/geekgeekrun/geekgeekrun/issues/30) 钟点免打扰仍可增加，两者不同 |
| [#26](https://github.com/geekgeekrun/geekgeekrun/issues/26)、[#49](https://github.com/geekgeekrun/geekgeekrun/issues/49)、[#50](https://github.com/geekgeekrun/geekgeekrun/issues/50)、[#98](https://github.com/geekgeekrun/geekgeekrun/issues/98) 匹配和误投 | 已有 ALL/ANY、冻结配置、详情岗位 ID 校验及发送闸门 | 旧典型漏洞已有防护，规模等硬条件仍需补齐 |
| [#38](https://github.com/geekgeekrun/geekgeekrun/issues/38) 招聘者身份 | #87 已合入并修复默认配置 | 头衔匹配不能保证识别所有猎头 |
| [#80](https://github.com/geekgeekrun/geekgeekrun/issues/80)、[#31](https://github.com/geekgeekrun/geekgeekrun/issues/31)、[#44](https://github.com/geekgeekrun/geekgeekrun/issues/44) 岗位排除词 | 已补直接填写的岗位/JD 字面屏蔽词，保留高级正则 | 名称与 JD 分别命中、未命中三组真实只收集验收通过 |
| [#128](https://github.com/geekgeekrun/geekgeekrun/issues/128)、[#62](https://github.com/geekgeekrun/geekgeekrun/issues/62) 后台运行 | 已提供默认后台最小化、同页存储恢复和安全验证时显示 | macOS 三组真实验收通过，连续收集时无失焦；Windows 待验收 |
| [#81](https://github.com/geekgeekrun/geekgeekrun/issues/81) 地铁/区域、[#70](https://github.com/geekgeekrun/geekgeekrun/issues/70) 排序 | 数据表排序已有；站点区域与搜索排序不完整 | P3，明确排序所在层；地址包含判断不等于地铁筛选 |
| [#65](https://github.com/geekgeekrun/geekgeekrun/issues/65) SQLite 构建 | 已有 skipLibCheck、非零退出检查，本次无输出类型检查通过 | 原主要问题已覆盖；仍可用 spawnSync.cwd 并明确报告 signal |

[#101](https://github.com/geekgeekrun/geekgeekrun/issues/101) 的 macOS 退出残留及若干图片型闪退、空白页报告，需要在对应系统和当前发行包复现。当前已有关闭 daemon 客户端、退出分类和停止重启机制，既不能据旧标题认定仍有同一缺陷，也不能据此宣布已修复。验收应检查进程收敛和重启后的单实例锁。

[#102](https://github.com/geekgeekrun/geekgeekrun/issues/102) 至 [#109](https://github.com/geekgeekrun/geekgeekrun/issues/109) 的关闭评论明确说明按请求撤回拆分任务。可参考其只读采集、阶段保存、去重证据及确定性分析验收思路，**不能视为已完成、可直接移植的实现**。

## 建议实施顺序

1. 登录身份变化后的历史隔离、硬条件校验、登录异常分类，覆盖顺序更换登录、控件失效、未知字段、受限和恢复任务。
2. 求职类型与计薪单位、全国语义与城市回读，覆盖日薪/月薪并存、旧配置及非热门城市。
3. 组合预算、写库去重、集合查询和响应监听，比较相同输入下的组合数、SQL 数、CPU 时间与超时，保留运行节奏。
4. 简历图片、暗色模式、后台选项及免打扰，以当前 Ux、队列和数据目录为基础。
5. JD 评分与草稿缓存、多轮对话，先保证可检查结果和受控发送状态，再扩展工具调用。

## 本次验证

- 现有 141 个不同测试全部通过：普通 Node 测试 138 通过、3 个原生数据库测试因 ABI 跳过；随后以项目 Electron 运行时补测这 3 项，全部通过。
- `node ./node_modules/typescript/bin/tsc --noEmit -p packages/sqlite-plugin/tsconfig.json` 通过。
- 离线调用真实函数验证薪资、规模、非零登录响应、全国字面量误过滤和组合计数。
- 五个候选补丁只做应用检查，未写入工作树。
- 使用本机 Node `26.11.1` 和项目 Electron；未重建完整发行包，未登录真实 BOSS 验证动态 DOM、验证码、后台加载或消息发送。动态页面及系统生命周期问题仍需实机验收。

## 全量 Issue 处置索引

以下判断用于确定后续工作，不表示本次已经重现或修复全部旧报告。

| Issue | 上游状态 | 标题 | 当前判断 |
| --- | --- | --- | --- |
| [#128](https://github.com/geekgeekrun/geekgeekrun/issues/128) | 打开 | 开了chrome窗口太强势了，总是开了一个新的页面之后就弹出来，能不能放在后台不跳出 | 已实现后台最小化；macOS 真实只收集、连续换岗及焦点验收通过，Windows 待验收 |
| [#127](https://github.com/geekgeekrun/geekgeekrun/issues/127) | 打开 | 程序不开聊，把推荐公司都标记为不合适 | 已有跳过原因和停滞止损；旧现象不足以确定当前根因 |
| [#126](https://github.com/geekgeekrun/geekgeekrun/issues/126) | 打开 | 登录检查一直不成功 | P1：统一登录与受限分类；个案根因仍需现场日志 |
| [#125](https://github.com/geekgeekrun/geekgeekrun/issues/125) | 打开 | 自动开聊卡在cookie检查了 | P1：统一登录与受限分类；个案根因仍需现场日志 |
| [#124](https://github.com/geekgeekrun/geekgeekrun/issues/124) | 打开 | 我的自动投递没有开聊记录 | 已有跳过原因和停滞止损；旧现象不足以确定当前根因 |
| [#123](https://github.com/geekgeekrun/geekgeekrun/issues/123) | 打开 | 添加了cookie也不能运行 | P1：统一登录与受限分类；个案根因仍需现场日志 |
| [#122](https://github.com/geekgeekrun/geekgeekrun/issues/122) | 打开 | 设置好了一直不投简历 | 已有跳过原因和停滞止损；旧现象不足以确定当前根因 |
| [#121](https://github.com/geekgeekrun/geekgeekrun/issues/121) | 打开 | 会投递到其他岗位 | 同岗位 ID 校验和发送闸门已有；补缺失硬条件并保留回归 |
| [#120](https://github.com/geekgeekrun/geekgeekrun/issues/120) | 打开 | 希望在筛选城市这里增加全国的选项，目前boss上可以直接选全国然后海投 | P2：补全国特殊语义，不能仅添加城市字面量 |
| [#119](https://github.com/geekgeekrun/geekgeekrun/issues/119) | 打开 | 登录cookie一直失败 卡在了同一个界面很久 是什么问题呢？ | P1：统一登录与受限分类；个案根因仍需现场日志 |
| [#116](https://github.com/geekgeekrun/geekgeekrun/issues/116) | 打开 | 切换账号后旧职位库和公司会略过 | P1：按账号过滤历史并延后至身份验证成功后恢复 |
| [#115](https://github.com/geekgeekrun/geekgeekrun/issues/115) | 打开 | 筛选条件里面，没有全国 | P2：补全国特殊语义，不能仅添加城市字面量 |
| [#114](https://github.com/geekgeekrun/geekgeekrun/issues/114) | 打开 | 公司规模限制无效 | P1：公司规模缺少最终硬校验 |
| [#113](https://github.com/geekgeekrun/geekgeekrun/issues/113) | 打开 | 特性请求：支持投递职位、职位库、boss库、公司库数据导出或查询 | 部分覆盖：检索、xlsx/CSV/JSON 已有；知识库、API、增量同步待补 |
| [#112](https://github.com/geekgeekrun/geekgeekrun/issues/112) | 打开 | 薪资过滤 | P1：补求职类型和日薪单位模型；参考 PR #117 |
| [#109](https://github.com/geekgeekrun/geekgeekrun/issues/109) | 关闭 | Harden market-jobs privacy, stdout, and no-action guarantees | 按请求关闭的需求拆分；无已完成实现可直接移植 |
| [#108](https://github.com/geekgeekrun/geekgeekrun/issues/108) | 关闭 | Generate deterministic market-jobs-analysis.v1 artifact | 按请求关闭的需求拆分；无已完成实现可直接移植 |
| [#107](https://github.com/geekgeekrun/geekgeekrun/issues/107) | 关闭 | Add optional sequential JD enrichment from detail DOM | 按请求关闭的需求拆分；无已完成实现可直接移植 |
| [#106](https://github.com/geekgeekrun/geekgeekrun/issues/106) | 关闭 | Stop safely and write partial artifacts on platform risk | 按请求关闭的需求拆分；无已完成实现可直接移植 |
| [#105](https://github.com/geekgeekrun/geekgeekrun/issues/105) | 关闭 | Classify market job contact state from visible page evidence | 按请求关闭的需求拆分；无已完成实现可直接移植 |
| [#104](https://github.com/geekgeekrun/geekgeekrun/issues/104) | 关闭 | Preserve multi-sample observations with dedupe and identity confidence | 按请求关闭的需求拆分；无已完成实现可直接移植 |
| [#103](https://github.com/geekgeekrun/geekgeekrun/issues/103) | 关闭 | Crawl one search sample into market-jobs.v1 raw artifact | 按请求关闭的需求拆分；无已完成实现可直接移植 |
| [#102](https://github.com/geekgeekrun/geekgeekrun/issues/102) | 关闭 | Add market-jobs --plan-only CLI contract | 按请求关闭的需求拆分；无已完成实现可直接移植 |
| [#101](https://github.com/geekgeekrun/geekgeekrun/issues/101) | 打开 | 退出异常 | 待 macOS 实机复现：退出后的进程收敛与再次启动 |
| [#100](https://github.com/geekgeekrun/geekgeekrun/issues/100) | 打开 | 程序异常退出 | 启动/浏览器旧报告；当前需依据日志和对应系统实机复现 |
| [#99](https://github.com/geekgeekrun/geekgeekrun/issues/99) | 打开 | 自动开聊没有发出消息 | 待验证：开聊成功与招呼文本送达分开确认，当前根因未确认 |
| [#98](https://github.com/geekgeekrun/geekgeekrun/issues/98) | 打开 | 公共岗位筛选条件限制不严 | 同岗位 ID 校验和发送闸门已有；补缺失硬条件并保留回归 |
| [#97](https://github.com/geekgeekrun/geekgeekrun/issues/97) | 打开 | 希望添加筛选条件实习岗位 | P1：补求职类型和日薪单位模型；参考 PR #117 |
| [#96](https://github.com/geekgeekrun/geekgeekrun/issues/96) | 打开 | 没有投递成功 | 启动/浏览器旧报告；当前需依据日志和对应系统实机复现 |
| [#95](https://github.com/geekgeekrun/geekgeekrun/issues/95) | 打开 | 岗位提示词屏蔽及聊天功能 | 部分覆盖：反向正则已有；多轮对话及简历附件待补 |
| [#94](https://github.com/geekgeekrun/geekgeekrun/issues/94) | 打开 | 闪退问题 | 启动/浏览器旧报告；当前需依据日志和对应系统实机复现 |
| [#92](https://github.com/geekgeekrun/geekgeekrun/issues/92) | 打开 | 投递比较慢 | 性能改进：组合预算、详情去重保存、Set 查询和等待时机 |
| [#89](https://github.com/geekgeekrun/geekgeekrun/issues/89) | 打开 | 可以加一个发送图片的功能吗 | P2：参考 PR #110，适配快照、目录与发送确认 |
| [#88](https://github.com/geekgeekrun/geekgeekrun/issues/88) | 打开 | 希望自动开聊的时候，顺便回复一句开场白，或者可以双开也行，一个挂机自动开聊一个自动回复，嘿嘿 | P2：首次自定义话术、开聊后的消息流程需单独设计 |
| [#86](https://github.com/geekgeekrun/geekgeekrun/issues/86) | 打开 | 希望可以将送达状态的也能够添加复聊功能 | P2：未读/送达跟进策略待补，不能等同已读不回 |
| [#81](https://github.com/geekgeekrun/geekgeekrun/issues/81) | 打开 | 希望在搜索岗位的时候可以按照地铁区域筛选 | P3：区域与地铁筛选待补；地址包含匹配不能等同地铁距离 |
| [#80](https://github.com/geekgeekrun/geekgeekrun/issues/80) | 打开 | 是否可增加岗位详情中根据屏蔽词过滤了 | 高级反向正则已有；P2 可补直接填写的岗位/JD 排除词 |
| [#77](https://github.com/geekgeekrun/geekgeekrun/issues/77) | 打开 | 大佬,最近运行发现，boss左边的信息列在不停往下拉，但是没有数据爬取下来，这些数据都没有在数据库里边，爬取率非常低1%左右 | 已有跳过原因和停滞止损；旧现象不足以确定当前根因 |
| [#76](https://github.com/geekgeekrun/geekgeekrun/issues/76) | 关闭 | 【自动开聊功能】正常登录筛选到正确岗位后，程序点击立即沟通后（能看见UI变化确实点击了按钮），chrome会立马关闭 | 启动/浏览器旧报告；当前需依据日志和对应系统实机复现 |
| [#75](https://github.com/geekgeekrun/geekgeekrun/issues/75) | 打开 | 登录获取Cookie后一直重复需要登录 | P1：统一登录与受限分类；个案根因仍需现场日志 |
| [#74](https://github.com/geekgeekrun/geekgeekrun/issues/74) | 打开 | ai筛工作的建议和实现参考 | P2：评分与草稿合并调用、缓存及版本失效策略 |
| [#73](https://github.com/geekgeekrun/geekgeekrun/issues/73) | 打开 | 【问题反馈】城市选择问题 | 城市筛选/轮换已有；补回读及异常处理，参考 PR #111 的局部逻辑 |
| [#72](https://github.com/geekgeekrun/geekgeekrun/issues/72) | 打开 | 希望增加投递实习选项 | P1：补求职类型和日薪单位模型；参考 PR #117 |
| [#71](https://github.com/geekgeekrun/geekgeekrun/issues/71) | 关闭 | 在”登录状态检查“过程中，陷入无限登录循环 | P1：统一登录与受限分类；个案根因仍需现场日志 |
| [#70](https://github.com/geekgeekrun/geekgeekrun/issues/70) | 打开 | 希望添加职位,默认排序类型的配置开放,可按时间排序来刷选职位 | 部分覆盖：数据表排序已有；网站召回排序需求需进一步明确 |
| [#69](https://github.com/geekgeekrun/geekgeekrun/issues/69) | 打开 | 大佬，用了你的牛人快跑，发现效果很不错，有一点想法，看是否好实现？ | 已覆盖：收集模式及表格导出，保留不发送回归 |
| [#67](https://github.com/geekgeekrun/geekgeekrun/issues/67) | 关闭 | 开启BOSS炸弹后，浏览器会闪退，然后再打开。重复这个过程 | 启动/浏览器旧报告；当前需依据日志和对应系统实机复现 |
| [#66](https://github.com/geekgeekrun/geekgeekrun/issues/66) | 关闭 | 您好，能增加一个根据条件搜索公司岗位，但不投递的选项吗？ | 已覆盖：收集模式及表格导出，保留不发送回归 |
| [#65](https://github.com/geekgeekrun/geekgeekrun/issues/65) | 打开 | 🐞 sqlite-plugin 在 postinstall 阶段存在 TypeScript 类型报错（@types/web-bluetooth） | 主要构建问题已覆盖；类型检查通过，cwd/signal 处理可完善 |
| [#64](https://github.com/geekgeekrun/geekgeekrun/issues/64) | 关闭 | 启动浏览器后经过几秒后浏览器黑屏:about:blank | 启动/浏览器旧报告；当前需依据日志和对应系统实机复现 |
| [#63](https://github.com/geekgeekrun/geekgeekrun/issues/63) | 关闭 | 您好 之前一直好用 从1月8号开始 每次运行浏览器都会从boss跳到about:blank 试过重新做系统 关闭浏览器保护 关闭一切保护 更新调整浏览器设置还是无法解决 | 启动/浏览器旧报告；当前需依据日志和对应系统实机复现 |
| [#62](https://github.com/geekgeekrun/geekgeekrun/issues/62) | 打开 | 我觉得可以增加一个可以隐藏功能 | 已实现默认后台最小化及普通窗口选项；macOS 真实只收集验收通过 |
| [#61](https://github.com/geekgeekrun/geekgeekrun/issues/61) | 关闭 | 使用固定组合条件遍历，并没命中单条的全部规则 | 召回组合与投递硬条件需区分；补条件回读，旧表现仍需复现 |
| [#60](https://github.com/geekgeekrun/geekgeekrun/issues/60) | 关闭 | 大量闪退重启 | 启动/浏览器旧报告；当前需依据日志和对应系统实机复现 |
| [#59](https://github.com/geekgeekrun/geekgeekrun/issues/59) | 打开 | 通过搜索找到的职位bug | 城市筛选/轮换已有；补回读及异常处理，参考 PR #111 的局部逻辑 |
| [#58](https://github.com/geekgeekrun/geekgeekrun/issues/58) | 打开 | 提供公司的详细情况 | 公司基础资料已有；工商/风险查询需另接数据源 |
| [#57](https://github.com/geekgeekrun/geekgeekrun/issues/57) | 关闭 | MAC 打开不了 | 安装/系统签名类旧报告；未对对应发行包实测 |
| [#56](https://github.com/geekgeekrun/geekgeekrun/issues/56) | 关闭 | 使用过程当中只会拉黑公司,不会打招呼 | 已有跳过原因和停滞止损；旧现象不足以确定当前根因 |
| [#55](https://github.com/geekgeekrun/geekgeekrun/issues/55) | 打开 | 浏览器闪退，且标签页为about:blank | 启动/浏览器旧报告；当前需依据日志和对应系统实机复现 |
| [#54](https://github.com/geekgeekrun/geekgeekrun/issues/54) | 打开 | 希望可以定制化第一句招呼语句 | P2：首次自定义话术、开聊后的消息流程需单独设计 |
| [#53](https://github.com/geekgeekrun/geekgeekrun/issues/53) | 关闭 | 无法清空对应的投递记录 | 已覆盖：数据表删除、检索与管理；不需靠卸载清库 |
| [#52](https://github.com/geekgeekrun/geekgeekrun/issues/52) | 关闭 | 筛选器只能有一个条件 | 召回组合与投递硬条件需区分；补条件回读，旧表现仍需复现 |
| [#51](https://github.com/geekgeekrun/geekgeekrun/issues/51) | 关闭 | 职位筛选条件未被使用 | 召回组合与投递硬条件需区分；补条件回读，旧表现仍需复现 |
| [#50](https://github.com/geekgeekrun/geekgeekrun/issues/50) | 关闭 | 关于误投问题 | 同岗位 ID 校验和发送闸门已有；补缺失硬条件并保留回归 |
| [#49](https://github.com/geekgeekrun/geekgeekrun/issues/49) | 关闭 | 简历误投的问题 | 同岗位 ID 校验和发送闸门已有；补缺失硬条件并保留回归 |
| [#48](https://github.com/geekgeekrun/geekgeekrun/issues/48) | 关闭 | 一直滑动没有打招呼 | 已有跳过原因和停滞止损；旧现象不足以确定当前根因 |
| [#47](https://github.com/geekgeekrun/geekgeekrun/issues/47) | 关闭 | 为什么一直在滑动职位，没有聊天 | 已有跳过原因和停滞止损；旧现象不足以确定当前根因 |
| [#46](https://github.com/geekgeekrun/geekgeekrun/issues/46) | 关闭 | 关于检索岗位的问题 | 召回组合与投递硬条件需区分；补条件回读，旧表现仍需复现 |
| [#45](https://github.com/geekgeekrun/geekgeekrun/issues/45) | 关闭 | 出现反差了 | 已有跳过原因和停滞止损；旧现象不足以确定当前根因 |
| [#44](https://github.com/geekgeekrun/geekgeekrun/issues/44) | 关闭 | 可以使用反向正则筛选岗位关键词吗？目前使用反向正则进行筛选好像存在问题 | 高级反向正则已有；P2 可补直接填写的岗位/JD 排除词 |
| [#43](https://github.com/geekgeekrun/geekgeekrun/issues/43) | 关闭 | 安装报错 | 启动/浏览器旧报告；当前需依据日志和对应系统实机复现 |
| [#42](https://github.com/geekgeekrun/geekgeekrun/issues/42) | 关闭 | Boss炸弹 报错导致程序报错后重启，错误信息：`TypeError: notSuitConditionHandleMap[markOnBossCondition] is not a function` | 旧版处理器异常；当前同类路径仍应保留回归，不据标题判定复现 |
| [#41](https://github.com/geekgeekrun/geekgeekrun/issues/41) | 关闭 | 不能自动选择城市 | 城市筛选/轮换已有；补回读及异常处理，参考 PR #111 的局部逻辑 |
| [#39](https://github.com/geekgeekrun/geekgeekrun/issues/39) | 关闭 | 增加职位来源 | 已覆盖：多来源、关键词搜索、排序及启停、轮换 |
| [#38](https://github.com/geekgeekrun/geekgeekrun/issues/38) | 关闭 | 期望增加 “猎头职位”或“HR职位”筛选，可以屏蔽掉“猎头职位” | 已覆盖：HR 头衔过滤；不保证识别所有猎头 |
| [#37](https://github.com/geekgeekrun/geekgeekrun/issues/37) | 关闭 | 可以支持企业端自动筛选简历吗？联系一下 | 招聘端需求；当前求职端范围内不直接引入 PR #79 |
| [#36](https://github.com/geekgeekrun/geekgeekrun/issues/36) | 关闭 | 如何清空缓存（例如历史的开聊记录、职位库等等） | 已覆盖：数据表删除、检索与管理；不需靠卸载清库 |
| [#35](https://github.com/geekgeekrun/geekgeekrun/issues/35) | 关闭 | 筛选城市失败 | 城市筛选/轮换已有；补回读及异常处理，参考 PR #111 的局部逻辑 |
| [#34](https://github.com/geekgeekrun/geekgeekrun/issues/34) | 打开 | 希望增加实习岗位投递 | P1：补求职类型和日薪单位模型；参考 PR #117 |
| [#33](https://github.com/geekgeekrun/geekgeekrun/issues/33) | 打开 | 浏览器会经常闪退、自动重启 | 启动/浏览器旧报告；当前需依据日志和对应系统实机复现 |
| [#32](https://github.com/geekgeekrun/geekgeekrun/issues/32) | 关闭 | 请求增加多个正则独立匹配和城市码的功能 | 多字段匹配已有；城市召回与全国语义仍需完善 |
| [#31](https://github.com/geekgeekrun/geekgeekrun/issues/31) | 关闭 | 期望“职位详情筛选条件”中增加“排除”关键字选项 | 高级反向正则已有；P2 可补直接填写的岗位/JD 排除词 |
| [#30](https://github.com/geekgeekrun/geekgeekrun/issues/30) | 打开 | 添加免打扰时段，避免程序在不合理的时间（例如凌晨）依然在操作 | P2：钟点免打扰未完成；与周期休息不同 |
| [#29](https://github.com/geekgeekrun/geekgeekrun/issues/29) | 关闭 | 添加摸鱼模式，尝试降低被风控的概率 | 已覆盖：全局运行节奏和周期休息 |
| [#27](https://github.com/geekgeekrun/geekgeekrun/issues/27) | 打开 | 添加期望公司黑名单 | 已覆盖：公司排除关键词和正则 |
| [#26](https://github.com/geekgeekrun/geekgeekrun/issues/26) | 关闭 | 请求增加配置，以设置“职位名称正则”、“职位类型正则”、“职位描述正则”的或关系匹配 | 已覆盖：名称/分类/描述的 ALL 与 ANY 逻辑 |
| [#25](https://github.com/geekgeekrun/geekgeekrun/issues/25) | 打开 | 本地ollama模型因为回答慢导致触发表情回复 | 已覆盖：模型超时、重试和 thinking 设置 |
| [#24](https://github.com/geekgeekrun/geekgeekrun/issues/24) | 打开 | 请求增加暗色模式 | P2：采用 PR #129 思路，适配当前默认 Ux 和原生主题 |
| [#23](https://github.com/geekgeekrun/geekgeekrun/issues/23) | 关闭 | 你好，我的安装后为什么打不开啊 | 安装/系统签名类旧报告；未对对应发行包实测 |
| [#22](https://github.com/geekgeekrun/geekgeekrun/issues/22) | 打开 | 建议增加ai根据职位描述、职责、要求自动生成对应的打招呼语并自动发送 | P2：JD 上下文生成打招呼草稿，参考 #74 和 PR #118 的部分能力 |
| [#21](https://github.com/geekgeekrun/geekgeekrun/issues/21) | 关闭 | 完成全部设置，点击开始求职后，浏览器窗口一闪就消失，手机端也没看打招呼的消息 | 启动/浏览器旧报告；当前需依据日志和对应系统实机复现 |
| [#20](https://github.com/geekgeekrun/geekgeekrun/issues/20) | 关闭 | 建议添加位置筛选 | 已覆盖：本地城市检查；全国及页面回读另见本报告 |
| [#19](https://github.com/geekgeekrun/geekgeekrun/issues/19) | 打开 | 添加多账号多配置 | 部分覆盖：配置模板、数据检索已有；多账号会话与历史隔离待补 |
| [#18](https://github.com/geekgeekrun/geekgeekrun/issues/18) | 关闭 | 薪资条件和年限条件设置失效 | 月薪和经验检查已有；实习日薪仍见薪资缺口 |
| [#17](https://github.com/geekgeekrun/geekgeekrun/issues/17) | 打开 | 期望增加“程序主动打招呼以后，可以在打招呼后自动发送一个图片（例如发送简历截图）”的功能 | P2：参考 PR #110，适配快照、目录与发送确认 |
| [#16](https://github.com/geekgeekrun/geekgeekrun/issues/16) | 关闭 | boss炸弹和已读不回提醒器是否可以同时运行 | 两种任务已有；当前队列串行，并非同时并发执行 |
| [#15](https://github.com/geekgeekrun/geekgeekrun/issues/15) | 关闭 | 运行boss炸弹后，弹出均为空白页面 | 启动/浏览器旧报告；当前需依据日志和对应系统实机复现 |
| [#14](https://github.com/geekgeekrun/geekgeekrun/issues/14) | 关闭 | 为什么运行后一直在网页中点不感兴趣 | 已有跳过原因和停滞止损；旧现象不足以确定当前根因 |
| [#13](https://github.com/geekgeekrun/geekgeekrun/issues/13) | 关闭 | 复制cookie或者点击启动登录那里登录最后都是空白网页v0.7.0 | 启动/浏览器旧报告；当前需依据日志和对应系统实机复现 |
| [#12](https://github.com/geekgeekrun/geekgeekrun/issues/12) | 关闭 | 运行后都是打开的空白网页 | 启动/浏览器旧报告；当前需依据日志和对应系统实机复现 |
| [#11](https://github.com/geekgeekrun/geekgeekrun/issues/11) | 打开 | 使用过程中如有遇到问题或有任何想法，欢迎提Issue，每条我都会做出响应的 | 通用反馈入口，无独立可移植修复 |
| [#10](https://github.com/geekgeekrun/geekgeekrun/issues/10) | 关闭 | 第一次运行卡在“正在下载核心组件。正在下载兼容的浏览器” | 启动/浏览器旧报告；当前需依据日志和对应系统实机复现 |
| [#9](https://github.com/geekgeekrun/geekgeekrun/issues/9) | 关闭 | macOS系统，打不开本程序；报错提示：“GeekGeekRun”已损坏，无法打开。 你应该将它移到废纸篓。 | 安装/系统签名类旧报告；未对对应发行包实测 |
| [#8](https://github.com/geekgeekrun/geekgeekrun/issues/8) | 关闭 | 只会一直打开空的浏览器新窗口，没有正常开始执行投递 | 启动/浏览器旧报告；当前需依据日志和对应系统实机复现 |
| [#7](https://github.com/geekgeekrun/geekgeekrun/issues/7) | 关闭 | 大佬，可以添加地区限制嘛？有时候老投外地 | 已覆盖：本地城市检查；全国及页面回读另见本报告 |
| [#6](https://github.com/geekgeekrun/geekgeekrun/issues/6) | 关闭 | 测试了下薪资待遇好像有问题，设置后并不生效 | 月薪和经验检查已有；实习日薪仍见薪资缺口 |
| [#5](https://github.com/geekgeekrun/geekgeekrun/issues/5) | 关闭 | Windows11下，运行后不断打开Edge浏览器，但是无法进入Boss直聘页面 | 启动/浏览器旧报告；当前需依据日志和对应系统实机复现 |
| [#4](https://github.com/geekgeekrun/geekgeekrun/issues/4) | 关闭 | 程序首次启动，查看“开聊记录”，报错Uncaught Exception: QueryFailedError: SQLITE_ERROR: no such table: main.chat_startup_log at handler | 已有初始化/迁移修复，保留空库回归 |
| [#1](https://github.com/geekgeekrun/geekgeekrun/issues/1) | 关闭 | 应届求职 工作经历匹配不准确 | 经验规范化已有；校招/实习场景仍需求职类型支持 |
