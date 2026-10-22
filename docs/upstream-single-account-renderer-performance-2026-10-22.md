# 单账号主线：渲染器、启动性能与构建续审

2026-10-22，分支 `codex/upstream-p1-fixes`，验收版本 `0.22.2`。保留前几轮未提交改动，未合入多账号分支，未发布版本。

**首屏执行的 JavaScript 从 2.57MB 降至 0.73MB；本机受控启动测量的可用时间中位数从 2.70s 降至 0.71s。生产构建已无大 chunk 警告。真实 BOSS 只收集任务 #58 通过，全程 0 发送、0 标记。**

## 测量方法及结果

使用同一台 macOS、项目 Electron、相同生产界面及 59 条职位的数据库副本。前后各运行 3 个独立进程，每次使用新的 Electron 配置目录，关闭隐藏窗口的后台限速。计时从父进程启动 Electron 到目标 DOM 和数据可用；记录实际解析的脚本及文件字节数。操作系统文件缓存未清空，因此属于进程启动测量，不是冷磁盘或可见首帧测量。功能验收另行执行，未混入计时样本。

| 项目 | 修复前 | 修复后 |
| --- | ---: | ---: |
| 首屏执行的脚本 | 2,569,161 B | 726,322 B |
| 启动至“找岗位”可用，中位数 | 2,702.56ms | 705.79ms |
| 三次启动范围 | 2,695.57–2,726.98ms | 702.65–1,225.41ms |
| 最大单个 JS chunk | 1,208,448 B | 489,460 B |
| 首次打开资料库，中位数 | 201.24ms | 216.76ms |
| 首次打开统计，中位数 | 402.38ms | 421.42ms |
| 打开任务页，中位数 | 42.96ms | 19.29ms |
| 打开设置页，中位数 | 10.04ms | 35.39ms |

首屏脚本减少约 71.7%，启动中位数减少约 73.9%。资料库和图表首开保留了按需加载的成本，未测出加速；这些数十毫秒的页面差异也受调度及渲染影响。首次资料库查询约有百毫秒的本地数据库工作进程初始化成本，可作为后续继续测量的点。本轮没有将所有页面描述为同比提速，也没有测量真实 BOSS 吞吐提升。

私有原始数据和对照位于 `.runtime/acceptance-renderer-upstream-2026-10-22/`，其中 `before-profile-*.json`、`final-profile-*.json`、`performance-comparison.json` 保存计时、脚本、IPC 和诊断。功能与截图样本使用独立前缀。

## 源码确认的瓶颈与修复

### 入口和默认页面提前加载未使用功能

原入口全量注册 Element Plus；默认“找岗位”页面又静态引入全部资料库及记录表格。一个命名为 `stats-presets` 的共享 chunk 实际包含 ECharts、Excel 导入导出和表格依赖，约 1.21MB；入口共享块另约 959KB。

现在：

- SFC 使用仓库已有的组件解析插件按需导入；Ux 的渲染函数使用明确的组件映射，保留原有组件和全局主题样式。
- 资料库、记录表格、预览表格和图片预览按需加载，并提供加载和失败状态。
- 图表组件在实际渲染图表时加载；XLSX 在解析或导出 CSV/Excel 时加载，JSON 和剪贴板路径独立运行。
- `lodash` 的节流函数改为具体模块导入，避免首屏为一个函数加载整库。
- 图表绘制引擎独立缓存。最终 EChart 约 382KB、绘制引擎约 169KB、XLSX 约 489KB；保留原 500KB 警告阈值。

实际脚本记录确认：首屏没有执行 EChart、绘制引擎或 XLSX；打开统计才执行图表代码，解析 CSV 才执行 XLSX。前后首屏脚本数量为 17 和 36，拆分增加了文件数量，但明显减少了首屏总字节数；结果以上述实测为准。

