# Pi Agent Core 对 Animichi 的适配性调研

> 日期：2026-08-29  
> 结论：**当前不迁移（NO-GO），只批准有退出条件的 spike。**  
> 固定快照：Pi `853a80d26c90a14c1886f0ebb8ffaae133ca2185`（包元数据 `@earendil-works/pi-agent-core@0.84.4`）；workerd `cb5785a04b9d4e4e762c2c881a8bf8948fdb7ba4`。未实现代码、未部署、未使用旧聊天作为证据。

## 1. 结论先行

- **[I] 不应以 Pi 替换当前 Python agent。** 同一套 9 维 60 分量尺下，当前 PydanticAI 仍为 **58/60**；既有“最强 TS 组合”为 **39/60**；Pi 的 Node 容器候选为 **33/60**，workerd/DO 候选因未经真实 bundle 与运行验证仅 **32/60**。旧 TS 列是逐行取最优的组合基线，并非一个连贯框架；Pi 列则只给 Pi 及必要宿主适配器已经有证据的能力记分。
- **[F] Pi 低层 core 的确有两项强原语：** 明确的 `transformContext -> convertToLlm` 管线，以及 agent/turn/message/tool 全生命周期事件；事件订阅者还是 awaited barrier（[README](https://github.com/earendil-works/pi/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/agent/README.md#L45-L174)）。**[I]** 它们适合投影为 Animichi trace/stage/step，但投影器与现有 UI wire contract 仍由本仓库负责。
- **[F] 决定性的反证：** 当前树导出的 durable `AgentHarness` 只是脚手架；`prompt/compact/resume/abort/steer/runToCompletion` 都抛 `HarnessNotImplemented`，`create()` 也不能恢复已有 operation（[source](https://github.com/earendil-works/pi/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/agent/src/harness/agent-harness.ts#L305-L420)）。不能把同仓的未来设计文档当成现成功能。
- **[I] Node 容器能避免 workerd 未知数，却不能兑现“退掉 agent 容器”的主要收益。** workerd/DO 才有结构性收益，但它同时卡在 provider bundle、DO durable resume、SSE 取消和 BYOK 守卫四个边界上。

标记规则：**[F]** 可由固定源码、官方文档或可复现仓库命令直接确认；**[I]** 从事实推到本仓库的工程判断；**[U]** 当前证据不能判定。评分本身全部是 **[I]**：满分表示当前 AC 已原生或在本仓生产验证；约半分表示只有原语、仍需适配与专项测试；`unknown` 不预支验证后的分数。

## 2. 沿用既有 60 分量尺

本表不换量尺：维度与权重逐项沿用 [2026-08-17 报告](../../specs/2026-08-17-agent-ts-research-report.md#二sd-4-式-60-分制评分表)，PydanticAI 58/60 和最强 TS 39/60 原样保留；只增加 Pi-specific 列并重新核验相关事实。

| # | 维度（权重） | 当前 PydanticAI | 最强 TS 组合 | Pi + Node 容器 | Pi + workerd/DO | Pi 事实证据 → 评分推断 |
|---|---|---:|---:|---:|---:|---|
| 1 | 工具执行错误回喂（5） | 5 | 5 | **5** | **5** | **[F]** thrown tool error 被转成 `isError` tool result，进入下一轮上下文（[loop](https://github.com/earendil-works/pi/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/agent/src/agent-loop.ts#L668-L705)）。**[I]** 原生闭环，满分。 |
| 2 | 工具输入校验回喂（5） | 5 | 4 | **5** | **5** | **[F]** 未知工具、TypeBox 参数校验错误和 preflight block 均变成错误结果，不中断 loop（[source](https://github.com/earendil-works/pi/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/agent/src/agent-loop.ts#L598-L665)）。**[I]** 比旧 AI SDK 组合少一层 repair 接线。 |
| 3 | 最终输出校验回喂（8） | 8 | 3 | **3** | **3** | **[F]** `AgentLoopConfig` 没有 terminal output schema/validator；`terminate` 只是“全批工具都 terminate 才停止”的 hint（[types](https://github.com/earendil-works/pi/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/agent/src/types.ts#L149-L223)、[semantics](https://github.com/earendil-works/pi/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/agent/README.md#L113-L144)）。**[I]** 需自建必调 `submit_result` 工具、语义错误回喂和 plain-text escape 防线；不等价于现有 [`output_validator` + `ModelRetry`](../../../apps/agent/src/animichi/agents/animichi_agent.py#L404-L438)。 |
| 4 | Streaming / typed output 渐进（6） | 6 | 5 | **4** | **4** | **[F]** Pi 原生发 message delta 与 tool progress（[events](https://github.com/earendil-works/pi/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/agent/src/types.ts#L422-L444)）；AI SDK 基线直接提供 `partialOutputStream` 与 `toUIMessageStream`（[official](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)）。**[I]** Pi 缺 typed partial validation 与现有 AI SDK UI frame encoder，各扣一分。 |
| 5 | Eval 生态对齐（10） | 10 | 5 | **3** | **3** | **[F]** Pi 有 scripted faux provider（[official README](https://github.com/earendil-works/pi/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/ai/README.md#L1212-L1295)）和 typed telemetry；固定树执行 `rg -n "Evaluator\|TrajectoryMatch\|ToolCorrectness" packages/{agent,ai}/src` 无 evaluator surface。Animichi 正在用五类 agentic evaluator（[四类](../../../apps/agent/src/animichi/tests/eval/official_evaluators.py)、[MaxModelRequests](../../../apps/agent/src/animichi/tests/eval/direct_gates.py)），对 [agent_eval_v3.json](../../../apps/agent/src/animichi/tests/eval/datasets/agent_eval_v3.json) 执行 `jq length` 本快照为 **662**。**[I]** 测试地基可用，评估算法与统计闸仍需迁移。 |
| 6 | Harness capabilities：compaction/memory/组合（8） | 8 | 3 | **3** | **3** | **[F]** 有显式 context transform、独立 compaction 函数、`SessionStorage/SessionRepo` 与 backend conformance kit（[exports](https://github.com/earendil-works/pi/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/agent/src/index.ts#L43-L108)、[storage contract](https://github.com/earendil-works/pi/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/agent/src/harness/session/types.ts#L290-L373)）；但组合后的 `AgentHarness` 未实现。**[I]** 只给可复用原语分；in-memory session 不是语义 memory。 |
| 7 | BYOK 多 provider（6） | 6 | 3 | **3** | **3** | **[F]** [OpenAI](https://github.com/earendil-works/pi/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/ai/src/providers/openai.ts#L6-L14)、[Anthropic](https://github.com/earendil-works/pi/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/ai/src/providers/anthropic.ts#L43-L58)、[Google](https://github.com/earendil-works/pi/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/ai/src/providers/google.ts#L6-L14) provider、per-request `apiKey`、model `baseUrl` 和 injected `fetch` 都存在（[request options](https://github.com/earendil-works/pi/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/ai/src/types.ts#L123-L177)）；Pi 明说不内建 network/credential permission system（[root README](https://github.com/earendil-works/pi/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/README.md#L36-L43)）。**[I]** provider 半边成立，现有 [BYOK policy](../../../apps/agent/src/animichi/agents/byok_models.py)、[connect-time egress guard](../../../apps/agent/src/animichi/infrastructure/egress_transport.py) 与 [观测脱敏](../../../apps/agent/src/animichi/interfaces/routes/_middleware.py) 半边全缺。 |
| 8 | 运行时/部署适配（6） | 4 | 6 | **3** | **2** | **[F]** 两个 Pi 包均声明 Node `>=22.19.0`，`pi-ai` 还直接依赖 AWS Node handler 与 proxy agents（[metadata](https://github.com/earendil-works/pi/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/ai/package.json#L62-L93)）；Workers 只提供 Node 子集，部分 shim 可 import 但调用会 throw（[Cloudflare](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)）。**[I]** Node 路径保留容器且未集成；workerd 路径连真实 bundle/provider matrix 都未过。 |
| 9 | 框架成熟度/生态维护（6） | 6 | 5 | **4** | **4** | **[F]** 固定树的 package metadata 提供 MIT、版本 0.84.4、build/test/coverage scripts；但公开 durable harness 大面积 placeholder（[package](https://github.com/earendil-works/pi/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/agent/package.json#L1-L67)）。**[I]** 低层 core 可评估，不能按完整生产 harness 计 5/6。 |
|  | **合计** | **58/60** | **39/60** | **33/60** | **32/60** | Pi/workerd 对旧最强 TS 的 delta = **-7**。 |

Pi-specific delta 的含义：输入校验闭环 `+1`；最终输出与 BYOK 没有净增益；生命周期事件很强但 UI/typed wire 仍需适配，streaming `-1`；无 evaluator parity `-2`；未实现 durable harness 没有超越旧组合；workerd 未证实使运行时 `-4`；成熟度 `-1`。因此旧聊天里的“events/context transform 是优势”成立，但不足以扭转总分。

## 3. 今天五个痛点的裁决

| 痛点 | 状态 | 已确认事实 | 最小验证方法 | 主要风险 |
|---|---|---|---|---|
| workerd 兼容 | **unknown** | **[F]** agent 根入口把 Node execution env 放到 `./node` 子入口，方向正确（[exports](https://github.com/earendil-works/pi/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/agent/package.json#L8-L21)）；OpenAI 与 Anthropic 官方 SDK 均列 Workers 为支持 runtime（[OpenAI](https://github.com/openai/openai-node/blob/main/README.md#requirements)、[Anthropic](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/README.md#requirements)）。但 Pi 聚合包仍有 Node-only transitives，Google 只明确 browser/server 用法（[Google](https://github.com/googleapis/js-genai/blob/main/README.md#browser)），且没有 Pi-on-workerd CI 证据。 | 新建隔离 spike Worker，使用目标 compat date，分别只注册 OpenAI/Anthropic/Google；`wrangler deploy --dry-run` 审 metafile，再在真实 workerd 执行 text stream、tool call、abort、cold/warm run，并断言无 stub API 被调用。 | bundle 成功不代表运行时方法可用；provider 的 lazy import、代理/Bedrock transitives 可能把 Node-only 路径带入 isolate。 |
| Durable Objects | **adapter-needed** | **[F]** Pi 给出 storage/repo contract 与 [conformance kit](https://github.com/earendil-works/pi/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/agent/src/harness/session/testing/conformance.ts#L91-L115)；固定树 `find packages/agent/src -iname '*durable*'` 无 DO backend。更关键的是 durable `AgentHarness` 无法 prompt 或 resume。DO 可随时丢内存/重跑 constructor，且无 shutdown hook，官方要求增量持久化（[lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)）。 | 用 DO SQLite 实作仅限 spike 的 `SessionRepo`，先跑 Pi 官方 conformance；再做并发同 session、eviction/restart、部署重启、provider/tool 中途故障。必须证明进行中 turn 能恢复，而不只是 transcript 能重读。 | **[I]** storage adapter 可做；durable in-flight orchestration 在 upstream harness 落地前仍是实质 blocker，自建则变成另一套状态机。SSE 请求期间 DO 也不能 hibernate，并会计 duration。 |
| SSE / stream 取消 | **adapter-needed** | **[F]** Pi 将同一 `AbortSignal` 传给 provider 与 tool（[provider path](https://github.com/earendil-works/pi/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/agent/src/agent-loop.ts#L275-L310)、[tool path](https://github.com/earendil-works/pi/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/agent/src/agent-loop.ts#L668-L705)）；Workers 能把 `ReadableStream` 跑到完成或 client disconnect（[streams](https://developers.cloudflare.com/workers/runtime-apis/streams/)）。但入站 `Request.signal` 必须显式启用 `enable_request_signal`，没有默认日期（[Cloudflare changelog](https://developers.cloudflare.com/changelog/post/2025-05-22-handle-request-cancellation/)、[workerd source](https://github.com/cloudflare/workerd/blob/cb5785a04b9d4e4e762c2c881a8bf8948fdb7ba4/src/workerd/io/compatibility-date.capnp#L706-L710)）。 | 开旗标后，用真实 HTTP 客户端分别在 provider stream、tool 执行、最终 frame 前断线；断言 upstream fetch/tool abort、BYOK client cleanup、turn 只 settle 一次，并与现有 [stream cancellation](../../../apps/agent/src/animichi/interfaces/routes/chat_stream.py)、[phase settle](../../../apps/agent/src/animichi/application/agent_turn.py)、[disconnect tests](../../../apps/agent/src/animichi/tests/unit/test_chat_stream_disconnect.py) 和 UI-message fixtures 对拍。 | 未传递会继续耗费 provider/DO duration；过早传递会丢 partial turn。Pi events 不是 AI SDK UI frame，仍需确定性 encoder。 |
| DO alarm | **adapter-needed** | **[F]** 固定树 `rg -n "alarm\(|setAlarm" packages/{agent,ai}/src` 无 DO alarm adapter。Cloudflare 每个 DO 同时只有一个 alarm；语义为 at-least-once，throw 后从 2 秒指数退避、最多 6 次重试（[official alarm docs](https://developers.cloudflare.com/durable-objects/api/alarms/)）。 | 在 storage 保存按时间排序的任务，alarm 每次只处理 due items并重排下一次；在“副作用完成、ack 未写”处强杀，验证幂等键、重复投递、6 次失败和空队列。 | 单槽必须复用为队列；非幂等 provider/tool side effect 会重复。它不能补齐未实现的 durable AgentHarness。 |
| BYOK / provider guard | **adapter-needed** | **[F]** standalone workerd 的 `Network.allow` 默认 `['public']`，DNS 多地址逐个过滤，无允许地址时按不存在处理（[pinned source](https://github.com/cloudflare/workerd/blob/cb5785a04b9d4e4e762c2c881a8bf8948fdb7ba4/src/workerd/server/workerd.capnp#L770-L810)）。Hosted Workers 的出站代理也只放公共 Internet 或本 zone origin（[security model](https://developers.cloudflare.com/workers/reference/security-model/)）；own-zone 的 `global_fetch_strictly_public` 与 standalone workerd 是两条不同路径（[pinned source](https://github.com/cloudflare/workerd/blob/cb5785a04b9d4e4e762c2c881a8bf8948fdb7ba4/src/workerd/io/compatibility-date.capnp#L419-L456)）。Pi 本身不做 allowlist、URL/port/redirect policy 或 secret scrub。 | 三个 provider 的每条真实 SDK path 都跑：空 key 不得 fallback；HTTP/非法端口、loopback/private/link-local/CGNAT/metadata IPv4+IPv6、own zone、302、混合 DNS answer、重绑定；并搜 logs/spans/errors 是否含 key。验证平台拦截点发生在 connect 前且所有 redirect 重验。 | `Network.allow` 只覆盖一部分 IP 边界，不覆盖 HTTPS/port、own infra、provider allowlist、redirect、日志脱敏和服务端 key fallback；Hosted Workers 的 DNS pin/TOCTOU 等价性仍是 **[U]**。 |

## 4. 旧线索复核

| 旧线索 | 裁决 |
|---|---|
| lifecycle events 可投影 trace | **[F] supported 原语 / [I] adapter-needed 产物。** 事件种类和顺序有源码契约；Animichi 的 trace/stage/step schema 不属于 Pi。 |
| context transform pipeline 更显式 | **[F] supported。** `transformContext` 与 `convertToLlm` 分两层，在每次 provider request 前执行（[source](https://github.com/earendil-works/pi/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/agent/src/agent-loop.ts#L275-L310)）。 |
| abort / steering 不是当前核心卖点 | **[F] Pi 有 abort、steer、follow-up queue**（[Agent source](https://github.com/earendil-works/pi/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/agent/src/agent.ts#L282-L388)）；**[I]** 本仓更关键的是断线取消、settlement 与 BYOK cleanup，功能存在不等于端到端成立。 |
| AI SDK 强在 Web stream plumbing | **[F] confirmed。** `ToolLoopAgent` 原生接 structured output、abort 与 tools（[official](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent)），`streamText` 原生输出 UI message stream 与 partial typed output（[official](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)）。 |

## 5. Go / No-go 条件

**现在：NO-GO 全量迁移，GO 仅限 spike。** 任何“先在 Node 容器换成 Pi、以后再上 Workers”的方案也 NO-GO：它承担语言/eval/BYOK 重建成本，却保留现有容器运维形态。

只有同时满足以下硬条件才重新提交 GO 决策；分数不是越过红线的替代品：

1. workerd 三 provider matrix 在真实 deployed Worker 通过，五项痛点全部从 `unknown/adapter-needed` 变为 **supported**；Pi/workerd 重新评分须严格高于已证实的 39/60 TS 可行基线，这只取得进入 GO 评审的资格，不自动批准迁移。
2. 一个 Animichi terminal union 完成“结构校验 + 异步语义校验 + 错误回喂 + 有界重试”，并证明模型不能以 plain text 绕过；request/tool caps 保持。
3. 当前 **662 case** 数据集双跑，五个 evaluator、ANY-of-N 与统计闸按现行阈值无回归；不能用 faux provider 单测替代 model-backed eval。
4. 真实断线能沿 `Request.signal -> Pi -> provider/tool` 传播；current UI-message wire、phase-aware settle、BYOK cleanup 均对拍且 exactly-once。
5. DO backend 通过 Pi conformance 与 eviction/restart/crash matrix；alarm side effect 幂等；进行中 turn 的恢复方案不依赖尚未实现的 `AgentHarness`。
6. BYOK 红线全绿：三 provider allowlist、非空 key、无 server-key fallback、HTTPS/port、metadata/private/CGNAT/own-infra、DNS/redirect、secret scrub；并完成安全复核。
7. 量化收益必须来自**退掉 agent 容器**或经实测的成本/延迟/运维下降；若最终仍需 Node 容器，则维持 NO-GO。

## 6. 仍需 spike 才能回答的未知数

1. Pi 精确 provider subpath 在本仓 Wrangler 配置下的 bundle 图、体积、stub 调用与真实流式行为。
2. Hosted Workers `fetch` 对混合 DNS、重绑定、redirect 和 own-zone 的 connect-time 行为，能否达到当前 Python socket pinning 的安全结果。
3. `enable_request_signal` 下 client disconnect 是否稳定中止三个 provider SDK 与长工具，并与 edge 代理组合后仍 exactly-once settle。
4. DO `SessionRepo` 适配成本，以及 upstream durable `AgentHarness` 何时从 placeholder 变为可恢复执行器；在此之前不得以设计文档承诺排期。
5. `submit_result` tool 对三个 provider 的 required/strict tool calling 是否能完全复刻 PydanticAI output retry；Pi 的 constrained tool schema 支持范围见 [官方说明](https://github.com/earendil-works/pi/blob/853a80d26c90a14c1886f0ebb8ffaae133ca2185/packages/ai/README.md#L494-L508)。
