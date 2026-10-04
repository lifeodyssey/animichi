# pi 1.0 这一批包能替代什么（2026-10-04）

状态：调研记录，不是决定。2026-10-04 owner 问："跟着 pi 1.0 发布的东西，有啥能取代我们手写的吗，或者比我们
现在用的组件更适合。"两路调研：一路读 npm 上的包（解开 tarball）和上游文档，一路盘点本仓库手写的 agent
运行时；§7 是主会话复核。owner 当天的决定记在 `docs/agents/owner-decisions.md`。

记法：本仓库文件写 `路径:行`，版本是 a26c4c7cc；npm 包写 `包名@版本 路径:行`，路径相对于解开的 tarball；
上游 earendil-works/pi 写 `pi@main 路径`，取 2026-10-04 的 main。日期按 Asia/Shanghai（UTC+8）。

## 1. 这一批是什么

- pi 系列包锁步发版：09-29 到 10-04 之间发了 0.99.0–0.99.2 和 1.0.0–1.0.2，都是 MIT。
- pi-agent-core 1.0.0 删掉了 harness。changelog 原话："Removed the experimental harness from
  `@earendil-works/pi-agent-core`: `AgentHarness`, sessions and session storage, the durable runtime, pico3,
  harness tools, compaction, skills, prompt templates, system prompt helpers, telemetry schemas …"，并且
  "The `./node`, `./harness/*`, and `./experimental/pico3` subpath exports are gone"（`pi@main
  packages/agent/CHANGELOG.md` 的 1.0.0 条目）。1.0.2 的 `package.json` 只导出 `.` 和 `./package.json`；
  所有 d.ts 里声明的名字从 0.87.1 的 852 个降到 43 个。
- 0.87.1 到 0.99.2：pi-agent-core 只有新增（`onProviderStreamEvent`；每条 assistant 消息记下 `thinkingLevel`）。
  pi-ai 在这一段唯一的 breaking change 是 0.99.0 的图像模型，原话 "existing chat models, providers, and stores
  keep working unchanged"（`pi@main packages/ai/CHANGELOG.md` 的 0.99.0 条目）。0.99.2 是最后一个导出
  `./harness/*` 的版本。
- 对我们的影响：四个包里 import pi-agent-core 的 `.ts` 文件有 186 个，其中 185 个用到了 1.0.2 已经没有的名字，
  用得最多的是 `BACKGROUND_CONTEXT`、`Context`、`Session`、`Entry`、`MemorySessionRepo`、`AgentHarness`、
  `AgentLane`。

## 2. 每个包