实现：[入口](../packages/ui/src/renderer/src/main.ts)、[Ux](../packages/ui/src/renderer/src/page/Ux/index.js)、[异步组件](../packages/ui/src/renderer/src/features/lazy-component.ts)、[图表](../packages/ui/src/renderer/src/features/RunDataTable/StatsPanel.vue)、[导入导出](../packages/ui/src/renderer/src/features/RunDataTable/io.ts)、[构建配置](../packages/ui/electron.vite.config.ts)。使用现有依赖；异步加载方式参考 [Vue 文档](https://vuejs.org/guide/components/async.html)，组件导入参考 [Element Plus 文档](https://element-plus.org/en-US/guide/quickstart.html)。

### 启动页固定等待两秒

原启动页在原生检查前等待 1500ms，检查后再等待 500ms。现在立即发起 `pre-enter-setting-ui`，等待首次使用确认和浏览器检查结束后进入工作区。回归覆盖检查尚未完成时不能进入界面，以及原有异常回退行为。

实现：[启动页](../packages/ui/src/renderer/src/page/BootstrapSplash/index.vue)、[顺序回归](../packages/ui/tests/bootstrap-startup.test.mjs)。

### 可重复的构建归因

新增可选构建报告，记录 chunk 大小、压缩大小、静态/动态依赖及模块贡献，不复制源代码，也不将报告放进发行渲染器。可用完整目标路径启用：

```sh
GEEKGEEKRUN_RENDERER_REPORT=/absolute/path/renderer-report.json pnpm --filter geekgeekrun-ui build
```

实现：[构建报告](../packages/ui/scripts/renderer-build-report.ts)。

## 上游剩余问题：构建失败不能被吞掉

本轮刷新了[上游 Issues](https://github.com/geekgeekrun/geekgeekrun/issues)和[PR](https://github.com/geekgeekrun/geekgeekrun/pulls)打开列表，仍显示 52 个和 6 个；继续按已有审计对照剩余项。

[#65](https://github.com/geekgeekrun/geekgeekrun/issues/65) 提到了安装阶段的类型诊断及 `|| exit 0` 掩盖错误。当前类型配置已能通过本机编译，本轮进一步修复仍存在的失败处理缺口：

- `postinstall` 删除无条件忽略失败，真实编译失败会向安装调用者返回失败。
- SQLite 构建使用子进程的 `cwd`，不再修改调用者的全局工作目录；优先沿用当前 pnpm 入口。
- 启动失败、非零退出和终止信号分别明确报错；辅助函数抛出错误，由 CLI 返回非零状态。

本机真实 `npm --prefix packages/sqlite-plugin run postinstall` 通过。隔离生命周期测试分别注入成功和编译失败，确认失败不能变成成功；另验证工作目录及 `SIGTERM` 诊断。没有声称重新复现该 Issue 的旧版蓝牙类型错误，也未执行全新 Windows 安装。

实现：[构建辅助函数](../packages/ui/scripts/steps/build-sqlite-plugin.mjs)、[入口](../packages/ui/scripts/run-build-sqlite-plugin.mjs)、[生命周期](../packages/sqlite-plugin/package.json)、[回归](../packages/ui/tests/sqlite-build-process.test.mjs)。

## 功能和真实只收集验收

最终生产界面检查了：找岗位、资料库、统计、CSV 导入预览、筛选预览、任务页、设置页及旧资料库入口，最终页面错误为 0。统计图正常绘制；CSV 仅解析预览了 1 行合成数据，没有提交导入。筛选预览显示 59 条资料库岗位，未开始任务；可见窗口截图确认布局正常。

JSON、CSV、XLSX 使用实际导入导出函数做往返测试，保留 `00123` 这类前导零 ID、中文名称和日薪金额/单位。异步组件的首次挂载、表格属性及插槽路径已由生产界面的实际预览和表格验证。

随后用原单账号登录态运行真实 BOSS **#58**：全国、薪资 5–10K、经验 1–3 年、本科、计算机软件、100–499 人。五项控件回读、实际请求及列表一致，浏览器保持最小化，收集 1 条，以 **92** 正常结束。未启动消息跟进，没有发送钉钉通知。

| 原运行目录数据 | 本轮前 | 本轮后 |
| --- | ---: | ---: |
| 唯一职位 `job_info` | 59 | 63 |
| 开聊 `chat_startup_log` | 0 | 0 |
| 不合适标记 `mark_as_not_suit_log` | 0 | 0 |

新增唯一职位包含网页预载，主动收集计数另行核对。原 `boss.json`、公共条件、公司名单和界面工作区草稿已逐字节恢复，保留登录态和已收集数据；没有待恢复的验收任务。记录过的 35 个所属进程 PID 均已退出，项目 Electron 进程已退出。

## 最终验证与范围

- **379 项不同测试全部验证通过**：Node 362 项通过、17 项原生用例跳过；项目 Electron 另执行 21 项全部通过，覆盖全部 17 项及 4 项重复验证。本轮新增 7 项。
- UI 主进程和 Vue 标准全量 `typecheck` 均为 0 诊断，保留原有严格设置和覆盖范围。
- 生产构建、真实 SQLite `postinstall`、修改脚本语法及 `git diff --check` 通过。

本轮没有测试真实发送、Windows 安装或发行包。暗色模式、钟点免打扰、地区/地铁筛选、多轮会话及简历图片仍待各自实施或验收；[#70](https://github.com/geekgeekrun/geekgeekrun/issues/70) 的排序意图仍待澄清，当前本地表格已有排序。多账号继续留在原分支。

## 分批合并前复验

本批基于已合并的搜索列表修复继续整理。主进程和渲染器类型检查、386 项完整回归（零失败、零跳过）及生产构建通过；SQLite 构建失败、退出信号、启动先决检查和导入导出往返均包含在本批回归中。

构建归因复核确认：入口与 Ux 的静态依赖不含 ECharts、zrender 或 XLSX；三个独立非入口分块分别为 382,477、169,010 和 489,460 字节。程序化渲染使用的 24 个组件都有对应注册。此前的真实页面和受控启动计时记录保持为原测量结果，本次未重新操作真实 BOSS 页面。
