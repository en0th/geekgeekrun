# 0.18.1 源码交付与后续开发入口

本次提交对应已交付的 Windows 0.18.1 界面与必填校验修复，供继续开发使用。新的爬虫功能尚未实现。

## 主要入口

| 范围 | 源码位置 |
| --- | --- |
| 页面及交互 | `packages/ui/src/renderer/src/page/Ux/` |
| 自动打招呼核心 | `packages/geek-auto-start-chat-with-boss/index.mjs` |
| 岗位导航与详情一致性检查 | `packages/geek-auto-start-chat-with-boss/auto-chat-navigation.mjs` |
| 岗位安全边界 | `packages/geek-auto-start-chat-with-boss/job-safety.mjs` |
| Electron 自动打招呼任务入口 | `packages/ui/src/main/flow/GEEK_AUTO_START_CHAT_WITH_BOSS_MAIN/index.ts` |
| 消息跟进任务 | `packages/ui/src/main/flow/READ_NO_REPLY_AUTO_REMINDER_MAIN/` |
| 配置读写、备份和任务准备 | `packages/ui/src/main/features/ux-config.ts` |
| 输入校验 | `packages/ui/src/common/ux-validation.mjs` |
| 两模型配置及备用策略 | `packages/ui/src/common/model-config.mjs` |
| 数据保存与冷却 | `packages/sqlite-plugin/src/` |
| 后台任务管理 | `packages/pm/daemon.js` |

新增采集功能时，建议先明确采集对象、字段、保存位置、停止条件及是否需要账号登录。采集与实际发送消息应分开，不能因为采集成功就自动启动投递；保留现有筛选、停止边界和用户启动确认。

## 开发与构建

这是 pnpm 工作区。使用根目录 `package.json` 指定的包管理器和 Node 环境，先在根目录安装依赖，再在 `packages/ui` 运行开发或构建脚本。

```sh
pnpm install
cd packages/ui
pnpm run dev
# 构建
pnpm run build
# Windows 安装包
pnpm run build:win
```

Electron、浏览器及 SQLite 相关依赖可能需要下载或本地编译。首次安装失败时先检查项目环境和网络，不要直接删除用户运行目录。

## 验证边界

已有 Windows 开发环境构建通过；原型、源码运行版及打包程序各完成 12 项交互检查。测试使用独立配置目录并阻断真实任务发送，没有验证真实 BOSS 平台的全部页面、账号状态或新爬虫场景，也没有在全新电脑重新安装依赖和构建。

API 密钥、登录数据、个人配置、运行数据库、依赖缓存和安装包不属于本源码 PR。