| 包 | 做什么 | Workers 上的障碍（按 import 静态分析，没有实跑） | 成熟度 | 出处 |
|---|---|---|---|---|
| pi-durable | 耐久的对话、任务、文档运行时：`Harness.open`、`MemoryStorage`、`defineTool`、`watchEvents` | 根、`/storage/sqlite`、`/storage/jsonl`、`/testing` 不 import `node:*`；`/storage/sqlite/node`、`/env/node`、`/storage/jsonl/node` 只能跑 Node。README 把 Cloudflare Durable Objects 列为可移植核心的运行环境，前提是提供一个异步的 `SqliteDatabase` 门面 | "Experimental. The API changes without notice between releases."；npm 上 09-19 以 0.0.1 首次出现，到 10-04 共十一个版本，0.86.0 起跟 pi 系列一起发版；changelog 把 1.0.0 记为 "Initial release"；1.0.2 的依赖是 chord ^1.0.2、pi-ai ^1.0.2、diff 8.0.4、typebox 1.3.27（传递依赖的 import 没有扫） | `pi-durable@1.0.2 README.md:3,529`；`CHANGELOG.md:15`；`package.json` 的 dependencies；`dist/storage/sqlite/node.js:1-3`；`dist/env/node.js:1-7`；`npm view @earendil-works/pi-durable time` |
| pi-telemetry | telemetry 契约：`TelemetryContext`、`TelemetrySpan`、`NOOP_TELEMETRY_CONTEXT`、`InMemoryTelemetryContext`；没有导出器，OTel 是要自己写的适配器 | 根没有外部依赖 | 没有 Experimental 标签 | `pi-telemetry@1.0.2 README.md:11,13`；`dist/index.d.ts:18-25` |
| pi-ai | 统一的 LLM API；内置 `opencodeGoProvider()`、`xiaomiProvider()`、`fauxProvider()`；`Usage` 有缓存读写；`AssistantMessage` 有 `provider`、`model` | `./models` 和 faux 没有外部依赖；opencode-go 和 xiaomi 只在 Bun 分支里碰 `node:fs`；OAuth、CLI、Bedrock 只能跑 Node | 发过 55 个版本 | `pi-ai@1.0.2 dist/providers/opencode-go.js:8-20`；`dist/providers/xiaomi.js:5-14`；`dist/utils/provider-env.js:13,19`；`dist/types.d.ts:291-312,378` |
| pi-agent-core 1.0 | 只剩简单的 `Agent`、`agentLoop`、`streamProxy`、`AgentTool`，没有存储 | 根只依赖 pi-ai | — | `pi-agent-core@1.0.2 dist/` |
| pi-protocol、pi-client、pi-server | 远程 pi session：4 字节长度加一个 CBOR 项的帧，双工 RPC；server 只带 Unix socket 传输；对端鉴权留给应用，包里没有实现 | server 用 `node:crypto` 和 Unix socket，实际只能跑 Node | 都标 experimental | `pi-server@1.0.2 dist/session-router.js:1`；`dist/transports/unix/listener.js:1-4`；`README.md:61` |
| pi-mcp | MCP 客户端（stdio、Streamable HTTP）；"servers, sampling, and tasks are outside the initial core" | `StreamableHttpTransport` 面向 Workers，但根入口同时导出 `StdioTransport`（child_process），要靠打包时的 tree-shaking 去掉（未验证） | 09-29 的新包 | `pi-mcp@1.0.2 README.md:132`；`dist/index.js:5`；`dist/transports/stdio.js:1-3` |
| pi-codemode | 模型写 JS，在 QuickJS/WASM 沙箱里只调注入的工具 | 用 `worker_threads` 和从字节编译 WASM，只能跑 Node | 09-29 的新包 | `pi-codemode@1.0.2 dist/runtime/host.js:1,111`；`dist/wasm.js:1-2` |
| chord | 组合运行时、状态复制；pi-durable 的依赖 | 根没有 import；`/node`、`/bundler` 只能跑 Node | — | `chord@1.0.2 dist/node/bundle-loader.js:1-7` |
| pi-session-backend-sqlite-node 0.99.2 | 老 harness 的 `node:sqlite` 后端 | 只能跑 Node | 依赖 pi-agent-core ^0.99.2，跟着老 harness 停在 0.99 | `pi-session-backend-sqlite-node@0.99.2 dist/index.js:1-2` |
| pi-web-ui 0.75.3 | Lit 写的浏览器聊天组件 | 浏览器 | 停在 0.75.3 | `pi-web-ui@0.75.3 package.json` |

## 3. 我们手写的 agent 运行时

| 领域 | 我们的代码 | 性质 |
|---|---|---|
| Neon session 存储 | `NeonStorage implements Storage`、`NeonSessionRepo implements SessionRepo`（`packages/pi-session-neon/src/storage.ts:16`、`repo.ts:12`），手写约 455 行，另有迁移和 pi 的一致性测试套件。历史、重连流、结算不经 harness，直接读这份存储 | 按 0.87.1 的接口实现的通用机制 |
| admission 与耐久 run | `SessionAgent extends Agent`（Cloudflare agents SDK，`workers/edge/src/agent/host/session-agent.ts:40`）；`agent_admissions`、`agent_settlements`；202/409 映射；重连流 | 业务层 |
| 幂等 | `x-turn-id` 进 `client_message_id`；摘要；409 `turn_in_flight`（`workers/edge/src/agent/admission/request-intent.ts:7-17`） | 业务层 |
| turn 预算 | 100 秒，挂在 `before_request` hook 上（`session-agent.ts:269`），从 pi 记下的 `startedAt` 起算 | 业务层 |
| usage 与结算 | 读 pi 的 usage 行，结算进我们的日用量表 | 业务层 |
| 事件到线上格式 | pi 事件转成 AI SDK 的 UI 消息流；历史投影只返回 `respond` 的工具结果（`workers/edge/src/agent/views/history.ts:76`） | 业务层 |
| 模型 | edge 只 import `xiaomiProvider`（`workers/edge/src/agent/host/native-models.ts:3`）；eval 用 pi-ai 的 opencode-go | 薄胶水 |
| telemetry | 没挂 `TelemetryContext`，pi 走 `NOOP_TELEMETRY_CONTEXT`（`pi-agent-core@0.87.1 dist/harness/context.js:5-8`） | 没有 |
| 测试替身 | 大量测试用 pi-ai 的 `fauxProvider`；另有手写的 provider 替身，因为 faux 不覆盖中断帧、流式 usage 和 4xx | 测试 |

