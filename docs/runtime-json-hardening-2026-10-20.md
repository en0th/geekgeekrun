# 运行时配置与登录状态 JSON 写入加固

日期：2026-10-20。延续[运行预算与恢复记账](scraper-run-budget-implementation-2026-10-20.md)，本批补齐剩余配置和 cookie/localStorage 的安全写入。原文件名、目录布局和 JSON 格式保持兼容；保留工作区已有及同期改动。

## 覆盖范围

| 入口 | 本批处理 |
| --- | --- |
| `writeConfigFile` / `writeStorageFile` | 配置、节奏、日志设置、备份设置、提示词及其他运行状态统一经过公共写入层 |
| 缺失默认文件、旧公共配置迁移 | 独占发布，不覆盖其他进程刚保存的文件；迁移不再回写旧 `boss.json` 源文件 |
| cookie / localStorage | 登录助手、找岗位与消息跟进使用同批保存，先校验和准备完整内容 |
| 工作区、退出草稿、模型、通知、浏览器配置 | 正向保存及失败回滚使用同一套原子替换，旧模型加密备份先完成刷盘 |
| 数据目录记录、排队配置快照、任务历史 | 原子保存；损坏的关键记录保留并报错，损坏历史保留并停止覆盖 |
| 手动导出的模板和其他文件 | 通用导出入口也改为原子写入 |

SQLite 数据库及其备份沿用原有机制。纯文本的首次启动版本标记、扩展解压完成标记不属于 JSON 配置。

主要代码：[公共文件层](../packages/utils/atomic-file.cjs)、[ESM / Promise 接口](../packages/utils/atomic-json.mjs)、[运行时文件入口](../packages/geek-auto-start-chat-with-boss/runtime-file-utils.mjs)、[设置 IPC](../packages/ui/src/main/features/ux-config.ts)。守护进程通过声明的工作区依赖使用同一个 CommonJS 公共文件层。

## 单文件提交

1. 先编码、校验并复制内容，之后再创建文件。
2. 在目标同一目录使用唯一名称和 `wx` 独占创建临时文件，POSIX 权限为 `0600`。
3. 完整写入后执行文件 `fsync`，关闭文件，再原子替换目标。
4. 平台支持时同步目录元数据，清理本次创建的临时文件。

同步与 Promise 接口使用相同的短同步提交区间。同一进程中混用接口时，提交顺序与调用顺序一致，不会因异步完成次序把较早内容覆盖回来。

Windows 常见的 `EPERM`、`EACCES`、`EBUSY`、`EEXIST` 替换失败最多重试五次，退避等待累计 150 毫秒，不包括系统 I/O 自身耗时。重试过程中保留目标文件，不通过先删除目标的方式绕过占用。

默认初始化通过同目录硬链接独占发布，避免 `exists + rename` 之间覆盖新保存的配置。缺失默认文件的初始化需要文件系统支持这一能力；不支持时明确报错，不降级为可能覆盖现有数据的写法。普通更新使用同目录重命名。

替换前失败时，旧目标不变。替换成功后如果目录刷盘确认失败，会抛错并标记 `atomicCommitted`，不能据此假定旧版本仍是当前版本。临时文件清理失败会保留文件并记录提示；不会删除未由本次调用成功创建的临时文件。

## 批量保存与恢复副本

批量保存会先读取旧内容，准备并刷盘所有新文件和旧版回滚副本，然后逐文件替换。新文件与回滚文件共用批次编号，回滚副本形如：

```text
boss-cookies.json.<批次编号>.rollback.tmp
boss-local-storage.json.<批次编号>.rollback.tmp
```

普通提交错误发生后，已经替换的文件通过预先准备的副本恢复，不需要再申请空间写一份旧内容，避免磁盘刚好写满时无法回滚。发现目标内容已经被其他写入者改变时，不主动覆盖检测到的新内容。回滚仍失败时，保留可用副本并明确报错；正常成功和正常回滚后清理本批临时文件。

保证的是**逐文件完整性**及普通错误下的回滚，不是数据库式的跨文件、跨进程事务。独立进程同时更新同一文件时按最后一次完整提交生效，不自动合并字段。断电或 `SIGKILL` 发生在多文件替换之间时，可能留下新旧版本混合及临时文件；不会自动把这些临时文件当作配置，也不扫描删除其他写入者的文件。恢复时应先停止相关任务，再核对同批回滚副本与当前文件。

## 凭证和读取保护

