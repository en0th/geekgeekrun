# scraper 借鉴能力：第一批实现

日期：2026-10-20。当前工作分支为 `codex/upstream-p1-fixes`。在开工时已有的账号隔离、必需条件、登录分类和薪资修复基础上，本批补充运行中响应守卫及平台职位类目筛选，并保留同工作区的全国城市、组合预算改动。

## 运行中响应守卫

- 监听当前 Page 的搜索列表、推荐列表和岗位详情响应，每一页都检查状态。
- code 31/37、明确验证提示和 HTTP 403/429 会暂停后续操作；明确认证失效单独处理。正常空结果保持正常轮换。
- 无法解析、详情缺少身份字段及读取超时会停止处理并保留凭证。响应体读取最多等待 15 秒。
- 检查点覆盖切源、加载下一批、详情读取、发送及发送确认。等待中的切源操作可以被限制响应打断。
- 已收到的响应体全部检查完才允许进入下一动作；新增测试覆盖读取过程中又到达受限响应的情况。
- 切源先订阅响应，再执行操作；失败或超时会取消等待。监视器随浏览器关闭解除监听并取消读取。
- GUI 和 CLI 都以已有的停止码退出，保留进度，不进入自动重试循环。

主要代码：

- [响应监视器](../packages/geek-auto-start-chat-with-boss/boss-job-responses.mjs)
- [导航及检查点](../packages/geek-auto-start-chat-with-boss/auto-chat-navigation.mjs)
- [运行流程](../packages/geek-auto-start-chat-with-boss/index.mjs)

## 平台职位类目筛选

「找岗位 → 职位筛选与来源 → BOSS搜索条件」新增类目选择器，可搜索和多选具体职位。数据包含 21 个大类、118 个二级类目和 848 个叶子职位，快照时间为 2026-10-19。

每组搜索配置保存以下字段：

```json
{
  "type": "search-kw",
  "enabled": true,
  "keyword": "",
  "positionCodes": ["100101", "100109"]
}
```

- 选了类目后关键词可以留空，不引入隐含默认关键词；关键词与类目可以同时使用。
- 同关键词配不同类目保留为不同来源；编码排序、去重后参与身份比较。
- 来源配置贯通工作区保存、模板导入导出及排队快照；新增类目参与恢复位置指纹。未使用类目时，来源条目维持原有三元组格式。
- 进入或清除类目筛选时导航正常搜索页，普通关键词搜索保留原输入交互方式；没有新增注入 XHR。
- 通过页面发出的请求核对 query/position，兼容 URL、表单 POST 和 JSON POST。缺少类目、查询不匹配或迟到的其他查询响应会暂停任务。
- 类目仍属于平台搜索条件，本地关键词、城市、薪资和投递前必需条件继续独立执行。

主要代码：[来源、请求匹配及码表](../packages/geek-auto-start-chat-with-boss/search-source.mjs)、[界面配置](../packages/ui/src/renderer/src/page/Ux/search-settings.js)。码表来自 scraper PR #99 的 `3bd1e519fad04477490bc177bb728f6fadb2a901`，保留原始 JSON、来源元数据和 MIT 文本；Electron 包额外携带 `third-party/position-codes.NOTICE`。

## 验证结果

本批新增 30 项测试。当前工作区共 217 项不同测试通过：普通 Node 运行 210 项通过、7 项原生测试跳过；项目 Electron 另行完成这 7 项，全部通过。

```sh
node --test --test-isolation=none packages/geek-auto-start-chat-with-boss/tests/*.test.mjs packages/ui/tests/*.test.mjs packages/utils/tests/*.test.mjs packages/launch-bosszhipin-login-page-with-preload-extension/tests/*.test.mjs packages/pm/tests/*.test.cjs packages/sqlite-plugin/tests/*.test.cjs
ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --test packages/sqlite-plugin/tests/account-and-salary.test.cjs packages/ui/tests/favorites.test.mjs
npx --yes pnpm@8.15.9 --filter geekgeekrun-ui build
```

生产主进程、预加载和渲染器构建通过。macOS arm64 解包构建通过，并检查了实际 `app.asar`：主进程与渲染器包含类目数据，响应守卫代码存在，MIT 许可文件随包交付；打包后的 Electron 能加载包内 better-sqlite3 并执行内存数据库查询。本地包未签名，未发布版本。

界面验证使用生产渲染器与隔离 IPC，保存端调用实际配置合并和校验函数，验证了：只选 Python 且关键词为空、同时选择 Java/Python、删除类目后保存普通关键词，以及确认页的条件展示。没有执行确认后的实际任务。浏览器控制台未发现脚本错误。实测发现并修复了轮询重渲染时 Cascader 配置对象身份变化导致的菜单重建问题，并补充稳定身份断言。

![多个职位类目的开始确认，本地隔离预览](../wiki/assets/ux-platform-position-2026-10-20.jpg)

全量类型检查仍存在历史诊断；与开工源码快照对照，未出现本批引入的新错误位置。遗留表单类型的展开文本会随同工作区组合预算字段变化，不把这种文本变化视作新的类型问题。构建成功不代表历史类型问题已清零。

## 验收边界与后续

本次未使用真实 BOSS 账号，未发送消息，未验收真实站点当前的 position 参数行为或 Windows 浏览器。当前检查证明客户端参数贯通、失败处理及本地交付内容；真实网页支持情况仍需现场验收。无法确认筛选生效时会暂停。

首次发现台账及 JD/技能摘要见[第二批实现](scraper-discovery-summary-implementation-2026-10-20.md)，实际请求/详情/累计时间预算与恢复记账见[第三批实现](scraper-run-budget-implementation-2026-10-20.md)，剩余配置与凭证 JSON 写入加固见[第四批实现](runtime-json-hardening-2026-10-20.md)。现有组合预算统计的是筛选组合数量。上游 PR #99 的 Python 打包与跨轮基准问题保留在审查报告中，本批采用原生实现及资源交付检查。
