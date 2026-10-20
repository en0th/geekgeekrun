# scraper 借鉴能力：首次发现台账与岗位摘要

日期：2026-10-20。延续[第一批实现](scraper-capabilities-implementation-2026-10-20.md)，本批在 GeekGeekRun 现有 SQLite、任务详情和资料库中实现首次发现记录、任务内新增筛选及本地 JD 摘要。保留工作区已有改动，未引入 Python 运行时。

## 发现记录的口径

“首次发现”指某个 `encryptJobId` 首次进入当前本地数据库，覆盖所有搜索来源及使用该数据库的账号，不代表平台发布时间，也不是与上一次同条件搜索结果做差集。

新增迁移 `1792454500000-AddJobDiscovery`：

| 表 | 用途 |
| --- | --- |
| `job_discovery` | 以岗位 ID 为主键，保存首次入库时间、首次采集任务编号、来源及最近采集时间 |
| `job_run_observation` | 以 `(runRecordId, encryptJobId)` 为联合主键，保存某任务实际采集过的岗位及首次/最近采集时间 |

- 已有岗位迁移为 `legacy` 历史存量，首次时间与任务编号为空。升级时不补造“今天新发现”。
- 新采集岗位记录 `capture` 和真实时间；运行编号大于零时关联任务。没有运行编号的浏览采集可以入库，但不伪造任务。
- 文件导入记录为 `import`；导入文件携带的首次时间和任务编号不能覆盖本库台账，避免把其他数据库的任务关联到本地任务。
- 岗位详情与发现记录在同一个短 SQLite 事务中写入，失败一起回滚。省略的字段保留原值，显式 `null` 清空，与原有 ORM 保存语义一致。
- 详情写入队列串行执行，避免不同岗位的异步 ORM 事务在同一连接上重叠；成功版本缓存仍有容量上限。网络捕获与业务详情钩子重复命中时，去重内容写入，但继续更新任务观察记录。
- 重复查看、后续任务更新和暂停恢复不覆盖首次发现任务。同一运行编号恢复后，原本的新增岗位仍属于该任务。
- 删除资料库详情仍保留发现台账，之后重新采集不会再次被标为新岗位；删除确认界面已说明此语义。

主要代码：[迁移](../packages/sqlite-plugin/src/migrations/1792454500000-AddJobDiscovery.ts)、[事务写入](../packages/sqlite-plugin/src/job-discovery.ts)、[详情队列](../packages/sqlite-plugin/src/detail-writer.ts)。

## 任务和资料库界面

资料库职位表新增“首次入库时间”和“入库来源”；“首次入库任务”“最近采集时间”可从列设置中显示，并可用于高级过滤、排序和导出。

只收集任务的“本次数据”按持久化观察记录查询，而不是用最近检查时间猜测归属。可切换：

- **本轮采集**：该运行编号实际采集过且详情仍保存在资料库的岗位。
- **本轮新增**：上述岗位中，首次采集入库任务就是本次运行的岗位。

“在资料库查看本轮新增”转成明确的首次任务编号过滤。台账启用前的历史运行不能重建完整观察集合；老任务恢复后，新增观察记录仅覆盖恢复后的采集。任务界面已提示这一边界。

任务归属固定，但展示的详情和摘要使用资料库当前保存的内容，未实现逐任务 JD 历史快照。

![隔离示例：5 个采集岗位中有 4 个本轮新增](../wiki/assets/ux-job-discovery-2026-10-20.jpg)

## 岗位摘要

职位库和收藏职位表新增“岗位摘要”。打开时保存当前查询条件，使用与表格相同的搜索、过滤和任务观察范围，分页不影响摘要。同一岗位在多个收藏夹出现时只计一次。

摘要在数据库 worker 中执行，不调用外部模型或服务：