## 4. 逐项对照

### 4.1 现成的、不依赖迁移的部分

- pi-ai 从 0.87.1 起就带 `opencodeGoProvider()`，eval 已经在用；edge 今天构造 provider 用的是 `xiaomiProvider()`。
- pi-agent-core 0.87.1 的 `withTelemetryContext` 收的就是 pi-telemetry 的 `TelemetryContext`
  （`pi-agent-core@0.87.1 dist/harness/context.d.ts:3,8`），1.0 的 pi-ai 也收它；pi-telemetry 自带
  `InMemoryTelemetryContext`。pi 自己几乎不发 span：0.87.1 只发 `pi.harness.hook` 一种；pi-ai 1.0.2 转发
  `telemetryContext`，自己不开 span；pi-durable 没有 telemetry 代码；pi 的 span 名是 `pi.ai.*`、`pi.harness.*`、
  `pi.session.*`，没有 `gen_ai.*`。
- 0.87.1 到 0.99.2 的 changelog 里，没有涉及我们用到的 API 的 breaking change（§1）。
- 这几样怎么用，决定在别处：默认 provider 是 #1974，span 的出口在 platform spec，升 0.99.2 是 #1995。

### 4.2 pi-durable 对照我们手写的部分

| 我们的 | pi-durable 有什么 | 出处 |
|---|---|---|
| Neon 存储 | 自己的 `Storage` 接口（一次原子提交、按键查、游标扫描，共 16 个方法）和一致性测试套件 `registerStorageConformance`；后端只有 memory、jsonl、sqlite，没有 Postgres；SQLite 的建表语句用 `STRICT`、`json_valid`、`INSERT OR IGNORE`，Postgres 用不了；"One process owns a storage at a time; there is no cross-process locking." | `pi-durable@1.0.2 dist/types.d.ts:787-835`；`dist/testing/index.d.ts:2`；`package.json` 的 exports；`README.md:529` |
| `x-turn-id` 幂等 | `SubmissionDraft.requestId`：同一会话里已知的 id 返回原来的 submission；类型不同就抛错；内容不比较。同键不同内容答 409 的语义没有对应物 | `dist/harness/types.d.ts:15-17`；`dist/harness/submissions.js:110-130` |
| 会话忙时拒绝 | `whenBusy: "reject"` 抛 `ConversationBusy`，接近我们的 blocked 409 | `dist/harness/submissions.js:110-130` |
| 100 秒预算 | 没有 turn 级或 run 级期限，宿主自己调 `conversation.abort()` | `pi@main packages/durable/docs/spec.md` 的宿主超时一节 |
| run 状态读 | `Submission.status()`：queued、placed、done、unanswered | `dist/harness/types.d.ts:35-40` |
| 断线重连 | `watchEvents` 返回快照加实时事件，标 experimental；晚加入或重连的客户端从当前视图开始，不重放 | `dist/harness/events.d.ts:153-164`；`README.md:287,353` |
| usage | `harness.usage()` 按 `provider/model` 和按工具汇总，失败和中断的尝试也算；我们的结算只给完成的 turn 记账，其余退款，口径不同 | `dist/harness/usage.d.ts:5-10`；`README.md:515` |
| 崩溃恢复 | 重开存储后运行中的任务回到 pending，宿主调 `resume()`；模型请求重发，工具按 `replay: "safe"` 决定是否重跑 | `dist/harness/types.d.ts:473-478` |

结论：pi-durable 接替的是 pi 0.87.1 的 harness 今天替我们做的部分（lane 生命周期、持久见证、usage 行、
watch 快照）。我们手写的业务层（admission 与 409 幂等、配额与结算、turn 预算、AI SDK 流的投影、egress 限制）
在哪个版本都还是我们的。

### 4.3 不适合

- pi-server、pi-client、pi-protocol：CBOR 双工 RPC，只有 Unix socket 传输，对端鉴权要自己做。我们是 HTTP 加 SSE。
- pi-mcp：只有 MCP 客户端；我们以后要的是 MCP 服务端。
- pi-codemode：要 `worker_threads` 和从字节编译 WASM，Workers 上跑不了。
- pi-web-ui（停在 0.75.3）和 sqlite-node 后端（只能跑 Node，配的是老 harness）：用不上。
- pi-agent-core 1.0：只剩简单的 Agent，没有存储，撑不住耐久的 turn。

