# 类型检查与回归测试 CI 门禁

日期：2026-10-20。延续[历史类型错误清理](type-errors-cleanup-2026-10-20.md)，把主进程、渲染器类型检查和现有回归接入同一套可复用检查，并阻止检查失败后的发布。

## 触发与检查

[CI 入口](../.github/workflows/ci.yml)在 PR 创建及提交更新、`master` / `main` 推送、合并队列和手动运行时触发，调用[公共质量检查](../.github/workflows/quality-checks.yml)。

| 任务 | 环境 | 检查 |
| --- | --- | --- |
| Types, regression and build | Ubuntu 22.04、Node.js 24 | SQLite 编译、主进程类型、渲染器类型、完整回归、生产构建 |
| Electron native SQLite | macOS 15、项目锁定的 Electron | 按 Electron ABI 准备依赖、SQLite 编译、原生数据库及收藏/备份回归 |
| Quality gate | 等待上述两项 | 两项都成功才通过；失败、取消或跳过均不能满足门禁 |

完整回归自动发现 `packages/*/tests` 中的测试，并纳入发布辅助脚本及 CI 自身的回归。配置保存、损坏文件保留、批量回滚、任务记录失败、守护进程队列、任务结束和恢复等已有用例均在其中；新增测试文件不需要维护命令行通配符。

公共安装步骤使用 Node.js 24、pnpm `8.15.9` 和 `--frozen-lockfile --ignore-scripts`。随后分别准备 Node 或 Electron 需要的原生依赖，避免安装阶段的桌面应用钩子把 Node 回归的 SQLite ABI 改成 Electron。缓存 pnpm store，不缓存 `node_modules`；每个原生运行环境都重新准备并检查依赖。

SQLite 编译会清空并重建 `dist`，因此类型检查和依赖编译产物的测试按顺序执行。完整回归使用 Node 24 提供的测试隔离选项；Electron 内置 Node 22 的原生测试使用进程隔离、逐文件执行。相关接口见 [Node CLI 文档](https://nodejs.org/api/cli.html#--test-isolationmode)和 [Electron 原生模块文档](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)。

## 不允许原生测试静默跳过

[统一运行器](../scripts/ci/run-tests.mjs)在 CI 和 Electron 模式开始前，先实际打开内存 SQLite 并查询；Electron 模式还校验二进制版本与安装包版本一致。加载失败直接让任务失败。

测试同时输出控制台结果和 JUnit 报告。CI / Electron 模式拒绝含跳过用例的报告，测试进程失败、报告缺失、报告为空或报告含失败也不能通过。缺少 SQLite 原生测试集时明确失败。

报告位于 `.ci-reports/regression.xml` 和 `.ci-reports/electron-native.xml`，测试步骤失败后仍尝试上传已有报告，保留 14 天。自动升版前检查与 tag 发布前检查使用不同产物前缀，避免同一次发布中产物重名。

## 发布依赖

- [自动发布](../.github/workflows/auto-release.yml)先检查推送对应的提交，通过后才准备版本、提交和 tag。准备阶段检出已检查的 SHA；不能改用检查期间向前移动的 `master`。
- [UI 发布](../.github/workflows/release-ui.yml)检查实际要发布的 tag，通过后 Windows、macOS 和 Linux 打包任务才能开始。因此手动推送 tag 也需要通过检查。
- PR 检查仅使用 `contents: read`，不需要业务密钥，不使用 `pull_request_target`，检出时不保留写入凭据。新增加的远程 Actions 固定到完整提交 SHA。
- 并发取消只在普通 CI 入口配置，可复用工作流不设置取消组，避免嵌套发布调用取消自身的父流程。

如需 GitHub 在合并按钮处强制执行检查，应在仓库规则或分支保护中把首次运行产生的 **Quality gate** 检查设为必需检查。本批没有修改仓库服务端规则；代码中的发布依赖已明确要求检查成功。

## 本地命令

使用 Node.js 24 和 pnpm 8.15.9，在仓库根目录运行：

```sh
pnpm build:sqlite
pnpm typecheck
pnpm test
```

`pnpm test`允许开发环境因 SQLite ABI 不同跳过原生用例；完整 CI 使用更严格的命令：

```sh
pnpm rebuild esbuild
pnpm --filter @geekgeekrun/sqlite-plugin rebuild better-sqlite3
pnpm build:sqlite
pnpm typecheck
pnpm test:ci
pnpm --filter geekgeekrun-ui build
```

Electron 原生回归使用：

```sh
pnpm rebuild esbuild
pnpm --filter geekgeekrun-ui rebuild electron
pnpm --filter geekgeekrun-ui exec electron-builder install-app-deps
pnpm build:sqlite
pnpm test:electron
```

Node 和 Electron 的依赖准备会切换原生模块 ABI；CI 使用不同任务环境，本地复现也宜使用独立的工作目录。测试运行器把应用运行目录设为临时目录，不读取或写入实际登录态，不连接 BOSS 或发送消息。

## 验证结果与范围

本地使用独立源码目录和全新 `node_modules`，通过冻结锁文件安装，实际复现了流水线命令：

- Node `24.22.0`：主进程与渲染器类型检查通过，**333 项回归全部通过、零跳过**，生产构建通过；工作区同期新加入的测试也已被自动发现并验证。
- Electron `39.2.7`、内置 Node `22.21.1`：**21 项原生回归全部通过、零跳过**；这些是对完整回归中原生路径的重复验证。
- 实际把 Electron ABI 的 SQLite 留给 Node 检查时，预检返回非零状态；恢复正确 ABI 后，完整回归重新通过。
- 新增 **8 项 CI 回归**，覆盖测试发现、空/失败/跳过报告、子测试失败传播、ABI 预检、关键链路纳入检查、构建顺序和发布依赖。
- `actionlint 1.7.12` 对新入口、公共检查及两个发布工作流校验通过；冻结锁文件与新增测试依赖一致。
- 原工作目录的 Electron 原生模块仍可加载；验证中的 ABI 切换均在独立目录完成。

以上是 macOS arm64 上的本地复现和工作流静态校验，未声称 GitHub 托管 Linux 任务已执行。本批未提交或推送工作区、未触发线上 CI、未发布版本；工作流随代码提交后触发，首次托管运行仍需核对结果。