- 浏览器捕获的 cookie 与 localStorage 都完成基本结构校验后才进入批量保存。空 cookie 捕获、缺少 localStorage 或非字符串存储值都会拒绝覆盖原有凭证；明确清除失效 cookie 的单文件业务入口仍可保存空数组。
- 登录助手增加 localStorage 捕获，只有同批文件保存完成后才发出 `cookie-collected`。写入失败不会通知“已登录”。
- 找岗位在登录钩子完成后读取 localStorage，避免重新登录后仍应用此前读取的旧状态。
- 读取损坏、结构不符或权限不足的配置/凭证时，保留原文件并报错，不再删除文件或重建默认值。只有确实缺失的文件才初始化。
- 数据目录记录损坏时拒绝猜测默认目录；排队快照损坏或缺失时停止。可选任务历史损坏时保留文件并暂停更新历史，修复后需重启守护进程。
- 文件读取的 JSON 解析错误不携带原始解析异常或内容片段，手动 Cookie IPC 的错误也不回显输入。退出草稿继续剥离尚未保存的 API 密钥。
- 配置/存储文件名限制在各自目录内，拒绝路径穿越和 Windows 保留设备名。

关键文件读写错误统一使用停止码 `98`，加入不自动重启列表。任务中途遇到此类错误时保存进度并关闭浏览器；后台启动和冻结快照加载错误也经过错误边界。CLI 的异步 cookie 钩子与运行流程接口保持一致。

周期性浏览器状态保存也会传播实际存储错误，找岗位与消息跟进任务不再忽略这类错误后继续重试。页面切换等临时捕获失败保留原文件并提示；安全验证结束后的凭证落盘错误同样走任务暂停处理。

配置位于运行目录的 `config/`，登录状态位于当前数据目录，数据目录记录位于运行目录的 `data-location.json`。SQLite 单库备份不包含这些 JSON、退出草稿或回滚副本；恢复配置或凭证需要对应文件或完整目录备份。回滚副本包含原始配置内容，按私有文件保存。

## 验证结果

本批新增 33 项回归用例。当前工作区共 **299 项不同用例**完成验证：普通 Node **284 项通过、15 项原生 SQLite 用例跳过**；项目 Electron 另行执行这 **15 项，全部通过**。总数包含工作区已有及同期修复。

覆盖：

- 磁盘写满、写入及刷盘失败、文件占用重试及上限、替换失败、独占创建冲突、不清理其他写入者的临时文件；
- 回滚不再申请内容空间、回滚失败保留私有副本、检测到新内容时不覆盖、同步与异步调用顺序、多进程初始化和并发完整写入；
- 子进程在替换前被强制杀死后，原目标仍可读取；
- 损坏配置/凭证保留、错误内容脱敏、空捕获保护、cookie/localStorage 成组校验、迁移不覆盖源文件；
- 真实设置 IPC 的回滚和同修订号重试、并发修订检查、退出草稿保留与密钥剥离、加密模型备份优先提交、登录成功通知等待落盘；
- 损坏任务历史不被后续任务覆盖、GUI/CLI 遇到存储错误停止、刷盘或重试跨越时限时不放行请求。

验收使用 Node `26.11.1`、Electron `39.2.7`（内置 Node `22.21.1`）。

```sh
node --test --test-isolation=none packages/geek-auto-start-chat-with-boss/tests/*.test.mjs packages/ui/tests/*.test.mjs packages/utils/tests/*.test.mjs packages/launch-bosszhipin-login-page-with-preload-extension/tests/*.test.mjs packages/pm/tests/*.test.cjs packages/sqlite-plugin/tests/*.test.cjs
ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --test packages/sqlite-plugin/tests/job-discovery.test.cjs packages/sqlite-plugin/tests/account-and-salary.test.cjs packages/ui/tests/favorites.test.mjs
npx --yes pnpm@8.15.9 --filter geekgeekrun-ui build
```

生产构建和 macOS arm64 解包构建通过。包内公共文件层、运行时入口及守护进程源码与当前源码逐字节一致，编译产物包含存储错误处理和回滚逻辑。使用实际打包后的 Electron 直接加载 `app.asar` 内模块，验证凭证批量失败回滚、损坏文件保留、配置往返和守护进程依赖完整；此前预算打包验收也再次通过。

```sh
ELECTRON_RUN_AS_NODE=1 GGR_QA_ARCHIVE="$PWD/packages/ui/dist/mac-arm64/GeekGeekRun.app/Contents/Resources/app.asar" ./packages/ui/dist/mac-arm64/GeekGeekRun.app/Contents/MacOS/GeekGeekRun packages/ui/scripts/smoke-json-persistence.cjs
```

[打包验收脚本](../packages/ui/scripts/smoke-json-persistence.cjs)仅写入临时目录。所有测试均使用示例凭证、隔离 IPC 或内存数据库，未读写用户实际凭证及数据库，未连接 BOSS、未发送消息、未发布版本。

该批结束时，全量 UI 类型检查仍有历史诊断：主进程 136 项、渲染器 327 项；与开工快照对照无新增或减少。后续[历史类型错误分批清理](type-errors-cleanup-2026-10-20.md)已将两项检查清零。Windows 文件占用通过故障注入验证，尚未做 Windows 真机或真实断电验收。