## 5. 迁移要回答的问题

1. Workers 兼容：`AbortSignal.any`（`pi-durable@1.0.2 dist/harness/scheduler.js:1072`）在 edge 的 compatibility
   date 上是否可用；TypeBox 的 `Compile()` 会探测 `new Function` 再回退；进程内定时器遇到 Durable Object 被逐出时
   怎么办。
2. 存储放哪：给 Neon 按 pi-durable 的 `Storage` 写一个后端；或者用 Durable Object 自带的 SQLite，写一个异步
   `SqliteDatabase` 门面。后一条会把记录从 Neon 挪进 Durable Object。
3. 业务层能不能这样接：admission 和 409 放在 `submit` 前面？预算由宿主 abort？结算接 `usage()`（口径见 §4.2）？
   AI SDK 流从 `watchEvents` 来？选择 turn（不经模型）走同一套幂等？
4. eval 的进程内任务能不能换成 pi-durable 的 `MemoryStorage` 加 `fauxProvider`？
5. pi-durable 依赖 pi-ai ^1.0.2，harness 依赖 pi-ai 0.99：两份 pi-ai 能不能在一个包里共存？不能的话，迁移没法
   分包合进 main。
6. 历史、重连流和结算今天不经 harness 直接读 Neon 里的 pi 记录，eval 的进程内任务用 harness 的内存 repo；记录的
   形状变了以后，这几处怎么改。

## 6. 未能核实

- pi-durable 在 workerd 里跑一轮：没跑过。"能跑在 Workers"只是没找到不支持的 import。
- Durable Object 的 SQLite 能否满足 `SqliteDatabase` 门面的事务语义：没试。
- pi-ai 0.99.2 的模型目录：只确认了 1.0.2 删掉的四个 OpenCode Go 模型我们没有引用。
- `fauxProvider` 在 1.0 是否补上了中断帧、流式 usage 和 4xx：没查。

## 7. 主会话复核（2026-10-04）

- 三条否定结论换关键词重搜：pi-durable 的 d.ts 里 `maxDuration|budget|expiresAt|deadline|wallClock|timeLimit`
  零命中；pi-durable 的 dist 里 `TelemetryContext|startSpan|pi-telemetry|opentelemetry` 零命中；pi-ai 1.0.2 的
  dist 里 `.startSpan(`、`startAiSpan(` 零命中。
- 读了 `admitSubmission`（`dist/harness/submissions.js:110-130`）、SQLite 门面（`dist/storage/sqlite/database.d.ts`，
  全异步，事务期间适配器要排队其他操作）、`README.md:287,515,529`。
- pi-durable 不是 1.0.0 才有：npm 上 09-19 以 0.0.1 首次出现，到 10-04 共十一个版本（`npm view @earendil-works/pi-durable
  versions`、`time`），调研 agent 依据 changelog 写的"1.0.0 是首个版本"已改。
- 逐个打开了 §2 表里 pi 各包的出处行；一处出处原先写错（对端鉴权那句在 `pi-server@1.0.2 README.md:61`，不在 pi-client），已改。
- 抽查了本仓库的引用：`session-agent.ts:40,269`、`native-models.ts:3`、`history.ts:76`、`storage.ts:16`、
  `repo.ts:12`。pi-session-neon 的 455 行不含生成的 `contract.d.ts`。
- 185/186 的算法：取 0.87.1 和 1.0.2 全部 d.ts 的导出名求差集，再逐个文件解析从 pi-agent-core import 的名字。

## 源表

- npm（registry.npmjs.org 的 tarball）：`@earendil-works/` 下的 pi-durable、pi-telemetry、pi-ai、pi-agent-core、
  pi-protocol、pi-client、pi-server、pi-mcp、pi-codemode、chord，都是 1.0.2；pi-session-backend-sqlite-node
  0.99.2；pi-web-ui 0.75.3；对照用的 pi-agent-core 0.87.1。
- 上游：https://github.com/earendil-works/pi/blob/main/packages/agent/CHANGELOG.md 、
  https://github.com/earendil-works/pi/blob/main/packages/ai/CHANGELOG.md 、
  https://github.com/earendil-works/pi/blob/main/packages/durable/docs/spec.md
