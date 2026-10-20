# scraper 借鉴能力：运行预算与恢复记账

日期：2026-10-20。延续[首次发现与岗位摘要](scraper-discovery-summary-implementation-2026-10-20.md)，本批为找岗位任务补充请求预算、详情预算、累计运行时间及持久化记账。保留工作区其他改动；当前分支为 `codex/upstream-p1-fixes`。

## 配置与口径

“组合预算”仍控制每个来源的筛选组合数量。新增“找岗位 → 职位筛选与来源 → 本次运行预算”，两者分别生效。

| 配置 | 默认 | 最大可填值 | 统计口径 |
| --- | --- | --- | --- |
| 岗位接口请求 | 500 次 | 100,000 次 | 当前找岗位页面的搜索列表、推荐列表和详情接口的放行尝试，包含详情 |
| 其中详情请求 | 200 次 | 100,000 次 | 上述请求中 `/wapi/zpgeek/job/detail.json` 的尝试次数 |
| 累计运行时间 | 120 分钟 | 10,080 分钟 | 浏览器运行阶段累计时间，包含列表等待、详情停留和定时休息 |

单项填 `0` 表示不限制，留空采用默认值。只接受范围内的非负整数。失败、重复、自动重试请求均计数，不按唯一岗位去重；这些数字与“已查看并入库”“已收集”不同。图片、脚本、登录探测、消息和其他接口不在岗位请求预算中。

手动暂停、排队、安全验证及关闭浏览器后的重试间隔不计运行时间。使用单调时钟计时，系统日期调整不会清零用量；时间看门狗可打断较长等待，不依赖下一次岗位循环才检查。

配置字段随表单、模板和排队快照保存：

```json
{
  "autoChatRunBudget": {
    "requests": 500,
    "detailRequests": 200,
    "activeMinutes": 120
  }
}
```

开始前确认显示实际使用的预算；任务详情显示已用量与上限。恢复操作会先验证并保存当前配置，再提交任务，避免自动保存尚未完成时仍使用旧上限。

![预算进入开始前确认，隔离示例](../wiki/assets/ux-run-budget-confirm-2026-10-20.jpg)

## 请求放行与停止

通过当前任务 Page 的 CDP Fetch 拦截，只暂停上述三个岗位接口的请求阶段。每次放行之前，先同步更新并落盘预算；超出上限、台账无法保存或监听连接失效时，拒绝放行并停止任务。不会用“已完成岗位数量”估算请求数。

第 N 次允许的请求可以放行，第 N+1 次不能放行。达到上限后在业务检查点停止；已在途响应不保证都能完成入库，计数表示尝试次数。落盘后、实际放行前发生异常的预占次数不退回，以避免异常重启后少算。

详情检查前、岗位间和发送前有预算检查。累计运行时间耗尽可通过看门狗中断等待。GUI 和 CLI 使用停止码 `96`（额度耗尽）或 `97`（台账/监听不可用），退出自动重试路径；GUI 同步保存恢复位置与进度。保持运行编号不变并提高上限后，可以继续原任务。

Puppeteer 的断连事件使用 Symbol。已核对本地实际库：`puppeteer-extra` 使用 CommonJS 加载 Puppeteer；其事件 Symbol 与另行加载的 ESM 副本不同。预算监听使用同一个 CommonJS 副本，相关用例检查实际库的事件身份，避免监听失效却没有收到通知。

## 持久化与恢复

每个任务在当前数据目录下保存 `auto-chat-run-budgets/<runRecordId>.json`，包含版本、运行编号、请求/详情累计次数及累计运行毫秒数，不含凭证或 JD。

- 请求预占同步落盘，不依赖每五秒保存一次的恢复进度；恢复时对台账和快照中的各项用量取较大值。
- 暂停、让位、进程重启、浏览器重试、修改来源或筛选范围都不清零预算。
- 已耗尽的任务在重新打开浏览器之前停止。未进入来源循环时也保留待恢复的位置和换源计数，避免覆盖成初始位置。
- 只有用户明确新建的逻辑任务才初始化为零；恢复和守护进程重启不执行初始化。新建任务也能处理恢复旧数据库后运行编号再次分配的情况。
- 旧任务没有预算记录时，明确标记“启用预算前用量未知”，从启用后累计。已有预算快照却丢失台账、台账损坏或编号不符时停止，不静默清零。
- 每秒预占下一秒的运行时间；正常暂停保存实际时长。异常退出后最多保守多计一秒，避免该时间在重启时被退回。
- 无运行编号的独立 CLI 仅维护当前进程的累计用量。预算依赖现有守护进程的单任务串行执行，未验收手工同时运行多个同编号 CLI 进程的场景。

