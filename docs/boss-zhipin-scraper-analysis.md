# boss-zhipin-scraper 对比审查与能力引入建议

审查日期：2026-10-20（Asia/Shanghai）。本文基于本地源码、上游 issues、PR #99 的实际 diff、隔离测试和构建结果，修订此前的功能对比。issue 中的根因猜测、PR 作者的效果描述和实际验证结果分别标明。

实现进展：响应守卫和平台职位类目筛选见[第一批实现与验证](scraper-capabilities-implementation-2026-10-20.md)；首次发现台账、本轮新增筛选和本地岗位摘要见[第二批实现与验证](scraper-discovery-summary-implementation-2026-10-20.md)。以下对照保留审查基线，作为当时的选型依据。

运行预算（岗位接口、详情请求、累计时间）及恢复记账见[第三批实现与验证](scraper-run-budget-implementation-2026-10-20.md)。

剩余配置、cookie/localStorage 及相关运行状态的 JSON 写入加固见[第四批实现与验证](runtime-json-hardening-2026-10-20.md)。

**2026-10-22 增量复核：** 可靠性守卫、平台职类、运行预算、首次发现、JD 摘要及 JSON 写入加固均已落地；后台最小化已有 macOS 单账号真实只收集验收。同范围跨任务差集和 scraper 离线导入也已补齐，优先级、实现边界与验证见[后续能力复核](scraper-followup-2026-10-22.md)。下文中的缺口和上游状态仍是 2026-10-20 审查基线，不代表当前实现状态。

## 1. 决策结论

**建议按能力移植到 GeekGeekRun，不整仓合并，也不把 Python CLI 作为默认运行引擎。PR #99 建议修订后再合并到 scraper；其职位码表和平台端类目筛选值得引入 GeekGeekRun。**

- **先做可靠性改进**：区分登录失效、接口限制、空结果与接口异常；修正响应监听注册时机；在扩大采集范围前明确任务预算与暂停/恢复语义。
- **再增加平台职位类目筛选**：采用 PR #99 的码表结构与 `position` 参数思路，接入现有搜索来源、配置快照和恢复机制。这与现有的本地职位分类关键词匹配是两层能力。
- **随后增加首次发现记录与岗位市场摘要**：使用现有 SQLite 和统计界面，复用稳定的岗位 ID。跨轮结果差集不能直接称为“平台新发布岗位”。
- **有条件验证后台焦点兼容性**：已有问题反馈能支持开展实验，不能据此承诺当前项目存在同一缺陷，或承诺随机动作、CDP 焦点仿真能降低风控。
- **暂缓整体 Python 引擎、Graphiti/Neo4j 和第二套浏览器 profile 管理**。它们会增加运行时、发布和登录会话的维护成本。若有现成 scraper 数据需要使用，可单独增加离线导入适配器。

## 2. 审查基线与项目情况

| 对象 | 本次审查基线 | 观察 |
| --- | --- | --- |
| GeekGeekRun | 本地 `429102c3bb11c6a03bf73851961d498fddcecd63`，UI 0.22.1 | Electron / Node.js / Puppeteer / SQLite；已有只收集、开聊、消息跟进、来源轮换、任务队列、配置快照、收藏和统计 |
| scraper master | fetch 后的 `b8076fceb9cb5e5e1ae28c155e8c1b894cfec7cc` | Python >=3.10；业务依赖仅 requests、websocket-client；CLI 采集及离线摘要，输出 JSON/CSV |
| PR #99 | `3bd1e519fad04477490bc177bb728f6fadb2a901`，相对上述 master | 截至审查时为 Open；1 个提交、7 个变更文件；核心参数链路改动很小，新增职位码表及 2 项码表测试 |
| 许可证记录 | scraper：MIT；GeekGeekRun：AGPL-3.0 | 移植时应记录来源提交，并保留引入部分的原版权和许可文本 |

