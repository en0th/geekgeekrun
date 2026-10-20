# 主进程与渲染器历史类型错误分批清理

日期：2026-10-20。延续[运行时 JSON 写入加固](runtime-json-hardening-2026-10-20.md)，优先处理配置保存和任务执行，再清理关联的旧窗口、组件及数据库类型。保留工作区已有和同期改动。

## 结果

| 检查 | 开工基线 | 本批结束 |
| --- | ---: | ---: |
| 主进程 `typecheck:node` | 136 | 0 |
| 渲染器 `typecheck:web` | 327 | 0 |
| 合计 | 463 | 0 |

标准 `pnpm --filter geekgeekrun-ui typecheck` 已成功退出，不再需要把历史类型错误作为构建前提。保留原有严格检查、未使用变量检查、文件覆盖范围和 `skipLibCheck` 设置；本批未新增 `any` 或类型检查忽略指令。

## 第一批：配置保存和任务执行边界

- 浏览器配置、Cookie 助手、公共条件、协议和下载窗口声明实际的可选参数及 Promise 结果。异步关闭回调持有本次创建的窗口，不再通过可能已改变或变为 `null` 的全局变量关闭窗口。
- 数据库 Worker 声明响应类型；创建运行记录时校验数据库错误和正整数 ID。失败时向上传播错误，阻止启动没有有效记录的任务；检查收藏状态等无需运行记录的任务保持原有行为。
- 守护进程连接和请求声明 Socket、回调、超时及泛型响应。请求返回包含清理的 Promise，避免单独调用 `finally()` 产生调用者无法捕获的拒绝；缺少通信地址时明确失败。
- 使用有类型的 `deferred<T>()` 替代当前 TypeScript 5.3.3 尚无声明的 `Promise.withResolvers()`，继续保持原来的成功、取消和保存失败处理。
- 修正定时器、文件描述符流、后台窗口事件、错误消息和错误码的类型。为登录助手补齐与现有 `module` 一致的 `main` 入口；Worker 查询模块声明对应实际的构建插件接口。

相关代码：[守护进程连接](../packages/ui/src/main/flow/OPEN_SETTING_WINDOW/connect-to-daemon.ts)、[数据库 Worker 请求](../packages/ui/src/main/flow/OPEN_SETTING_WINDOW/utils/db/index.ts)、[窗口配置](../packages/ui/src/main/features/config-with-browser-assistant.ts)、[deferred](../packages/ui/src/common/utils/deferred.ts)。

## 第二批：配置表单和运行状态

- 为公共条件、找岗位表单、组合筛选、来源和搜索词声明字段及可空值，消除空对象、空数组和 `null` 推断带来的错误。
- 任务列表、启动步骤和运行浮层共享状态类型；运行记录、组件实例和 DOM 滚动容器使用明确的可空引用。
- 城市选择将单选字符串和多选数组分开，取消操作不修改已保存设置；清空单选仍返回 `null`，多选仍返回数组。多选收到字符串时不再拆成单个汉字。城市分组不再产生 `null` 键。
- 保留表单校验的默认触发方式，声明滑块标记和公共字段复制类型；处理历史日期、消息图片联合类型、模型密钥状态和旧窗口中的未使用变量。
- 手动 Cookie 校验接收未知输入并先检查结构，JSON 语法错误不回显可能包含凭证的解析片段。

相关代码：[配置类型](../packages/ui/src/common/types/job-config.ts)、[任务类型](../packages/ui/src/common/types/task.ts)、[找岗位表单](../packages/ui/src/renderer/src/page/MainLayout/GeekAutoStartChatWithBoss/index.vue)、[城市选择](../packages/ui/src/renderer/src/page/MainLayout/GeekAutoStartChatWithBoss/components/CityChooser.vue)。

## 第三批：浏览器与 SQLite

- 浏览器页面的 Vue 内部字段使用限定于目标组件的 `BossVueElement<T>`，不向全局 DOM 类型添加任意字段。保留浏览器表达式和回调的可执行 JavaScript，并明确页面数据和元素句柄的边界。
- 跟进会话时检查实际取得的列表元素类型。清理类型时同时修正两处图片宽高读取：尺寸来自 `originImage.width/height`，此前误从 URL 字符串读取。
- 为 TypeORM 回填的实体属性声明确定赋值；UI 检查使用与 SQLite 包一致的旧式装饰器模式，不关闭属性初始化检查。
- 将含 `null` 的来源枚举改为常量及其值类型，保留自动来源 `null`、手动来源 `1`。这会改变装饰器的自动类型推断，因此对聊天和不合适记录的对应列明确声明 `integer`；真实内存库已验证元数据和两种值的保存、读取。本批没有为此新增数据库迁移。

相关代码：[浏览器边界](../packages/ui/src/main/flow/types/boss-page.ts)、[聊天来源](../packages/sqlite-plugin/src/entity/ChatStartupLog.ts)、[不合适记录来源](../packages/sqlite-plugin/src/entity/MarkAsNotSuitLog.ts)。

## 验证

本批新增 **8 项**行为回归：

- 守护进程请求拒绝、超时、迟到响应和后续正常请求；
- 数据库失败、缺失或非法运行 ID 阻止任务启动，正常 ID 及无需记录的任务保持兼容；
- 实际城市组件的单选、多选、取消、确认和清空；
- 实际浏览器表达式及类型擦除后的回调能编译执行，消息映射保留图片尺寸和发送方；
- 两张日志表的来源字段保持整数元数据，`null` 和 `1` 能往返保存。

当前工作区共 **316 项不同用例**验证通过：普通 Node **299 项通过、17 项原生用例跳过**；Electron 另行执行 **21 项全部通过**，覆盖这 17 项及 4 项重复验证。总数包含工作区已有及同期修复。

```sh
pnpm --filter geekgeekrun-ui typecheck
pnpm --filter geekgeekrun-ui build
node --test --test-isolation=none packages/geek-auto-start-chat-with-boss/tests/*.test.mjs packages/ui/tests/*.test.mjs packages/utils/tests/*.test.mjs packages/launch-bosszhipin-login-page-with-preload-extension/tests/*.test.mjs packages/pm/tests/*.test.cjs packages/sqlite-plugin/tests/*.test.cjs
ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --test packages/sqlite-plugin/tests/*.test.cjs packages/ui/tests/favorites.test.mjs
```

类型检查和依赖 `sqlite-plugin/dist` 的测试应在 SQLite 构建完成后执行；构建会先清空 `dist`，不应与这些检查并行运行。

生产构建、macOS arm64 解包构建通过。实际包内的 JSON 回滚、损坏文件保留、配置往返、守护进程依赖以及运行预算验收均通过；核对了两张日志实体的编译产物、登录入口元数据和任务失败处理确已进入包中。

本轮测试使用示例凭证、模拟通信、临时目录或内存数据库，没有连接 BOSS、发送消息或修改用户实际配置与数据库；没有发布版本。类型检查清零基于项目现有 TypeScript 覆盖范围，未把既有 JavaScript 模块改为全面启用 `checkJs`。

后续已加入[CI 质量门禁](ci-quality-gates-2026-10-20.md)，持续检查类型、完整回归和 Electron 原生路径，并要求发布前通过检查。