新增原子 JSON 写入工具：同目录唯一临时文件、独占创建、文件 `fsync`、原子替换及平台支持时的目录 `fsync`，失败清理自己的临时文件。预算台账、找岗位恢复记录和终止编号记录使用该工具；剩余普通配置、cookie/localStorage 写入未在本批全面重构。预算恢复需要完整数据目录，SQLite 单库备份不包含这些 JSON 台账。

后续的[第四批实现](runtime-json-hardening-2026-10-20.md)已补齐普通配置与 cookie/localStorage 写入、批量回滚及损坏文件保护，并覆盖刷盘耗时跨越预算时限的放行检查。

![预算耗尽后保留用量，隔离示例](../wiki/assets/ux-run-budget-progress-2026-10-20.jpg)

主要代码：

- [预算控制器](../packages/geek-auto-start-chat-with-boss/run-budget.mjs)、[预算文件](../packages/geek-auto-start-chat-with-boss/run-budget-store.mjs)、[请求拦截](../packages/geek-auto-start-chat-with-boss/job-request-budget.mjs)
- [运行流程和检查点](../packages/geek-auto-start-chat-with-boss/index.mjs)、[队列及新任务初始化](../packages/ui/src/main/features/run-common.ts)
- [原子 JSON 写入](../packages/utils/atomic-json.mjs)、[恢复记录](../packages/ui/src/main/features/task-resume.ts)

## 验证

本批新增 24 项预算、原子写入及恢复用例。当前工作区共 257 项不同用例完成验证：普通 Node 244 项通过、13 项原生 SQLite 用例跳过；项目 Electron 另行执行这 13 项，全部通过。总数包含工作区同期的登录子进程用例。

覆盖配置边界、零上限、真实表单序列化、排队快照、并发请求不得超额、写入先于放行、重复/失败请求计费、详情子预算、长等待超时、暂停不计时、异常重启、旧快照、提高上限继续、损坏和缺失台账、恢复前保存失败、来源循环前停止保留位置，以及并发 JSON 写入不出现截断。

```sh
node --test --test-isolation=none packages/geek-auto-start-chat-with-boss/tests/*.test.mjs packages/ui/tests/*.test.mjs packages/utils/tests/*.test.mjs packages/launch-bosszhipin-login-page-with-preload-extension/tests/*.test.mjs packages/pm/tests/*.test.cjs packages/sqlite-plugin/tests/*.test.cjs
ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --test packages/sqlite-plugin/tests/job-discovery.test.cjs packages/sqlite-plugin/tests/account-and-salary.test.cjs packages/ui/tests/favorites.test.mjs
npx --yes pnpm@8.15.9 --filter geekgeekrun-ui build
```

生产构建及 macOS arm64 解包构建通过。包内预算控制器、台账、请求监听和原子写入资源已检查；主进程编译产物包含预算停止码和拦截逻辑。使用打包后的 Electron 直接加载实际 `app.asar` 内的模块，验证两次放行、拒绝第三次、持久化后恢复继续累计及 Puppeteer 事件 Symbol 一致。此检查使用模拟 CDP 会话，不连接 BOSS。可重复运行[打包验收脚本](../packages/ui/scripts/smoke-run-budget.cjs)：

```sh
ELECTRON_RUN_AS_NODE=1 GGR_QA_ARCHIVE="$PWD/packages/ui/dist/mac-arm64/GeekGeekRun.app/Contents/Resources/app.asar" ./packages/ui/dist/mac-arm64/GeekGeekRun.app/Contents/MacOS/GeekGeekRun packages/ui/scripts/smoke-run-budget.cjs
```

全量类型检查仍有原有诊断：主进程 136 项、渲染器 327 项；与开工快照对照没有新增或减少。构建成功不代表这些历史问题已经解决。

界面验证使用生产渲染器及隔离 IPC，保存端调用真实配置合并和校验函数。验证修改、失焦后显示一致、保存及确认页显示 `650 / 250 / 60`；暂停示例显示 `500 / 500` 岗位请求、`80 / 200` 详情及 `30.0 / 120` 分钟，并展示预算耗尽原因。修正了数值控件内部旧值覆盖显示的问题，使用直接受控数值输入。没有点击“确认开始”；隔离服务拒绝了恢复任务的启动请求，未启动真实任务。

本批未连接真实 BOSS 账号、未发送消息、未修改用户数据库，也未发布版本。真实站点 CDP 请求覆盖、人工安全验证、Windows 和长期运行仍需现场验收。