scraper 的优势是轻量 CLI、可复用浏览器会话、列表响应捕获、结构化错误分类、增量文件输出和求职摘要。GeekGeekRun 已提供更完整的桌面流程与数据持久化；此次适合补充特定能力，不需要替换现有架构。

scraper 存在明确的维护活动、PR/issue 模板及 Python 3.10/3.13 的 CI 配置；这些是工程基础。下面的构建遗漏、后续页限制处理和版本检查缺口说明，测试通过仍需结合交付包与行为验证判断。

来源：[上游仓库](https://github.com/eatmoreduck/boss-zhipin-scraper)、[issues 列表](https://github.com/eatmoreduck/boss-zhipin-scraper/issues)、[PR #99](https://github.com/eatmoreduck/boss-zhipin-scraper/pull/99)。

## 3. 对原分析的关键修正

| 原判断 | 本次核实 | 对采纳判断的影响 |
| --- | --- | --- |
| GeekGeekRun 主要只有自动开聊，scraper 的只收集可补齐 | GeekGeekRun 已有 `collect` / `collectOnlyMatchingJobs`，并有禁止收集模式发送的检查 | 只收集不列为新增能力；引入采集改进时继续保留发送边界 |
| 没有随机滚动/鼠标行为 | `auto-chat-navigation.mjs` 已移动鼠标、随机设置滚动增量并用 wheel 加载下一批 | 可以调整节奏，但缺少“拟人化能降低风控”的对照证据，不列为直接可落地的 P0 |
| 城市主要在线获取，缺少静态城市表 | `cityGroup.mjs` 已随源码提供 373 个城市条目 | 不需要重新搬入一套城市表；只核对缺项、码值和更新机制 |
| JSON 写入普遍不是原子的 | `ux-config.ts` 的工作区/配置批量保存已经使用临时文件与 rename；部分 cookie/storage 写入仍是直接 writeFile | 针对剩余写入路径统一加固，不重复改造已具备原子替换的路径 |
| `waitForResponse` 会因为页面消费响应而失效，应该换 raw CDP | 未找到支持“页面消费导致失效”的证据。当前源码存在更直接的时序问题：切源动作完成后才调用 `waitForResponse` | 先注册等待再触发动作，并按来源/请求参数关联响应；保留 Puppeteer 的 Page 绑定，不直接替换网络层 |
| 五态分类意味着所有限制响应都会立即停止 | scraper 的登录等待和列表第一页会停止；后续页未经过同一分类，已复现 code 37 后仍继续下一页 | 采纳分类设计，但对每一页、详情和恢复入口补齐停止语义 |
| 版本一致性测试能保证版本四处同步 | 脚本/Skill 为 2.3.1，pyproject/构建 wheel 为 2.3.0；测试的 `_normalize_version` 主动忽略 patch | 这是既有工程缺口；不把“有一致性测试”当成 patch 一致的证据 |
| 详情 DOM 的 120 字校验适合直接移植 | GeekGeekRun 已从右侧详情的结构化 `postDescription` 入库 | 优先检查岗位 ID、字段完整性和登录墙；不要直接加入会排除简短有效 JD 的固定长度门槛 |

对应源码：

- [现有滚动、列表快照与详情确认](../packages/geek-auto-start-chat-with-boss/auto-chat-navigation.mjs)。
- [现有城市静态数据](../packages/geek-auto-start-chat-with-boss/cityGroup.mjs)。
- [现有原子配置写入](../packages/ui/src/main/features/ux-config.ts) 与 [仍需梳理的运行文件写入](../packages/geek-auto-start-chat-with-boss/runtime-file-utils.mjs)。
- [切源后才注册响应等待的代码](https://github.com/en0th/geekgeekrun/blob/429102c3bb11c6a03bf73851961d498fddcecd63/packages/geek-auto-start-chat-with-boss/index.mjs#L990-L1002)。这是静态时序发现，尚未在真实 BOSS 会话复现。

## 4. PR #99 的具体审查

### 4.1 新增能力与真实边界

PR 新增 `--position` 参数，并将其纳入 `filters`，由现有 `build_search_url` 写入搜索页 URL。码表 `_meta` 声明来源为 BOSS 职类接口，快照日期为 **2026-10-19**；本次实际核对为 **21 个大类、118 个二级类目、848 个叶子职位，合计 987 个不重复编码**。987 不是具体职位叶子数。

它增加的是**平台搜索阶段的职类条件**。GeekGeekRun 现有“职位分类”使用 `positionName` 等详情字段进行本地匹配，无法自动替代搜索端筛选。两者应分别命名和保存。

本次使用 mock 隔离 `scrape_list`，验证 CLI 到 filters/URL 的传递结果：

| 调用 | 实际产生的参数 | 判断 |
| --- | --- | --- |
| `--position 100109` | `query=AI Agent`、`position=100109` | 默认关键词仍存在，不等于只按 Python 职类搜索 |
| `--keyword Java --position 100101,100109` | query 与两个 position 编码同时传入 | 这是附加筛选，不能据此承诺扩大关键词召回 |
| `--keyword '' --position 100109` | 空 query、position 编码 | CLI 可以构造；空关键词及多编码是否被网页实际接受，仍需真实页面验证 |

**码表的官方来源是 PR 内元数据声明；本次未向 BOSS 实时接口核验整张码表，也未验证网页最终请求体是否完整保留 position。**

### 4.2 [P2，合并前修正] wheel 和 Skill 发布包遗漏新码表

实际运行 `uv build --wheel` 和 `bash scripts/package-skill.sh` 后：

```text
wheel: boss_zhipin_scraper-2.3.0-py3-none-any.whl
  data/city_codes.json
  没有 data/position_codes.json

Skill stage: dist/boss-zhipin-scraper-2.3.1/
  data/city_codes.json
  没有 data/position_codes.json
```

原因：`pyproject.toml:37` 的 `force-include` 只列城市表；`scripts/package-skill.sh:74` 的复制及第 79 行的存在性验证也只列城市表。PR 的源码测试从仓库直接读新 JSON，因此这两个测试发现不了交付包缺文件。

影响是安装用户无法获得文档引用的完整职位码表；已知编码仍可手工传给参数。合并前应补齐两种发布资源清单，并增加对实际 wheel/Skill stage 的内容检查。

证据：[wheel 资源清单](https://github.com/eatmoreduck/boss-zhipin-scraper/blob/3bd1e519fad04477490bc177bb728f6fadb2a901/pyproject.toml#L34-L37)、[Skill 打包脚本](https://github.com/eatmoreduck/boss-zhipin-scraper/blob/3bd1e519fad04477490bc177bb728f6fadb2a901/scripts/package-skill.sh#L69-L84)。这两份文件在 PR 中未更新。

### 4.3 [P2，新增维度应补齐] position 未参与跨轮基准匹配

`find_diff_base(result_dir, keyword, city)` 只比较 keyword/city。原有筛选条件也没有参与匹配；PR 再增加 position 后仍沿用该规则。

本次构造历史文件：keyword=Java、city=上海、position=100101。当前期望 position=100109 时，自动基准选择仍会选中那份 Java 职类文件。这会让跨轮变化混入“搜索范围变更”，降低 `is_new` 的可解释性。[#97](https://github.com/eatmoreduck/boss-zhipin-scraper/issues/97) 已对公司维度提出同一类问题。

建议：为自动跨轮比较引入规范化查询签名，至少覆盖 keyword、city 和完整 filters；多选编码排序、去空值后再比较。对没有签名的旧文件给出清楚的兼容提示。显式 `--diff-base` 继续允许用户主动选择，但应展示比较范围。

证据：[自动基准选择](https://github.com/eatmoreduck/boss-zhipin-scraper/blob/3bd1e519fad04477490bc177bb728f6fadb2a901/scripts/boss_cdp_raw.py#L1415-L1450)、[调用时未传 filters](https://github.com/eatmoreduck/boss-zhipin-scraper/blob/3bd1e519fad04477490bc177bb728f6fadb2a901/scripts/boss_cdp_raw.py#L1608-L1632)。

### 4.4 测试与合并条件

- master 的全量 mock 单测 **114/114 通过**；PR #99 **116/116 通过**。本地运行时为 Python 3.14.7。
- 新增的两项测试检查码表结构/部分已知编码，没有覆盖 CLI 参数传递、网页请求参数、跨轮基准或发布包。
- 本次额外验证了 CLI 参数透传和两种发布包，并复现了上述遗漏。
- 未独立取得远端 CI 的完整结论；本地 3.14.7 结果不代替仓库 CI 的 3.10/3.13 矩阵。

**对 scraper 上游的合并建议：请求修改。** 补资源打包、完善查询基准、加入参数/交付集成测试后，再提供单职类、多职类、空关键词的真实浏览器验证记录。仓库 AGENTS 要求抓取链路在真机执行 `--check`、`--smoke-test`、`--pages 2 --no-detail`；该要求是上游的验收规则，本次审查未执行真实采集。

## 5. scraper 基线问题：移植前应吸收教训

以下问题在 master 已存在，**不是 PR #99 新引入的缺陷**。

### 5.1 后续页 code 37 没有立即停止

`gate_first_response` 只在第一页调用；后续页直接进入 `map_api_jobs`。本次复用仓库 `FakeCaptureCDP` 和 `_run_scrape_list` 构造三页响应：

```text
第 1 页：code=0，岗位 A
第 2 页：code=37，环境存在异常
第 3 页：code=0，岗位 C

实际：读取了 3 个响应，最终返回 A、C，没有在第 2 页停止。
```

因此，原分析中的“RESTRICTED 立即停止、不密集重试”只对部分入口成立。移植时应让每个相关响应都执行分类；受限时保存已有进度并暂停，不能当成普通空列表继续翻页。

证据：[仅第一页执行 gate，后续页直接解析](https://github.com/eatmoreduck/boss-zhipin-scraper/blob/b8076fceb9cb5e5e1ae28c155e8c1b894cfec7cc/scripts/boss_cdp_raw.py#L1727-L1757)。

### 5.2 is_new、预算和版本检查的限制

- [#90](https://github.com/eatmoreduck/boss-zhipin-scraper/issues/90) 仍开放：显式基准文件读取失败会返回空集合；合并文件会混合不同基准下的 `is_new`；现有覆盖主要是纯函数测试。GeekGeekRun 适合使用首次发现台账，并单独定义“相对某次同范围运行新增”。
- `MAX_API_REQUESTS=500` 的计数由登录探测、翻页和详情入口显式递增，**不是对所有实际 HTTP 请求的完整计数**。引入预算时应定义清楚统计的是业务接口请求、页面动作还是详情数，并保存到任务恢复状态。
- `_normalize_version` 将 2.3.0 和 2.3.1 都归一化为 2.3。本次 wheel 版本与脚本版本不同而单测通过，是这项检查的预期行为；应收紧发布版本验证。
- raw CDP 捕获器扫描累计事件缓存，未在 `_next_completed` 按 sessionId 隔离，也未清理已消费事件。若借用其设计，应补来源隔离和缓存上限；GeekGeekRun 无需为此放弃 Page 级的 Puppeteer 绑定。

## 6. 当前 9 个开放 issue 的采纳判断

状态按本次访问的 issues 列表记录；功能是否存在以代码为准。

| issue | 上游诉求/现状 | 对 GeekGeekRun 的判断 |
| --- | --- | --- |
| [#97 公司维度](https://github.com/eatmoreduck/boss-zhipin-scraper/issues/97) | 提出公司名搜索说明、本地公司过滤、公司主页/品牌 ID 来源三个不同方案 | 已有公司包含/排除和公司资料库；后续已核验并接入独立公司招聘页来源、品牌/岗位身份和原生分页，保留筛选与只收集边界，见[公司来源验收](company-job-source-2026-10-22.md) |
| [#94 最多 20 页](https://github.com/eatmoreduck/boss-zhipin-scraper/issues/94) | 请求从 10 提到 20；源码当前会警告并钳制到 10，并非完全静默 | 采用可配置任务预算思路；不直接照搬 20 或 500 作为安全阈值 |
| [#90 跨轮比较](https://github.com/eatmoreduck/boss-zhipin-scraper/issues/90) | 基准加载告警、集成测试和 merge 语义仍待跟进 | 值得采用“首次发现”和“同范围跨轮新增”两个明确定义，使用 SQLite 实现 |
| [#85 岗位知识图谱](https://github.com/eatmoreduck/boss-zhipin-scraper/issues/85) | 提案涉及外部 Graphiti/Neo4j、MySQL 表与 LLM；这些不属于本次 JSON CLI 基线的现有能力 | 暂缓；未来可做只读导出/独立分析插件，不列入默认采集依赖 |
| [#84 右侧面板 JD](https://github.com/eatmoreduck/boss-zhipin-scraper/issues/84) | 希望用当前列表右侧面板替代逐岗位打开独立详情页 | GeekGeekRun 已经点击卡片、核对岗位 ID、从右侧详情读取结构化数据，属于已有优势 |
| [#75 多关键词合并](https://github.com/eatmoreduck/boss-zhipin-scraper/issues/75) | CLI 尚未提供原生多关键词轮询 | GeekGeekRun 已有搜索来源轮换及数据库去重，不需要移植 |
| [#62 Agent Skill 清单](https://github.com/eatmoreduck/boss-zhipin-scraper/issues/62) | 希望增加标准 Skill 发现入口 | 属于工具集成形式，不是桌面采集能力；有 CLI/代理调用需求时再做 |
| [#41 默认 Edge](https://github.com/eatmoreduck/boss-zhipin-scraper/issues/41) | issue 仍开放，但源码已提供 `--setup-edge`、`--stop-edge`、`--browser edge`，默认仍 Chrome | 不能按 issue 早期描述判为“完全不支持 Edge”；GeekGeekRun 已有本机 Chromium 路径选择与浏览器助手，暂不引入第二套启动器 |
| [#30 Windows/CDP 异常](https://github.com/eatmoreduck/boss-zhipin-scraper/issues/30) | 持续开放；维护者指出原反馈使用旧 Chrome、Node 重写及代理等变量，未确认端口扫描就是根因 | 增加可诊断的受限/空白页/连接异常状态；不能把它当作 raw CDP 稳定低风险的证明 |

历史问题也有参考价值：[#53](https://github.com/eatmoreduck/boss-zhipin-scraper/issues/53) 已通过 [#55](https://github.com/eatmoreduck/boss-zhipin-scraper/pull/55) 合并被动捕获及首个真实响应复用；[#18](https://github.com/eatmoreduck/boss-zhipin-scraper/issues/18) 的维护者说明根因不是默认 context 丢 cookies；[#29](https://github.com/eatmoreduck/boss-zhipin-scraper/pull/29) 是已合并的后台 target 管理 PR。相关实测是特定环境下的上游证据，需要在 GeekGeekRun 自己的浏览器生命周期中重新验证。

## 7. 引入路线与工程成本

成本是基于当前耦合点的相对估计，实际范围取决于真实网页请求行为与验收结果。

| 顺序 | 能力与方式 | 主要落点/成本 | 验收条件 |
| --- | --- | --- | --- |
| 1 | 统一登录、受限、空结果、服务异常分类 | `boss-login.mjs`、主进程登录检查、采集 worker；小至中 | 31/37、401/403/429、5xx、非 JSON、空结果都有独立 fixture；受限时暂停并保留进度，恢复不自动变更运行方式 |
| 1 | 响应监听与来源关联 | `index.mjs`、导航辅助；中 | 等待注册早于切源/筛选触发；快速响应不丢；迟到的上个来源响应不会混入当前任务；保留岗位 ID 核对与发送前检查 |
| 1 | 明确采集预算 | `run-settings.mjs`、任务进度/恢复、设置页；中 | 请求/详情/时长指标定义清楚；达到预算后保存并停止；排队、让位和重启不能重置已经消耗的额度 |
| 2 | 平台职位类目筛选 + 848 叶子码表 | 来源配置、选择器、搜索动作、快照与来源 fingerprint；中 | 单选/多选/空关键词在实际请求中生效；类目与本地关键词是独立条件；修改类目后恢复位置不沿用错误范围；Electron 交付包含码表 |
| 3 | 首次发现/本轮新增 | SQLite migration、岗位保存、RunDataTable；中 | 保存 firstSeen 时间/运行 ID；历史数据不全量误标新；暂停恢复仍属同一运行；用 SQL 查询，不在每次任务开始时加载全库 ID 集合 |
| 3 | 技能/JD 高频词与求职摘要 | 现有统计面板与导出；小至中 | 使用现有结构化 JD；明确样本量、缺失率、采样日期；不把采样统计宣传为全市场统计 |
| 补充 | 剩余 JSON 写入加固 | `runtime-file-utils.mjs`、cookie/localStorage 保存；小至中 | 临时文件唯一、原子替换、失败保留旧内容；必要的文件/目录刷盘与 Windows 文件占用场景测试 |
| 实验 | 后台最小化/遮挡兼容 | 浏览器初始化与滚动；中 | 在前台、后台、最小化场景对比加载成功率；仅在可复现问题上决定是否使用焦点兼容设置 |

当前最直接的缺口已做纯函数核验：`interpretUserInfoResponse` 收到 code 31/37 都返回 `invalid`。应优先增加“受限”状态和对应处理，不把所有非零业务码都导向重新登录。分类规则需按实际接口契约建立；scraper 针对搜索接口使用的“明文薪资”信号不能直接搬到用户信息接口。

职位类目实现时，建议随现有来源对象保存 `positionCodes`，同步进入规范化来源指纹。现有 `jobSourceList` 快照保留整棵来源配置，但 fingerprint 当前只覆盖 type/selector/keyword 等信息；只加界面字段而遗漏恢复位置判定会引入新问题。

### 离线导入作为可选桥接

如果目标是复用已经产生的 scraper 结果，优先做 JSON/CSV 导入适配器，可避免给 Electron 安装包增加 Python 运行时。至少明确以下映射：

- 用 `encrypt_job_id` 对应现有 `encryptJobId`，不要用 scraper 的 MD5 job_id 替代已有主键。
- scraper 的 `boss_name` 实际来自 `brandName`，代表公司品牌，不能映射成招聘者姓名。该点也被 #97 正文明示。
- `encrypt_brand_id`、`encrypt_boss_id`、JD 缺失状态、薪资单位与来源时间需要显式处理；缺少的信息保留缺失，不制造招聘者信息。
- 导入采用预览和数据库写入流程，不附带开聊动作；复用现有去重及数据导入机制。

## 8. 本次验证、复现与限制

实际验证在 `/tmp` 的两个独立源码目录完成，源仓库工作区未用于构建。可复现的核心命令如下，应分别在对应提交的临时检出目录执行：

```bash
uv sync --locked
uv run python -m unittest tests.test_chrome_setup tests.test_job_summary -v
uv build --wheel --out-dir dist
bash scripts/package-skill.sh
```

额外检查：读取 wheel 的 ZIP 成员及 Skill stage 文件列表；mock 调用 `main()` 核对 position 的 filters/URL；构造不同 position 的历史文件调用 `find_diff_base`；复用仓库 FakeCaptureCDP 重现后续页 code 37 仍继续；导入 GeekGeekRun 的纯函数确认 31/37 分类和本地 373 个城市条目。

本次没有启动真实 BOSS 采集、没有调用真实账号或发送消息，也没有更改上游 issue/PR 状态。结论是：**可靠性机制值得选择性移植，平台职类筛选值得新增；PR #99 当前交付与比较语义应先补齐，整项目合并没有足够收益。**
