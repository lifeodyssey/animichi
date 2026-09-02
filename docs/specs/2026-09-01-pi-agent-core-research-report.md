# pi agent core 调研报告 — TS 重写的 agent 内核候选(承接 #1106)

**Status: OPEN — 报告完成待 owner 决策(grilling 输入)**
前置调研:① `docs/specs/2026-08-17-agent-ts-research-report.md`(#1106,结论 conditional-go);② `docs/iterations/production-readiness-2026-08/PI-AGENT-CORE-RESEARCH.md`(2026-08-29,固定同一 pi 快照 0.84.4@853a80d,结论 **NO-GO 全量迁移 / GO 限有退出条件的 spike**)。本报告不推翻两者的结论;相对 ②,本轮新增三项实测证据(workerd 实跑、打包 bug、HEAD 复核),并把 ② 的五项硬条件整合进 §七的 spike 清单。
任务语境:agent loop 从 Python 容器迁到 Workers(Queues consumer 和/或 Durable Object),Neon 为 source of truth(messages/runs/usage),durable queue + outbox,SSE fanout,模型 = OpenAI-compatible 网关 `https://opencode.ai/zen/go/v1` + `mimo-v2.5`。

本报告所有 package 名/版本/仓库元数据均为 2026-09-01 当场核验(v0.84.4,clone 至 /tmp 源码级检查 + wrangler 实测);标注"未复核"的除外。

---

## 一、一页结论

**建议:conditional-go on pi(与 2026-08-29 内部报告的 "NO-GO 全量迁移 / GO 限 spike" 对齐:本报告的 go 对象是"pi 作为重写的 agent 内核层进入 spike 门",不是全量迁移 go)。** 把 `@earendil-works/pi-agent-core` + `@earendil-works/pi-ai` 作为 TS 重写的 agent 内核层候选。三条最硬的理由:

1. **Workers 兼容是实测的,不是推断的。** 本轮在 workerd 里跑通了一个完整 agent turn:自定义 provider(`opencode.ai/zen/go/v1` + `mimo-v2.5`,openai-completions)+ typebox 工具 + 完整事件序列(`agent_start → turn_start → message_* → turn_end → agent_end`),wrangler 4.127.1 打包 1090 KiB / gzip 192 KiB,**开着和关着 `nodejs_compat` 都能跑**(§四)。这直接消解 #1106 的运行时前提疑问,也把 55s 容器冷启动(PR #1239)的根源整个移除。
2. **pi 恰好补上 #1106 评分表里 TS 侧最弱的三格——但其中两格只是"原语已备",不是"开箱即用"。** 阈值触发的 LLM 摘要 compaction(harness 内建,含 durable CompactionEntry——#1106 Scope 4 判"两家框架均无"的项,pi 有原语);会话持久化接口化(`SessionStorage` + 一致性测试套件,SQLite 实现为参考实现);工具错误回喂是默认语义(throw → `isError` tool result 回喂,含参数校验失败)。**边界必须说清**(2026-08-29 内部报告 [F] 实测、本轮在 HEAD b8b873b 复核):durable `AgentHarness` 编排器仍是脚手架——`prompt/compact/resume/steer/create.restore` 均抛 `HarnessNotImplemented`(agent-harness.ts:351-356 等)。即 §3.3 的 lane/operation/恢复原语是**库级可用、编排级未实现**;在我们的 Workers 编排里,turn 的 durable 推进本来就由我们自己的 queue/DO 状态机负责,pi 只需提供"单 turn 内的 loop + 可持久化的会话数据",这个边界恰好落在 pi 现已实现的部分(§七决策点 4)。
3. **单维护者风险已实质解除。** pi 于 2026-04-08 被 Armin Ronacher 的公司 Earendil 收购,Mario Zechner 全职投入;repo 迁至 `earendil-works/pi`,100k+ stars、277 contributors、近 3 个月 1,455 commits、Armin Ronacher 本人在 commit log 里。旧 npm 名 `@mariozechner/*` 已 deprecated 并改名 `@earendil-works/*`(§二)。

**但有两个新的、本轮新发现的风险要认账:** ① 0.x 破坏性变更节奏约每 2-4 周一次(§二.4),harness v4 session 层是 0.84.0(2026-08-06)才重写的,年轻;② 本轮实测复现了一个上游未知的 **esbuild 打包运行时 bug**(直接 import `.lazy` 子路径 → 运行时 "ModelsImpl is not a constructor"),pi 自己的 CI smoke 只 build 不执行所以没发现;有 workaround(§四.3),go 前需 file upstream issue 并钉死。

**一句话:** 对"Workers 原生 + Neon 可插拔存储 + zod 契约 + openai-compatible 网关"这套需求,pi 是目前唯一一个把 loop、会话存储接口、compaction、多 provider 网关兼容做成一个 MIT 内核、且实测能在 workerd 跑的候选;成本大头仍在 #1106 已识别的 eval 体系与编排重排,pi 不改变那两项的量级。

---

## 二、项目身份与维护度

### 2.1 身份

- **Repo**:`github.com/badlogic/pi-mono` → 现为 **`github.com/earendil-works/pi`**(GitHub 自动重定向;API 返回 `full_name: earendil-works/pi`)。MIT License(Copyright (c) 2025 Mario Zechner)。
- **元数据(2026-09-01 gh api 实测)**:stars 100,375,forks 12,469,open issues 166,created 2025-08-09,pushed 2026-09-01(当日)。
- **收购**:2026-04-08,Earendil(Armin Ronacher 的公司)收购 pi,Zechner 加入全职建设([Ronacher 博文 "Mario and Earendil"](https://lucumr.pocoo.org/2026/4/8/mario-and-earendil/);[HN "I've sold out"](https://news.ycombinator.com/item?id=47687533))。Earendil 内部产品 OpenClaw 使用 pi 框架([Ronacher "Pi: The Minimal Agent Within OpenClaw"](https://lucumr.pocoo.org/2026/1/31/pi/))。项目官网 [pi.dev](https://pi.dev),RFC 流程在 [rfc.earendil.com](https://rfc.earendil.com/keyword/pi/)。

### 2.2 npm 包名与版本(2026-09-01 实测)

| 包 | 版本 | 说明 |
|---|---|---|
| `@earendil-works/pi-agent-core` | 0.84.4 | Agent loop + state(我们要的内核) |
| `@earendil-works/pi-ai` | 0.84.4 | 统一多 provider LLM API(~60 内建 provider) |
| `@earendil-works/pi-telemetry` | 0.84.4 | vendor-neutral telemetry 契约 + typed schemas |
| `@earendil-works/pi-session-backend-sqlite-node` | 0.84.4 | 会话存储 SQLite 参考实现(`node:sqlite`) |
| `@earendil-works/pi-coding-agent` / `pi-tui` | 0.84.4 | CLI / TUI(与我们无关) |

旧名 `@mariozechner/pi-agent-core` 停在 0.73.1,npm deprecate 消息指向新名。monorepo 内另有 workspace 包 `pi-protocol` / `pi-client` / `pi-server`(CLI 的 RPC 层,不在我们的依赖面上)。

### 2.3 维护活跃度

- contributors:277(gh api 分页实测);近 3 个月 commits:1,455(search API,committer-date ≥ 2026-06-01);近 52 周:5,401。
- release 节奏:数天到两周一个(v0.84.4 发布于 2026-08-28;8 月发了 5 个版本)。commit log 里 Zechner、Ronacher、David Brailovsky、Ramiz Wachtler 等多人并行合并外部 PR。
- 供应链纪律:直接外部依赖钉 exact version,monorepo 自带 `check:pinned-deps` 等脚本(README "Supply-chain hardening")。

### 2.4 破坏性变更节奏(单维护者风险之外的第二风险)

`packages/agent/CHANGELOG.md` 实测:0.32(2026-01)→ 0.84.4(2026-08-28)之间 **10 个 minor 版本带 "Breaking Changes" 段**(0.65.0 / 0.69.0 / 0.75.0 / 0.77.0 / 0.80.0 / 0.81.0 / 0.82.0 / 0.84.0 / 0.84.4 等),平均 2-4 周一次。**0.84.0 整个换掉了 session 层**(v4 lane-based `Session`/`SessionStorage` 取代 legacy JSONL/in-memory repo API)。破坏性变更都有文档化迁移说明;核心 `Agent`/`agentLoop` API 比 harness 内部稳定得多(近期破坏性变更集中在 harness/session 与 hook 时序)。**含义:必须钉 exact version,并把"跟进升级"当作每周例行成本预算,而不是一次性成本。**

---

## 三、API 面(源码级核验,v0.84.4)

### 3.1 Agent loop

- 两个层次:**`Agent` 类**(stateful,`prompt()`/`continue()`/`steer()`/`followUp()`/`abort()`/`waitForIdle()`,`subscribe()` 订阅事件)与 **低层 `agentLoop()`/`agentLoopContinue()`**(async-iterable,事件是观察性的)。源码 `packages/agent/src/agent.ts`(592 行)/ `agent-loop.ts`(803 行)。
- **事件形状**(`types.ts` `AgentEvent`):`agent_start|turn_start|turn_end|message_start|message_update|message_end|tool_execution_start|tool_execution_update|tool_execution_end|agent_end`。**全部载荷是纯 JSON**(AgentMessage、字符串、tool result),无类实例、无循环引用 → 直接 `JSON.stringify` 上 SSE/NDJSON,不需要序列化适配层。`EventStream` 是手写 async-iterable(无 Node EventEmitter)。
- 工具执行 parallel/sequential 可配(全局 + 每工具);`beforeToolCall`(可 block,带 `terminate: true`)/`afterToolCall`(可改写结果)钩子;`shouldStopAfterTurn`(turn 之间决定停止——compaction/收尾的挂点);**steering/followUp 队列**(turn 边界注入用户插话/追加任务——注意这是进程内队列,见 §七 决策点 2)。
- 消息流:`AgentMessage[] → transformContext()(裁剪/注入)→ convertToLlm()(过滤 UI-only 消息)→ LLM`。自定义消息类型用 declaration merging 扩展。

### 3.2 工具与校验回喂(pydantic-ai ModelRetry 的对位)

- 工具定义 `AgentTool`:`parameters` 是 **typebox** schema(不是 zod),`execute(toolCallId, params, signal, onUpdate)` 可流式进度。
- **执行错误回喂:throw 即回喂**。README 明文:"Thrown errors are caught by the agent and reported to the LLM as tool errors with `isError: true`" —— 与 pydantic-ai `ModelRetry` 的工具层语义对齐,且是默认行为。
- **参数校验失败同样走 error tool result**:`agent-loop.ts:625` `validateToolArguments()` 失败/`beforeToolCall` block → `createErrorToolResult` → 回喂模型(#1106 Scope 1 的"工具输入校验回喂 4/5 需自接线"在 pi 是默认)。
- 结构化采样:`constrainedSampling: { type: 'json_schema', strict: 'prefer'|'require' }`(OpenAI/Anthropic/Mistral/Gemini 3 等,含 OpenAI grammar tools)。对 mimo 这类 openai-compatible 端点,回退普通 function tools(`compat.supportsStrictMode` 控制)。
- **最终输出校验回喂:没有 `Output.object()` 等价物;官方文档化模式 = "submit final result" 工具 + `terminate: true`**(harness.md:1322 原文点名这个模式用于"in place of structured output")。把 pydantic-ai `output_validator` 的业务校验移进该工具的 `execute`(throw → error result → 模型自纠 → 通过后 `terminate`)即可重建同等闭环。**对我们是零回归**:#1106 Scope 3 已实测 /v1/chat 从不走渐进 typed output,`agent.run()` 整体跑完后才产帧。

### 3.3 会话/状态持久化(Neon 可插拔性的关键)

- `Agent` 类本身是内存态;持久化在 **harness session 层**,接口是 **`SessionStorage`**(`harness/session/types.ts:290`):append-only **entry tree**(message / compaction / branch_summary / model_change / custom entry)+ **lanes**(命名游标,天然支持并行子任务)+ **usage ledger**(append-only cost 行)+ **operation 记录**(`findOpenOperations()` + limit:2 恢复查询——为崩溃恢复/幂等设计的原语,和我们的 turn_reservation/turn_outbox 思路同构)。
- 参考实现:`JsonlSessionRepo`(核心包)+ `@earendil-works/pi-session-backend-sqlite-node`(独立包,含 migrations/materialized views/FTS)。**有一致性测试套件**(`harness/session/testing/conformance.ts`)供第三方后端自证——Neon/Postgres 实现的验收标准是现成的。
- 备选路线:不用 harness session 层,仅用核心 `Agent` + 自己把 `AgentMessage[]` 落 Neon(订阅事件写库)。 §七决策点 4 讨论取舍。
- **durable harness 现状(重要边界)**:`AgentHarness` 的操作方法(`prompt/compact/resume/abort/steer/runToCompletion`)与 `create(..., { restore })` 在 HEAD(b8b873b,2026-09-01 复核;2026-08-29 内部报告在 853a80d 快照首次实测)仍抛 `HarnessNotImplemented`——0.84.0 changelog 自己的措辞是 "compile-complete scaffold"。session 数据结构(`Session`/`SessionStorage`/repo)与 compaction 函数是真实实现;**缺的是自动驱动它们的 durable 编排**。

### 3.4 Context 管理 / compaction(#1106 Scope 4 缺口的收窄)

- Agent 级:`transformContext(messages, signal)` 钩子(等价 pydantic-ai 的 context 变换自由度)。
- **harness 内建阈值触发 compaction**:`compaction.ts:247` `shouldCompact(contextTokens, contextWindow, settings)` = `contextTokens > contextWindow - reserveTokens`;触发后 LLM 摘要 + `retainedTail` 保留尾部,生成 durable `CompactionEntry`(含 tokensBefore/usage)。这不是 AI SDK cookbook 那种 ~50 行纯截断,是摘要式 + 持久化的。**残差**:摘要风格是 coding-agent 向(文件操作追踪);animichi 的三层实体挽留(fact_ledger/compaction_retention)仍需自建适配,M 级。

### 3.5 Provider 层(pi-ai)与我们的网关

- 统一 API:`stream`/`streamSimple`/`complete`/`completeSimple`,~60 个内建 provider(OpenAI/Anthropic/Google/Azure/Bedrock/Mistral/OpenRouter/**Cloudflare AI Gateway/Workers AI**/…,目录 `packages/ai/src/providers/`)。核心入口不 import 任何 provider/SDK;按 provider 选择性 import(bundling 友好,自带 browser smoke 检查)。
- **`createProvider()` = 我们的网关接入点**:自定义 `baseUrl` + 模型清单 + auth + api 实现。文档首例就是 Ollama 类 OpenAI-compatible 端点。**repo 里甚至有内建 `opencode` / `opencode-go` provider**(OpenCode Zen 即 opencode.ai 的网关),且 "OpenCode" 在 `compat` 自动探测名单里;我们的自定义 baseUrl + `mimo-v2.5` 走 `createProvider` 定义 custom Model(提供 contextWindow/maxTokens/cost,usage 计费由此算出)。
- **OpenAI 兼容开关阵**(`OpenAICompletionsCompat`,README "OpenAI Compatibility Settings"):`supportsDeveloperRole` / `supportsReasoningEffort` / `supportsStore` / `supportsUsageInStreaming` / `supportsStrictMode` / `maxTokensField('max_completion_tokens'|'max_tokens')` / `thinkingFormat`(openai|openrouter|deepseek|qwen|…11 种)/ `requiresToolResultName` / cache_control 等。对 mimo 这类非 OpenAI 血统模型,这些开关是把"供应商方言"配置化而不是 fork 请求层——这正是我们 BYOK 层要的东西。
- BYOK:`getApiKey: async (provider) => …`(Agent 选项,动态换 key)、per-call `apiKey` override、`envApiKeyAuth`、模型级 `headers`。三家族 + custom provider 覆盖 SD-11 面。
- 重试:provider HTTP 层内建(`provider-retry.ts`:指数退避 + jitter、`retry-after`/`retry-after-ms`、`x-should-retry`、server-requested delay 上限 60s);agent 层 `continue()` 供错误后续跑。**注意这是网络层重试,不是校验回喂**——校验回喂走 §3.2 的工具语义。
- 会话亲和/缓存:`agent.sessionId` 驱动 `prompt_cache_key`/session-affinity 头(`sendSessionAffinityHeaders`/`sessionAffinityFormat`)——对 zen 网关的 prompt cache 有用。

### 3.6 Eval

`@earendil-works/pi-evals`(0.84.4,workspace 包)是基于 [getsentry/vitest-evals](https://github.com/getsentry/vitest-evals) 的**coding-agent 端到端行为评估**(spawn 真 AgentSession + 临时目录 + 会话 JSONL 附件),不是 SD-30 那类 trajectory/statistical 评估器库。**不改变 #1106 §九对 eval 缺口的分级**:ToolCorrectness/MaxToolCalls 用 agentevals/Mastra 原语、TrajectoryMatch 渐进 F1 + MaxModelRequests 仍从零、bootstrap 统计闸机械迁移。pi-evals 唯一可借鉴的是 harness 挂 vitest 的组织方式。

---

## 四、Cloudflare Workers 兼容性 — **实测结论:兼容**

### 4.1 证据(本轮完成,可复现)

探测工程:/tmp/pi-worker-test(`@earendil-works/pi-agent-core@0.84.4` + `pi-ai@0.84.4` + `openai@6.40.0`)。**这填补了 2026-08-29 内部报告"五痛点表"第一行(workerd 兼容 = unknown)要求的最小验证的一半**:其验收清单是"隔离 spike Worker + dry-run 审 metafile + 真实 workerd 执行 text stream/tool call/abort/cold-warm";本轮完成 dry-run + workerd 执行 text stream(openai-completions 单 provider、mock streamFn 驱动真实 loop),**仍未做**:三 provider matrix、deployed Worker(非 wrangler dev)、真实网关往返、abort/断线、cold/warm 对比。

1. **构建**:wrangler 4.127.1 `deploy --dry-run` 通过 → 1,090 KiB / gzip 192 KiB(单文件,无 bindings)。
2. **运行时**:wrangler dev(workerd)内 `fetch()` handler 完成:custom provider 注册(`opencode.ai/zen/go/v1` + `mimo-v2.5`)→ `getModel` → `new Agent`(typebox 工具)→ mock streamFn 驱动 **完整 turn** → 返回事件序列 `["agent_start","turn_start","message_start","message_end","message_start","message_update"×3,"message_end","turn_end","agent_end"]` + 助手文本。
3. **`nodejs_compat` 关闭也能跑**(compatibility_date 2026-08-01,无 flag)。

### 4.2 依赖审计(为何干净)

- `pi-agent-core` 运行时依赖:`diff`/`ignore`/`typebox`/`yaml`/`pi-ai`/`pi-telemetry` —— 全纯 JS。核心 loop(`agent.ts`/`agent-loop.ts`/`types.ts`)**零 `node:` import**;仅 `harness/env/nodejs.ts`(fs/spawn/readline——文件与 bash 工具的 Node ExecutionEnv)和 session conformance 测试文件引用 node:。
- `pi-ai` 的 node: 引用收敛在:CLI、OAuth 登录流(bundler-opaque 懒加载)、Bedrock(bundler-opaque,README 明示 Node-only)、`pi-user-agent.ts`(type-only import + 运行时 `process` 探测,browser-safe)。openai@6.40.0 / @anthropic-ai/sdk 均为 fetch-based。
- uuid 用 `globalThis.crypto.getRandomValues`;`EventStream` 为纯 async-iterable;加解密/随机无 Node 依赖。

### 4.3 新发现的坑(本轮实测复现,上游未知)

**直接在打包入口 import `@earendil-works/pi-ai/api/<id>.lazy` 子路径会触发 esbuild chunk-init 顺序 bug**:运行时报 `TypeError: ModelsImpl is not a constructor`(esbuild 把 `models.js` 编为懒 `__esm` chunk,但入口作用域漏插 `init_models()` 调用)。在 standalone esbuild 0.28.2 与 wrangler 4.127.1(内嵌 esbuild)下**均复现**;Node 直跑 npm 包(dist)正常——纯打包产物问题。**pi 自己的 `check:browser-smoke` 只 build 不执行**(`scripts/check-browser-smoke.mjs`),所以 CI 抓不到。Workaround(已实测):① import 非懒子路径 `@earendil-works/pi-ai/api/openai-completions`(eager 加载 SDK,Worker 里 1MB 包无所谓);② 或走 provider 工厂模块 `providers/<id>`(pi 自己 smoke entry 的形态,实测可执行)。go 前 file upstream issue,并把"bundler 产物必须 smoke 执行"写进我们 CI。

### 4.4 有没有人已在 Workers/Queues/DO 上跑 pi?

未找到公开案例(repo 内 "cloudflare workers" 相关 issue 均为 AI Gateway/Workers-AI provider 适配,如 #7838/#7901 AI Gateway binding transport、#7219 修 workers bundler warning)。**我们是 early adopter**;缓解:§4.1 的探测已证明核心面可行,且 pi 的 core 是 runtime-neutral 设计(browser 官方支持)。

---

## 五、迁移成本清单(apps/agent/src 实测行数 → pi 映射)

基线:#1106 Scope 8 实测(生产 179 文件 / 23,563 行;测试 356 文件 / 47,967 行 / 1,815 test;6 模型工具)。下表只列与 pi 选型**有交互**的面;S/M/L 为粗量级。

| 面 | Python 现状(实测) | pi 映射 | 量级 |
|---|---|---|---|
| 模型工具(4 catalog + 2 web) | `agents/catalog_tools.py`+`catalog_route_tools.py`+`catalog_adapter.py`+`web_tools.py`+`translation.py` 等(agents/ 目录 5,998 行,含 handler/容错/导出等支撑) | 逻辑 1:1 移植为 `AgentTool`(typebox 参数);loop/重试/并行由 pi 覆盖;`handlers/`、`catalog_failures.py`、`route_area_splitter.py` 等支撑层照搬 | **L**(体量在支撑层,不在工具壳) |
| Agent 构造/输出校验 | `animichi_agent.py` 480 行(`build_animichi_agent` + `output_validator` + `retries=2`) | 构造 → pi `new Agent`;typed output 校验 → "submit_result" 工具 + 校验 throw + `terminate`(§3.2);`retries` 语义拆成网络重试(pi 内建)+ 业务重试(工具回喂) | **M** |
| 模型 turn seam | `application/model_turn_port.py` 73 + `agent_turn.py` 628 | 大部分被 `Agent`/`agentLoop` 取代;turn 结算接线保留 | **S–M**(净删除为主) |
| Turn 生命周期 | `turn_admission.py` 302 + `turn_outcome.py` 149 + `turn_admission_port`/`turn_types`/`admission_limits`(application/ 共 3,187 行) | 与 pi 零重叠,原样移植(Workers 侧落在 queue consumer/DO);pi harness 的 operation/恢复原语(§3.3)可作语义参照 | **M** |
| Quota/usage | `anon_quota.py` 36 + `usage_metering.py` 139 + `fact_ledger.py` | pi 每条 AssistantMessage 带 `usage`(tokens+cost,cost 由 Model.cost 配置算);metering 落 Neon 的接线自写 | **S** |
| BYOK provider | `byok_models.py`+`byok_probe.py` | `createProvider` + compat 开关阵 + `getApiKey`(§3.5);三家族原语齐全 | **S–M** |
| Egress/SSRF 守卫 | `egress_guard.py` 253 + `egress_transport.py` 245(+errors) | Workers 路径:workerd 默认 `Network.allow=["public"]`(见 #1106 §九 + 待做 Spike D),应用层只需 own-infra 拒绝表/响应上限;**若终选 Node 容器则回到 #1106 的 3-5x 估算** | **S–M**(Workers,待 Spike D 钉死) |
| Compaction/memory | `history_compaction.py` 237 + `compaction_retention.py` + `memory.py` + `fact_ledger.py` | pi harness compaction 提供阈值+摘要+durable entry;我们的实体挽留/fact ledger 语义自建适配;memory 无 pi 对应,自建 | **M** |
| Streaming 帧 | `chat_stream_frames.py` 311 + `tool_event_bridge.py` 280 + `chat_stream` | `AgentEvent`(纯 JSON)→ 现有 SD-9 data-parts 帧的桥;契约 `packages/contract` zod 不动;预期净简化(同 #1106 Scope 3) | **S–M** |
| FastAPI 服务面 | `fastapi_service.py` 299 + interfaces/ 3,470 行 | 整层退役 → edge 转发 + queue consumer/DO 入口;Neon Auth 信任链不变 | **S**(删除为主) |
| Eval 体系 | `tests/eval` 4,691 行 + 662-case 数据集 + 18 专项测试文件 | 与框架无关:#1106 §九分级照抄;pi-evals 不替代(§3.6) | **L** |
| **总量级** | 生产 23,563 行 | 工具/支撑层为体量大头;loop/session/compaction 骨架由 pi 供给;数周~两三个月区间与 #1106 §四一致,pi 使区间**略降但不变量级** | — |

---

## 六、替代方案对照(只对我们的需求:Workers 原生、durable-queue 友好、zod、可插拔存储)

**Vercel AI SDK v6/v7(ToolLoopAgent)**:#1106 的基线。生态最宽、`createUIMessageStream` 原生覆盖帧协议;但按 #1106 Scope 1/3/4:输出校验回喂仍需自建 65-100 行、无阈值触发 compaction、无会话存储层(消息持久化全自管)——这三样 pi 都有现成的。有趣的交叉验证:AI SDK 7 的 harness 适配层官方点名 Pi([Harness Adapters](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-adapters)),两个生态在互相承认。若重写主目标是"浏览器流协议原生"而非"agent 内核完整性",AI SDK 才反超;我们的架构里帧协议是自己的 zod 契约,这一优势用不上。

**Cloudflare agents-sdk**:它是**运行时层不是 loop 层**(模型编排建在 AI SDK 上)。DO `Agent` 类给我们的差异化:每 session 一个 actor(单写者语义 = 天然的 turn 租约)、WebSocket hibernation + 可恢复流(v0.2.24 起,[changelog](https://developers.cloudflare.com/changelog/post/2025-11-26-agents-resumable-streaming/))承担 SSE/WS fanout、`schedule()`/alarm 承担超时与租约续期、DO storage 承担中间态。**与 pi 是组合关系不是竞争关系**:DO 壳 + 壳内跑 pi `Agent`。#1106 Scope 6 的"裸 Workers 更省(不计网络等待)"对"等 LLM"负载仍然成立——DO 只该挂长连接 fanout/租约,不该承担整个多轮 loop 的 wall-clock(或者接受 DO 计费换语义简单,见 §七决策点 2)。

**Mastra**:AI SDK 之上的全栈框架,有 storage 抽象与 evals scorers(对 Scope 2 略有益);但带自己的 runtime/部署意见(Mastra Cloud/deployer 优先),framework 锁更深,compaction 仍无阈值触发版本。对"只要内核、编排自持"的我们,比 pi 重、比 pi 多锁。

**结论:没有 materially better 的选项。** pi 是唯一把 §3.1–3.5 五件事(loop/存储接口/compaction/网关方言/回喂语义)做成一个 Workers 实测可跑的 MIT 内核的候选;其余方案都要求我们在 #1106 已计价的缺口上重新花钱。

---

## 七、建议与 open decision points(供 grilling)

**建议**:采用 pi-agent-core + pi-ai 作为 agent 内核层,叠加在我们已定架构上(edge 鉴权路由 → intake queue → DO 或 consumer 跑 pi loop → Neon(messages/runs/usage + SessionStorage 后端)→ outbox → SSE fanout)。**与 2026-08-29 内部报告的门槛关系**:该报告规定 pi/workerd 只有在"五痛点全部从 unknown/adapter-needed 变 supported 且重新评分严格高于 39/60 基线"后才有 GO 评审资格——本报告的 workerd 实测把第一行推到"单 provider、非 deployed 下 partially supported",其余四行(DO durable resume、SSE 取消、DO alarm 幂等、BYOK 守卫)状态不变。因此最终 GO 仍以其五项硬条件为准;本报告建议的 spike 清单与之一一对应:

- **S1(workerd 补全)**:三 provider matrix + deployed Worker + 真实网关往返 + abort/断线(`enable_request_signal` 旗标开/关对照)+ cold/warm——把 2026-08-29 报告的第一行验收做完。
- **S2(mimo-v2.5 网关方言)**:custom Model + compat 探测——tool calling 往返、`reasoning_effort`/`store`/`strict`/`maxTokensField`/streaming usage 各开关对 zen 网关实测;pi 的 `opencode` provider 自动探测为起点。
- **S3(打包 bug)**:file upstream issue;我们 CI 加"bundler 产物 smoke 执行"门(§4.3 workaround 先行)。
- **S4(DO durable 语义)**:按内部报告第 2 行的方法——先 DO SQLite/Neon 实现仅 spike 用的 `SessionRepo` 过 pi conformance;再做并发同 session、eviction/restart、provider/tool 中途故障,证明进行中 turn 能恢复。**同时持续观察上游 `AgentHarness` 完成度**(我们的编排若自建,要与上游落地后的形态不冲突)。
- **S5(SSE 取消与 alarm)**:`enable_request_signal` 下断线三处断言(provider stream/tool/末帧前);DO alarm 单槽任务表 + 幂等键强杀验证(内部报告第 3/4 行方法)。
- **S6(egress)**:承继 #1106 Spike D(workerd SSRF 边界实测,内部报告第 5 行已从 workerd pinned 源码核到 standalone 默认 `['public']`,Hosted Workers 等价性仍 [U]),叠加 BYOK key 防回退与日志脱敏验证。
- **S7(eval 双跑)**:按 #1106 §七双跑策略,pi 不改变其设计。

**决策点:**

1. **Queue:CF Queues vs pg-boss-on-Neon。** CF Queues:at-least-once、零运维、与 DO alarm 组合顺;但多轮 turn 要逐跳 re-enqueue,turn 状态重建逻辑要写对。pg-boss-on-Neon:queue/outbox/状态同库同事务(与我们"Neon 是 source of truth + outbox 模式"最自洽),代价是 Workers 侧要常驻 poller(Queues/DO alarm 驱动)与连接管理(Neon HTTP driver 或 hyperdrive)。若 DO 路线胜出,Queues 只做 intake 的混合形态也很自然。
2. **Worker vs DO 承载 loop。** 裸 Worker:计费最优(CPU 不计 LLM 等待)、但 pi 的 steering/followUp 队列与 `waitForIdle` 是进程内语义,turn 中途插话要靠外部队列模拟。DO:单写者租约 + steering 直用 + hibernation WS fanout + `schedule()` 超时,语义最贴;代价是 DO 按 wall-clock GB-s 计费(含 LLM 等待)。**pi 的进程内队列语义使 DO 明显更贴;建议 DO 承载单 turn、Queues/Neon 承载跨 turn  durable。**
3. **模型网关绑定度。** mimo-v2.5 不在 pi 生成的模型目录里(已核实,`mimo` 在 provider data 中无条目)——`createProvider` 自定义 Model 是正路,但 compat 开关需 S2 实测定版;同时 BYOK 用户自带 Anthropic/Gemini key 的路径由 pi 内建 provider 免费覆盖(评估这是否仍是 SD-11 范围)。
4. **用 pi 的哪一层:core Agent only vs harness(AgentHarness + Session/SessionStorage)。** durable `AgentHarness` 在 HEAD 仍是脚手架(§3.3 边界)——**当下唯一可落地路径就是 core Agent + 我们自己的 Neon 持久化/编排**;`SessionStorage` 接口 + conformance 套件作为我们持久化 schema 的对齐目标保留(上游 harness 落地后可平移),而不是当下的依赖。这也回答了内部报告的 DO 阻断项:进行中 turn 的恢复由我们的 DO/queue 状态机负责,不押注在上游未实现的 harness 上。
5. **typebox vs zod 边界。** `packages/contract` 保持 zod(Workers 侧共用);工具参数用 typebox(pi 原生,JSON Schema 同源),或引入 zod→JSON Schema 桥。二选一要在 Wave 1 前定,避免双 schema 漂移。
6. **版本策略。** 钉 exact version + 每周期跟进 CHANGELOG("Breaking Changes" 段)的例行成本,写进 ops 日历(§2.4)。

---

## 八、Sources(2026-09-01 当场核验)

**项目/仓库**:github.com/earendil-works/pi(gh api:stars/forks/created/pushed;contributors/search/commits/releases API)· github.com/badlogic/pi-mono(重定向)· [lucumr.pocoo.org/2026/4/8/mario-and-earendil/](https://lucumr.pocoo.org/2026/4/8/mario-and-earendil/) · [lucumr.pocoo.org/2026/1/31/pi/](https://lucumr.pocoo.org/2026/1/31/pi/) · [news.ycombinator.com/item?id=47687533](https://news.ycombinator.com/item?id=47687533) · [pi.dev](https://pi.dev) · [newsletter.pragmaticengineer.com/p/building-pi-and-what-makes-self-modifying](https://newsletter.pragmaticengineer.com/p/building-pi-and-what-makes-self-modifying) · [mariozechner.at/posts/2025-11-30-pi-coding-agent/](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)

**npm**:npmjs.com/package/@earendil-works/{pi-agent-core,pi-ai,pi-telemetry,pi-session-backend-sqlite-node}(version/deps/engines 实测)· @mariozechner/pi-agent-core(deprecated 实测)

**源码(本地 clone,v0.84.4)**:packages/agent/{README.md,docs/harness.md,src/{agent.ts,agent-loop.ts,types.ts}} · packages/agent/src/harness/{session/{types.ts,session.ts},compaction/compaction.ts,agent-harness.ts,env/nodejs.ts} · packages/ai/{README.md,src/{models.ts,utils/{event-stream.ts,provider-retry.ts,uuid.ts,pi-user-agent.ts},api/openai-completions.ts,providers/{opencode.ts,opencode-go.ts}}} · scripts/check-browser-smoke.mjs · CHANGELOG.md(breaking 段实测)

**Workers 实测**:wrangler 4.127.1(`deploy --dry-run` + `dev`,/tmp/pi-worker-test,含与不含 nodejs_compat 两轮)· esbuild 0.28.2(chunk-init bug 复现与 workaround)

**Cloudflare(替代方案段)**:[developers.cloudflare.com/agents/](https://developers.cloudflare.com/agents/) · [/agents/runtime/lifecycle/agent-class/](https://developers.cloudflare.com/agents/runtime/lifecycle/agent-class/) · [changelog/post/2025-11-26-agents-resumable-streaming/](https://developers.cloudflare.com/changelog/post/2025-11-26-agents-resumable-streaming/) · [github.com/cloudflare/agents](https://github.com/cloudflare/agents)

**repo 内前置**:`docs/specs/2026-08-17-agent-ts-research-report.md`(#1106)· `docs/specs/2026-08-17-agent-ts-research-spec.md` · `docs/iterations/production-readiness-2026-08/PI-AGENT-CORE-RESEARCH.md`(2026-08-29,同一 0.84.4 快照的 60 分制评分与五痛点表;本报告与其结论对齐并补三项实测)· `docs/iterations/production-readiness-2026-08/BYO-AGENT-HOSTING-RESEARCH.md` · `apps/agent/src/animichi/*`(行数实测)· PR #1239(55s 冷启动,任务语境)

---

*报告作者:调研席。pi 侧所有断言基于 v0.84.4 源码与实测;项目处于高速迭代期,数字与 API 面以核验日为准,go 时需按 §七 Spike 清单重钉。未复核项:pi-evals 仅读了 README 与 package.json(未跑);`pi-protocol/client/server` 未深查;277 contributors 含少量机器人/一次性贡献者,核心 maintainer 团队以 commit log 可见 5-8 人为准。*