- 展示筛选岗位数、分析样本数、有 JD/缺少 JD 数量、采集/导入/历史存量来源以及已知首次入库时间范围。
- 技能提及按内置词表匹配，合并常见别名，区分 Java/JavaScript、SQL/MySQL 等完整词语，并识别 Python3、Vue3、C++、.NET 等名称。
- JD 高频词使用 ICU 中文分词与英文词语统计，过滤常见招聘套话、链接、邮箱、脚本/样式和 HTML 标记，并移除已经识别的技能名称。
- 每个岗位对同一词最多计一次。占比的分母是有 JD 的岗位数，不因同一 JD 重复词语而提高。
- 最多分析 5,000 个唯一岗位，按首次入库时间倒序选取、日期未知的排后，岗位 ID 作稳定次序；超出时明确提示采样。每份 JD 最多分析前 50,000 字，并披露截断数量。
- 逐行读取 JD，避免一次将全部长文本装进数组；SQL 字段仍走白名单，条件使用绑定参数。

词表覆盖有限，技能提及不判断必需程度、否定语义或熟练程度。时间范围表示本地入库时间；摘要只反映保存样本，不能推断平台全市场。

主要代码：[查询范围与摘要入口](../packages/ui/src/main/flow/OPEN_SETTING_WINDOW/utils/db/worker/run-data.ts)、[本地分析](../packages/ui/src/main/flow/OPEN_SETTING_WINDOW/utils/db/worker/job-summary.ts)、[摘要界面](../packages/ui/src/renderer/src/features/RunDataTable/JobSummaryPanel.vue)。

![隔离示例：本轮新增 4 个岗位、3 份 JD 的摘要](../wiki/assets/ux-job-summary-2026-10-20.jpg)

## 验证结果

本批新增 11 项用例，当前工作区共 228 项不同用例完成：普通 Node 运行 215 项通过、13 项原生 SQLite 用例跳过；项目 Electron 单独运行这 13 项，全部通过。

覆盖旧表迁移、全新数据库、失败回滚、并发详情钩子、跨岗位写入串行、重复采集、恢复同一运行、删除后重采、历史/导入来源、未知日期、导入元数据隔离、同一任务的查询/统计/摘要范围一致、收藏去重、空 JD、技能边界、别名和高频重复词去重，以及 5,000 岗位/50,000 字边界。

```sh
node --test --test-isolation=none packages/geek-auto-start-chat-with-boss/tests/*.test.mjs packages/ui/tests/*.test.mjs packages/utils/tests/*.test.mjs packages/launch-bosszhipin-login-page-with-preload-extension/tests/*.test.mjs packages/pm/tests/*.test.cjs packages/sqlite-plugin/tests/*.test.cjs
ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --test packages/sqlite-plugin/tests/job-discovery.test.cjs packages/sqlite-plugin/tests/account-and-salary.test.cjs packages/ui/tests/favorites.test.mjs
npx --yes pnpm@8.15.9 --filter geekgeekrun-ui build
```

生产构建及 macOS arm64 解包构建通过。实际打包后的 Electron 从包内加载 SQLite 插件和 native 模块，在内存库中执行新迁移及跨任务采集，验证首次任务不变、观察任务保留两条。安装包主进程/worker 中包含摘要 IPC 和观察记录查询。未签名、未发布。

SQLite 插件编译通过。全量 UI 类型检查仍有原有问题；与开工快照按诊断内容对照，主进程 136 项、渲染器 327 项，未新增诊断。

界面验证使用生产渲染器、隔离 IPC 和内存示例数据库，调用实际查询与分析代码。验证了 5 个采集岗位切换为 4 个新增岗位，摘要显示 4 个样本/3 份 JD/1 个缺失；跳转资料库后叠加“算法”搜索，列表和摘要都缩小为 1 个岗位。最终刷新后未出现新的脚本错误；中途重启隔离服务时旧页面有两条轮询请求失败记录。

本批没有连接真实 BOSS 账号或修改用户数据库。Windows、真实站点和真实长任务的验收仍待开展。请求/详情/时长预算及恢复记录加固见[第三批实现](scraper-run-budget-implementation-2026-10-20.md)，剩余配置与凭证 JSON 写入加固见[第四批实现](runtime-json-hardening-2026-10-20.md)。离线 scraper 专用导入适配器仍是可选增量。
