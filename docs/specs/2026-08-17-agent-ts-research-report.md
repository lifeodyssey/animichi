# agent TS 化对标复查 — 调研报告(#1106)

**Status: OPEN — 报告完成待 owner 决策**
调研票:#1106(`wayfinder:research` + `ready-for-agent`)
任务书(权威、自足):`docs/specs/2026-08-17-agent-ts-research-spec.md`
本报告分**两轮复核,统计不得混算**:
- **初始复核**(2026-08-17,§一–§八;处理声明见 §六):8 路侦察 + 15 项抽查裁定(**13 CONFIRMED / 1 REFUTED / 1 UNVERIFIED**)。
- **补充复核**(2026-08-18,§九):6 路反向搜寻 + 5 项候选抽查(**2 HOLDS / 1 OVERSOLD / 2 WRONG**)。§九是对断言 A(eval 零等价物)与断言 B(undici SSRF)的最新裁决;被它修订的正文结论以 §九为准,旧表述保留为"初始复核"并显式标注。
- **口径修订**(2026-08-21,docs-only,不改上述两轮统计):任务书原稿与本报告覆盖面写过 AI SDK v6/v7,已核证据止于 **v6**;v7 完整能力复核未做,登记为 §五缺口、挂 Wave 0 Spike C。`generateObject` 弃用改引 [AI SDK 6 migration guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0#generateobject-and-streamobject-deprecation)(v6 博文只支撑"统一工具循环 + 结构化输出")。

---

## 一、一页结论

**建议:conditional-go**——重开 SD-4 的"不再议"锁定状态本身是 go(founding premise 已不成立,见理由①);但不建议据此立即整体切换到 TS,迁移需先过 Wave 0 前置 spike(Spike B/C 必做;Spike A 走 Node 路径、Spike D 走 Workers 路径,运行时未终选则两条都做)再分波次推进(见第七节)。

**三条最硬的理由:**

1. **SD-4 的立论基础已从两个方向同时松动。** 原始决策的唯一护城河——"输出层校验失败自动回喂"——在 TS 侧已显著收窄:AI SDK v6 补齐了工具执行错误自动回喂(`tool-error` part,已默认开启);`repairToolCall` 已转正;且本轮复核**新发现** LangChain.js `createAgent()+toolStrategy()` 默认 `handleError: true`,校验失败会自动回喂模型重试——这是全目录里唯一一个默认开启、且被一个真实 bug 修复(#9426→PR #9434)证实运行时确实生效的闭环,直接对上 pydantic-ai `output_validator` 的语义。与此同时,支撑 SD-4"保容器"结论的另一半理由——X2 容器保温 SLO——**复核确认从未在代码里落地**(`wrangler.toml` 三处 `[[containers]]` 块均无 `min_instances`,无 keep-warm cron):当年"为保 X2 才留容器"的论据,可能从未真正兑现过。
2. **但真正决定成本的重心已经转移、且仍重,只是不是"5/5 全称零等价"。** eval 体系仍是最大成本项。初始复核把 pydantic-evals 的 5 个官方 agentic evaluator 写成 TS 生态**零等价物**、基础设施同量级从零重建——**该全称判断已被 §九修订为 WEAKENED**:ToolCorrectness、MaxToolCalls 有独立验证的现成等价物;ArgumentCorrectness 有算法级对应(需自抄私有代码);仅 TrajectoryMatch 的默认渐进 F1 模式与 MaxModelRequests 确认零等价。`logfire-js` `/evals` 当场核实仍只搬了 SpanTree/SpanQuery 地基、五个官方评估器一个都没有——那条对 **logfire-js** 的核实仍成立,不能外推成"全 TS 生态无货"。ANY-of-N 析取是 animichi 自己的 userland wrapper,不是官方类自带语义。统计闸(557 行纯 stdlib)全场零等价,须机械迁移。
3. **一处 2026-07-06 从未被评估过的高危缺口本轮才浮现,且必须按运行时拆开。** **Node/容器路径**:undici 没有一等的 SSRF/connect-time IP pinning 方案(`nodejs/undici#2019` 截至核查仍 open;Budibase GHSA-v42f-v8xc-j435 证明传统 `http.Agent` `lookup` 在 undici fetch dispatcher 下被静默绕过);§九进一步证实 `connect:{blockList}` 对 HTTPS 静默失效。animichi 现有 ~500 行 egress 基建若照搬会重演已知漏洞类型,必须在 undici 低层 `Dispatcher`/`connect` 上重新设计(预估 3-5 倍工程量、1-2 周)。**这条估算不是运行时无关的"迁移总体风险"**——若终选 Workers,workerd 默认 `Network.allow=["public"]` 可能把主战场从 undici 挪走;该证据未过独立复核,要靠 Wave 0 **Spike D** 实测,当前不预先划掉成本。原始 SD-4 决策范围之外。

**一句话:** 当年让 SD-4"锁死"的唯一理由(输出校验回喂)已经明显不再是唯一或最硬的理由——但调研范围一旦从"重试基建"扩大到全部 9 项绑定面,eval 生态(缺口收窄后仍有算法级硬缺口)与出口安全(Node 路径被强化、Workers 路径未证实)这两个当年没被纳入评估的维度,变成了比原来更硬的新理由。两头都要认账,所以是 conditional-go 而非直接 go。

---

## 二、SD-4 式 60 分制评分表

**方法论说明:** 本表与原始 SD-4(2026-07-06,"Vercel AI SDK 50/60")共用同一 60 分总量尺,但**覆盖维度不同**——原始评分主要聚焦重试/校验闭环(任务书 §一背景),本轮调研范围扩大到全部 9 项绑定面(新增 eval 生态、harness capabilities 两个重量级维度)。因此本表得分**不与旧的 50/60 直接可比**,是同一量尺下的独立重新打分,差异本身就是本次调研要交付的信息。"最强 TS 组合"= 按维度取当前证据下最优选项(不预设单一框架),第 3 行脚注说明该维度选型会牵动整体框架决策。

| # | 维度 | 分值 | pydantic-ai 现状 | 最强 TS 组合 | 证据来源(scope) |
|---|---|---|---|---|---|
| 1 | 工具执行错误回喂 | 5 | 5/5 原生 `ModelRetry` | **5/5** AI SDK v6 `tool-error` part 自动回喂,stopWhen 循环内默认发生 | scope1(CONFIRMED) |
| 2 | 工具输入校验回喂 | 5 | 5/5 原生 | 4/5 AI SDK `repairToolCall` 已转正但需开发者接线(~48 行范例);LangChain.js 默认开启可达 5/5 | scope1、scope7(CONFIRMED) |
| 3 | 最终输出校验回喂 | 8 | 8/8 原生 `output_validator` | **3/8** AI SDK 路径需自建 ~65-100 行且无官方 hook;若改选 LangChain.js `toolStrategy(handleError:true)` 可上探至 ~6/8(但需换主框架,牵动第 3/9 行) | scope1(REFUTED 澄清见下)、scope7(CONFIRMED) |
| 4 | Streaming / typed output 渐进 | 6 | 6/6 能力具备(`run_stream`+`allow_partial`),但当前生产**未使用**(单次落地) | 5/6 wire 协议零改动(CONFIRMED);`partialOutputStream` 只保证 JSON 语法合法、无 schema 校验,且语义对象不同(模型自产文本 vs 工具结果投影) | scope1、scope3(CONFIRMED) |
| 5 | Eval 生态对齐 | 10 | 10/10 官方 pydantic-evals,5 个 agentic evaluator + 自研统计闸全部生产可用 | **5/10**(初始复核 3/10,已被 §九修订) ToolCorrectness、MaxToolCalls 有独立验证的现成等价物;ArgumentCorrectness 算法级对应需自抄私有代码;TrajectoryMatch 仅 exact 布尔子集(默认渐进 F1 仍零等价);MaxModelRequests 确认零等价;`logfire-js` 仍只搬地基;bootstrap 统计闸全场零等价,须机械迁移 | scope2(初始 CONFIRMED 全称零等价;§九 WEAKENED) |
| 6 | Harness capabilities(compaction/memory/组合) | 8 | 8/8 生产绑定(三层 compaction+Memory+可排序 capability 组合) | **3/8** 两家框架均无阈值触发分层压缩(AI SDK cookbook 仅 ~50 行纯截断);Memory 官方明确不提供;CF Think harness 钩子非独立可插拔 | scope4(CONFIRMED) |
| 7 | BYOK 多 provider | 6 | 6/6 三家族生产可用、SSRF-guarded、测试重 | 3/6 provider 构造小改(原语齐全,confirmed);**SSRF/egress 守卫无一等等价物**(Node/undici 路径,§九 STANDS 且强化;Workers/workerd 边界未过独立复核,不预先下修) | scope5(CONFIRMED;§九加运行时限定) |
| 8 | 运行时/部署适配 | 6 | 4/6 现役但携带真实运维债(3 处重复配置+代理层+CI build-arg 绕过+220s 冷启动探针预算),且 X2 保温 SLO **从未落地** | **6/6** Workers 计费模型对"等 LLM"负载结构性更省;7 工具多轮 loop 无平台硬伤;容器退役收益可量化 | scope6(CONFIRMED) |
| 9 | 框架成熟度/生态维护 | 6 | 6/6 单一连贯框架,已生产验证 | 5/6 AI SDK/Mastra/LangChain.js 均确认活跃维护,但生态内也有真实"僵尸"候选(Genkit CF 不兼容、Inngest AgentKit 停更 3.5+ 月与营销文案矛盾),需要谨慎选型 | scope7(CONFIRMED) |
| | **合计** | **60** | **58/60** | **39/60**(初始复核 37/60;第 5 行 3→5 已按 §九回写) | |

**关于第 3 行的 REFUTED 澄清(重要,已从结论中剔除误判):** 侦察原始表述称 GitHub #4906/#10856 证明"该缺口未被 Vercel 官方认领"——复核判决为 **REFUTED**:#4906 实际已被合并 PR(#4937)修复,只是修复落在**已弃用**的 `generateObject()` 上([AI SDK 6 migration guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0#generateobject-and-streamobject-deprecation)),未移植到当前 `generateText`+`Output.object()` 路径(maintainer 明确表态"repairText 太复杂,不想再要",转而提供范围更窄的 `extractJsonMiddleware`,只做语法级 JSON 提取,不做语义校验重试);#10856 也不是"零回应"——Vercel collaborator 两次回复,主动保持 open 作为待定方向。**准确表述应为:"官方曾经有过等价方案但主动收窄/未移植到新 API,而非从未理会。"**

---

## 三、九项 Scope 详述

### Scope 1 — 重试/校验闭环
**结论:** 工具层双闸(执行错误自动回喂 + `repairToolCall`)已确认对齐 pydantic-ai;输出层缺口仍在但比 2026-07-06 估计的 ~100 行收窄,同时因未采用官方 hook 需自建外层重试循环,合理成本区间上修为 **~65-100 行**(而非原估 ~50 行),原因是 `stopWhen` 多步循环在"tool-error 恰好触发停止条件的最后一步"时的行为**官方文档未定义**,必须靠源码或实测钉死。
**关键 findings:**
- CONFIRMED:`generateText`/`Output.object()` 无内建/experimental 最终输出校验回喂 hook;`repairToolCall` 严格限定 tool-call 层。
- **REFUTED**(见上节澄清):#4906/#10856 不是"官方未理会",是"官方给过窄化方案、主动未移植到新 API"。
- CONFIRMED:streaming 下 `partialOutputStream` 只保证 JSON 语法合法,不做 schema 校验(pydantic-ai 的 `allow_partial=True` 是真正类型化部分校验)——但此差距对 SD-9 当前是**理论性非现实性**:仓库实测 `chat_stream.py:54-69` 证实 /v1/chat 从未走渐进式 typed-output 路径,`data_frames()` 只在 `agent.run()` 整体跑完后调用一次。
- Low-confidence 风险:`repairToolCall` 存在一例未确认修复的触发失效报告(#8240,Vertex AI 场景),建议 go 前实测钉死,而非只信文档。

### Scope 2 — eval 体系(预期最大成本项;全称"零等价"已被 §九下修)
**结论(§九最新裁决,WEAKENED):** 仍是 9 个 scope 里最大的成本项,但不是"5 个官方 evaluator 全无 TS 候选、必须同量级从零手写"。逐评估器:ToolCorrectness、MaxToolCalls 有独立验证的现成等价物(`agentevals` unordered/superset、Mastra `checks.maxToolCalls`);ArgumentCorrectness 有算法级对应但需自抄私有 `_exactMatch`/`_supersetMatch`;TrajectoryMatch 只覆盖 `order='exact'` 布尔判定,pydantic **默认**渐进 F1(`in_order` LCS / `any_order` multiset)六路搜寻零命中;MaxModelRequests 确认零等价。ANY-of-N 析取是 animichi 自己的 userland wrapper,不是官方类缺口。完整对照表见 §九断言 A。
**初始复核结论(已被 §九修订,保留备查):** 当时写"TS 侧没有任何候选可以替代官方 5 个 agentic evaluator,必须从零手写",并据此打 3/10、把基础设施标成同量级从零重建。对 **`logfire-js` `/evals`** 的核实(只搬地基、五个官方评估器一个都没有)仍成立,不能外推成全生态无货。
**关键 findings:**
- CONFIRMED(初始复核当场重新抓取源码验证):`logfire-js` `/evals` 自述与 pydantic-evals wire-format 兼容,移植了 SpanTree/SpanQuery 基础设施(433 行),**但只导出 7 个 case-level 内建 evaluator(Contains/Equals/EqualsExpected/HasMatchingSpan/IsInstance/LLMJudge/MaxDuration),5 个官方 agentic evaluator 一个都不存在**——只搬地基,没搬评估器实现。
- 权威数据集实测 **662 条**(`apps/agent/src/animichi/tests/eval/datasets/agent_eval_v3.json`,顶层 JSON 数组;`python3 -c "import json;print(len(json.load(open('apps/agent/src/animichi/tests/eval/datasets/agent_eval_v3.json'))))"`),既非任务书起草时的 617,也非 `AGENTS.md` 记载的 655——三处数字互不一致,后续估算以实测 662 为准(对应本 PR 的 base `origin/main`,后续变更需重跑)。
- 归档承诺澄清:2026-07-06 规划文档写"存档已迁 Logfire Experiments",但当场核查 Python 侧代码(`eval_harness.py` 显式 `send_to_logfire=False`)证实这是**未兑现的既定意图**,不是需要兼容的活依赖——降低了这一项的迁移风险(不存在"从 Logfire Experiments 迁回"的额外成本)。
- 统计闸(分层 bootstrap + Clopper-Pearson,557 行纯 stdlib)全场无任何框架提供等价能力,是唯一与框架选型无关、可原样机械迁移的低风险模块。
- UNVERIFIED(未在初始复核轮独立重跑):eval 非测试基础设施 ~3600-3700 行 + 18 个专项测试文件的精确行数为仓库内部计数,未重新核验,但不影响方向性结论(evaluator 缺口分级见 §九,不再依赖"5/5 全无")。

### Scope 3 — streaming 协议等价性
**结论:** wire 协议 = **零改动**,`packages/contract/src/chat-data-parts.ts` 的 zod 契约不需要变。这一项实际上是支持 go 的证据,而非阻碍。
**关键 findings:**
- 任务书前提有误需更正:apps/agent 生产代码**从未使用** pydantic-ai 的 `VercelAIAdapter`,只借用了同包更底层的 `response_types` chunk 类型手搓帧编码;agent 用 `agent.run()` 整体跑完,不走 `run_stream()`。
- CONFIRMED(context7 当场核对 ai-sdk.dev 主源):tool-part 状态机、data-part 同 ID 覆写、finish/finish-step 帧格式、`x-vercel-ai-ui-message-stream: v1` 头四项协议语义,均与手搓 Python 实现精确对齐。
- 净效果预估:迁移到 TS 原生后,这层(~681 行:`chat_stream_frames.py` 304 + `chat_stream.py` 97 + `tool_event_bridge.py` 280)大概率是**净简化**,因为 `createUIMessageStream`/`writer.write`/`toUIMessageStream` 原生免费覆盖今天手搓的部分。
- 独立于本次结论的文档陈旧问题(不影响 go/no-go):`docs/specs/2026-07-06-frontend-rebuild-spec.md:106,143` 关于"已在跑 VercelAIAdapter/渐进卡片"的表述与代码不符,建议单开修订任务。

### Scope 4 — harness capabilities
**结论:** 真正的自建缺口不是任务书预设的 ManagedPrompt(生产已零绑定、明文已退役),而是 **compaction**——两家 TS 框架均无分层/阈值触发的会话压缩能力。
**关键 findings:**
- "capabilities 组合"机制(`AgentCapability`/`Hooks`/`CombinedCapability`)来自**原生 pydantic-ai**,不是 harness——生产真正绑定的 harness 子模块只有 `memory` 与 `compaction` 两个。
- CodeMode 只存在于 `spikes/codemode/`,从未进入生产 `build_animichi_agent()`。
- CONFIRMED:AI SDK 官方"Harnesses"是假朋友——不是能力组合系统,而是接外部 CLI runtime(Claude Code/Codex/Pi)的适配层,experimental 状态,不能拿来对标。(v6 证据;v7 新增 `HarnessAgent` 一等 API,完整复核未做,见 §五,挂 Spike C)
- CONFIRMED:AI SDK 官方 cookbook 的 compaction 方案只是 `prepareStep`+`pruneMessages` 纯截断(~50 行,无 LLM 摘要/无实体挽留),而 animichi 的 `history_compaction.py` 是 237 行三层系统,迁移需整体自建(预估 250-350 行)。
- ManagedPrompt 底层原语(Logfire remote variables)在 `logfire-js` 的 `vars` 模块确实存在,但因生产未绑定,不构成真实迁移成本。

### Scope 5 — BYOK 多 provider(SD-11)
**结论:** Provider 构造层是小改(原语齐全);**egress/SSRF 守卫层是本轮调研发现的最高风险单项**(§九:断言 B 在 Node/undici 路径 STANDS 且被强化;Workers/workerd 边界未过独立复核,成本不预先下修),且不在原始 SD-4 评估范围内。
**关键 findings:**
- CONFIRMED:`createOpenAI`/`createAnthropic`/`createGoogleGenerativeAI`/`createOpenAICompatible` 四个官方一等工厂均支持每请求覆盖 apiKey/baseURL/headers/fetch,构造零 I/O,与 Python 侧模式一一对应。
- CONFIRMED(复核当场重新读取 issue 全文):`nodejs/undici#2019` 讨论 SSRF 防护支持,截至核查仍 open、无官方推荐 connect-time IP pinning 模式;真实 CVE 案例(Budibase)证明"沿用传统 `http.Agent` lookup 选项在 undici fetch dispatcher 下被静默绕过"是现实翻车模式,不是假设。
- Gemini family 特有陷阱:`createGoogleGenerativeAI` 的 `apiKey` 在 falsy 时会 fallback 到环境变量,与 Python 侧同款行为对称,迁移时必须复刻 animichi 现有的 `_require_nonblank_key` 前置校验,否则重演"BYOK key 缺失时静默落到服务端凭据"漏洞。
- 现状规模:生产 ~1221 行(byok_models.py+byok_probe.py+egress_transport.py+egress_guard.py+routes),测试 ~5907 行(42 个专项文件)。

### Scope 6 — 运行时形态(Workers vs CF Agents SDK)
**结论:** 平台约束对 7 工具多轮 agent loop **无 disqualifier**;计费模型结构性支持 Workers 直跑;容器保留的原始理由(X2 保温 SLO)复核确认从未落地。
**关键 findings:**
- CONFIRMED:Workers CPU 时间计费不计网络等待,HTTP 请求无 wall-clock 上限;DO/Agents SDK 按活跃 wall-clock GB-秒计费(含网络等待,128MB 固定分摊)——对"等 LLM 响应"为主的负载,裸 Workers 结构性更省。
- CONFIRMED:容器冷启动官方文档称常在 1-3 秒,但仓库 CI 自承镜像变更后首次冷启动要几分钟,为此设 220 秒探针退避预算——纯 Worker 部署无此成本。
- CONFIRMED(决定性):`wrangler.toml` 三处 `[[containers]]` 块均无 `min_instances` 字段,仓库全部 CI workflow 无 keep-warm cron——X2 warm SLO 依赖的保温机制**在代码里从未落地**,"为保 X2 才留容器"这条 2026-07-06 论据可能从未真正兑现。
- CF Agents SDK(DO)同样不构成 disqualifier,但其差异化能力(WebSocket 多端同步/schedule/needsApproval)未被现有 SD-9/SD-12 需求拉动,建议作为未来升级路径而非 day-one 架构。

### Scope 7 — 框架全目录枚举
**结论:** Top 3 短名单 = **AI SDK(基线)、Mastra、LangChain.js/LangGraph.js**。结构性发现:Mastra/VoltAgent/CF Agents SDK 均建在 AI SDK 之上,真正独立的编排栈只有 LangChain 家族、OpenAI Agents SDK JS、Genkit 三条线。
**关键 findings:**
- CONFIRMED(复核用真实 bug 追证):LangChain.js v1 `createAgent()+toolStrategy()` 默认 `handleError: true`,是全目录唯一一个**默认开启**的最终结构化输出校验回喂闭环,由真实 bug(#9426,"文档说会重试/实测不重试")经 PR #9434 修复证实运行时确实生效——这是本轮调研里对 SD-4 决定性缺口最有力的正面证据。
- CONFIRMED:Genkit 因 CF Workers/edge runtime 禁用 `eval()`/`new Function()`(其默认校验库 ajv 依赖两者)在维度①出局,官方文档自认非一等部署目标;Claude Agent SDK TS 因架构要求 spawn 长驻 CLI 子进程(容器模型非 Workers isolate)出局,选它等于换语言不换基础设施痛点。
- CONFIRMED(复核用 gh api/npm view 当场证伪):Inngest AgentKit 营销文案称"活跃维护",但 repo 最后 push 距今 3.5+ 月、最新 release 9+ 月前——与"仓库记忆"教训"调研必须先枚举厂商全目录、陈旧≠无效"正面吻合。
- Bonus(复核新发现):CF Agents SDK 除 v6 外**也已支持 v7**(2026-07-23 changelog),锁定风险比侦察原判断更低。这条是 CF 作为 AI SDK 消费者的 changelog,不是本轮对 AI SDK 7 能力面的复核(见 §五)。
- Mastra 有原生 evals Scorers,若选它可能为 scope 2 的最大成本项省下部分脚手架,但语义对齐未经验证(open question)。

### Scope 8 — 仓库绑定面盘点(迁移成本的事实底座)
**结论:** 仓库现状比任务书背景假设更薄也更宽——数字用于第四节迁移成本估算,直接取代任务书里已过时的估算。
**关键 findings(均 CONFIRMED,git/wc -l 实测):**
- 生产 src(不含 spikes)= **179 文件 / 23,563 行**;测试代码 = **356 文件 / 47,967 行**;全仓 `def test_` 计数 = **1,815 个**(任务书背景"800+ 测试"已过时,实测超出两倍以上)。
- 模型可调用工具实际 **6 个**(4 catalog + 2 web),非任务书假设的 7 个。注册点 `apps/agent/src/animichi/agents/animichi_agent.py:414` `tools=[*ANIMICHI_TOOLS, *WEB_TOOLS]`;`agents/animichi_tools.py` 的 `TOOLS`(4)=`resolve_anime` / `search_bangumi` / `search_nearby` / `plan_route`;`agents/web_tools.py:145` 的 `TOOLS`(2)=`web_search` / `translate_anime_title`;spikes 下的工具不计,未进入 `build_animichi_agent()`。对应本 PR 的 base `origin/main`,后续变更需重跑。
- `Agent(` 构造点 **6 处,分散在 5 个生产模块** + 1 个 spike,不是单一主 agent。
- `VercelAIAdapter`/`ManagedPrompt` 生产代码零引用,均已确认为"未启用"或"已退役"。
- open question:任务书引用的"~30.6k 行 Python"口径既不等于生产源码单算(23.5k)也不等于生产+测试合算(71.5k),原始口径未知,本报告后续以**实测数字**为准。

### Scope 9 — 编排影响(直接引用任务书既定结论)
> 与 #1046(Migration Executor × CI Secrets 归零)明确解耦,迁移执行器的方案选择不等待本调研。若 go,迁移链终局 = Atlas → Drizzle `schema.ts` 一次性切换(单语言仓库中 `schema.ts` 单源天性合法,无需"手写 SQL 军规"中间态)。眼下保留 Atlas 即是对本调研两种结论(go / no-go)都兼容的实物期权。
——`docs/specs/2026-08-17-agent-ts-research-spec.md` §三.9,原样引用,本报告不重新论证。

---

## 四、迁移成本区间(基于 scope 8 实测数字逐项估)

| 模块 | Python 现状(实测) | TS 迁移预估 | 风险/依据 |
|---|---|---|---|
| 生产 src 总量 | 179 文件 / 23,563 行 | 视框架而定;工具/provider 构造原语框架免费覆盖,egress guard/compaction 净增 | scope8+3/4/5 综合净效应,方向不确定,不给单一乘数 |
| 测试代码 | 356 文件 / 47,967 行 / **1,815 个 test 函数** | 同量级行为对等重建,無证据支持大幅收缩或膨胀 | scope8(实测,任务书旧估已过时 2x+) |
| 模型工具 | 6 个(4 catalog+2 web) | 工具本体逻辑近 1:1 迁移;tool-loop 原语框架原生覆盖 | scope8 finding#2 |
| Agent 构造点 | 6 处(5 生产模块+1 spike) | 视是否合并为单一 orchestrator,预估 3-6 处 | scope8 finding#3 |
| eval 权威数据集 | 662 条(`agent_eval_v3.json`)+33 held-out+~125 其他专项 case | JSON→JSON 结构化迁移低成本;真正成本在评估器逻辑非 case 数 | scope2 finding#4 |
| eval 基础设施(非测试) | ~3600-3700 行(gate/stats/evaluators/harness/mock 等 17 文件) | **收窄重建**(初始复核"同量级从零重建"已被 §九修订)——ToolCorrectness/MaxToolCalls 可基于现成布尔匹配原语搭建(仍需 spans→messages 转接);TrajectoryMatch 默认渐进 F1 仍须从零手写;MaxModelRequests 从零手写;ANY-of-N 两侧同等成本 | scope2(§九 WEAKENED;行数 UNVERIFIED 待复核) |
| eval 专项单测 | 18 文件 / ~2000+ 行 | 同步重建以维持覆盖对等 | scope2 |
| streaming 协议层 | 681 行(chat_stream_frames+chat_stream+tool_event_bridge) | **预期净简化**(createUIMessageStream 原生覆盖) | scope3(CONFIRMED 协议零改动) |
| harness compaction | 237 行(三层编排) | 250-350 行从零重建 | scope4(两家框架均无阈值分层压缩) |
| harness memory | 未精确统计(open question) | 自建 或 引入第三方(Mem0/Hindsight 类) | scope4 open question |
| BYOK provider 构造 | 289 行 | 150-300 行,低风险 | scope5(原语齐全) |
| BYOK egress/SSRF 守卫 | 498 行 | **Node/容器路径:3-5 倍工程量,1-2 周(含专项安全复核)**;Workers 路径可能大幅下修,需 Spike D 实测后才能改数字,当前不预先下修 | scope5(CONFIRMED undici 无一等方案+真实 CVE;§九限定运行时) |
| BYOK 测试 | 42 文件 / ~5,907 行 | 同步重建 | scope5 |
| 输出校验回喂自建 | 0(原生) | AI SDK 路径 ~65-100 行;LangChain.js 路径显著更低(默认闭环) | scope1(修正后)、scope7 |

**总量级判断(非 executor 级估算,供 owner 决策参考):** 主导成本不是"行数搬运"而是**残留的评估器硬缺口(TrajectoryMatch 默认 F1 + MaxModelRequests) + 高风险的安全基建重建(按运行时分支)**,二者都不随迁移行数线性缩放。若选定框架并完成 Wave 0 前置 spike(见下节),粗量级落在**数周至两三个月**,取决于并行度与分波次策略;精确人天数字应在框架终选后由 executor 侧另行拆解(遵循仓库既有纪律:调研票不代做实现估算)。

---

## 五、风险与 Open Questions 汇总

**高优先级(影响 go/no-go 或框架选型,建议纳入第七节 Wave 0 spike):**
- Node 路径:§九已把"官方无推荐模式"做成可复现结论(含 TLSSocket silent-bypass);剩余工作是 HTTP+HTTPS 都生效的 connect-time 方案(Spike A 改形)。Workers 路径:workerd 默认 SSRF 边界未过独立复核,需 Spike D 实测,不能把 Node 估算当成运行时无关成本。
- LangChain.js `toolStrategy(handleError:true)` 的回喂,是否覆盖 animichi 实际使用的**业务语义校验**(而不仅是 JSON schema 形状校验)——需要针对性验证而非只信文档/bug 记录。
- `logfire-js` "wire-format-compatible" 的自述,是否对 `agent_eval_v3.json` 经 `--export-dataset` 导出后的形态**真正字节兼容**——只核实了源码注释设计意图,未做端到端实测,是整条 eval 迁移路径成本估算里杠杆最大的未知项。
- **AI SDK 7 完整能力复核未做**(任务书原稿写覆盖 v6/v7,本轮已核证据止于 v6;本 PR 不补做全面调研)。已从官方源核到、但未纳入能力对标的事实:
  - 发布于 2026-06-25([AI SDK 7](https://vercel.com/blog/ai-sdk-7))。
  - 要求 Node.js ≥22([migration-guide-7-0 · Minimum Node.js Version](https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0#minimum-nodejs-version))。
  - ESM-only,不再支持 `require()`([migration-guide-7-0 · ESM Only](https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0#esm-only--commonjs-support-removed))。
  - 新增 agent harness 层(`HarnessAgent` + 适配器),官方点名可接 Claude Code / Codex / Deep Agents / OpenCode / Pi([博文](https://vercel.com/blog/ai-sdk-7);[Harness Adapters](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-adapters);概览同样写 Claude Code / Codex / Pi,[Harnesses overview](https://ai-sdk.dev/docs/ai-sdk-harnesses/overview))。
  对迁移成本:Node 22 / ESM-only 对 Workers 影响小(Workers 已是 ESM,runtime 也不是 Node 18/20);对本地 harness 与构建链有影响(dev/eval 机器、`package.json` `engines`、仍走 `require()` 的脚本)。harness 层与 Scope 4(v6 把官方 Harnesses 判为接外部 CLI 的适配层、不能拿来对标 compaction)和 Scope 7(框架终选)相关——v7 把 `HarnessAgent` 做成一等 experimental API,是否改写那两条结论,**本轮不补做**,放 Wave 0 Spike C。

**中优先级(进 open_questions,不阻塞 go/no-go 但影响执行期估算):**
- eval 非测试基础设施 ~3600-3700 行的精确计数未在复核轮独立重跑(UNVERIFIED),建议定稿前 `wc -l` 复核一次。
- `pydantic_ai_harness.memory` 子模块精确 LOC 未统计。
- `@cloudflare/codemode` 成熟度口径不一致(npm 页标 experimental,官方 guide 给出可直接生产用示例),需再核实。
- OpenAI Agents SDK JS `outputType` 校验失败是否有选配自动重试机制,官方 JS 指南未给出显式措辞。
- 任务书引用的"~30.6k 行 Python"/"617 eval case"/"800+ 测试"三处背景数字口径均与本轮实测不符,原始估算来源未知。
- Workers 侧 TS agent 打包后 128MB isolate 真实内存峰值未测量,不能从 Python 容器 273MiB 外推。
- 容器当前实际 Cloudflare 月账单未知(无 dashboard 访问权限),只能核实操作复杂度不能核实费用金额。

---

## 六、关于 REFUTED 与 UNVERIFIED 的处理声明

本节只覆盖**初始复核**(2026-08-17)的 15 项抽查,与 §九补充复核的 2 HOLDS / 1 OVERSOLD / 2 WRONG **不得混算**。本报告已按任务书要求处理该轮判决:
- **REFUTED**(1 项):`[Scope1]` 关于 GitHub #4906/#10856 证明"Vercel 官方未认领该缺口"的表述——已在第二节表格脚注与第三节 Scope 1 明确标注并用更准确的表述替代,**未进入第一节结论**。
- **UNVERIFIED**(1 项):`[Scope2]` eval 基础设施 ~3600-3700 行的精确计数——已列入第五节 open questions,**不作为决定性数字使用**。该轮把 evaluator 缺口本身标为 CONFIRMED,是针对 `logfire-js` 导出列表的核实;全生态"5/5 零等价"的全称判断已被 §九下修,不在本轮 15 项统计里改写。
- 其余 13 项初始复核裁定均为 **CONFIRMED**,已原样吸收进对应 scope 小节与评分表(其中 Scope 2 评分与"从零重建"表述随后被 §九修订,见第二节第 5 行与第三节 Scope 2)。
- **口径修订**(2026-08-21,docs-only):不进入本轮 15 项、也不进入 §九 5 项抽查统计。v6/v7 覆盖面收窄与 v7 缺口登记见文首分层与 §五。

---

## 七、若 go/conditional-go:分波次迁移草案

**前提:** 每波独立可发布、可回滚;eval 基线对照策略统一采用"双跑并行核对":Python 跑分器与 TS 跑分器对同一批 case 并行跑,逐 case 逐 metric 比对(现有 schema-v2 `BaselineRecord` 已存 per-case 分数,对比工具本质是 dict-diff),直到**连续 ≥2 次全量跑分数一致**才允许该波推进/合并。增量运行成本 ≈ 现有单次全量跑成本($3-7,MiMo v2.5,~662 cases,~21 分钟)的 2 倍,持续到对齐为止。

- **Wave 0(前置 spike,门控后续所有波次)**
  - Spike A(Node 路径,已改形):原定目标"把'官方无推荐模式'从 medium confidence 提到可执行结论"**已被 §九完成且强化**(TLSSocket silent-bypass,含可复现实测)。剩余工作 = 设计并验证一个 HTTP+HTTPS 都生效的 connect-time 方案。若终选 Workers,Spike A 由 Spike D 取代,不再单独执行。
  - Spike B:工作量从"从零手写整套匹配算法"降档为"基于 `agentevals` 现成 `unordered`/`superset` 布尔匹配原语,补一层 span→messages 转接,对 ToolCorrectness 做双跑核对";并回答 gate 是否依赖 TrajectoryMatch 默认连续 F1(若否,该缺口可忽略)。
  - Spike C:针对 animichi 实际业务校验器验证 LangChain.js `toolStrategy(handleError:true)` 的回喂行为,据此在 AI SDK-centric 组合与 LangChain.js/LangGraph.js-centric 组合之间终选主框架。(不受 §九影响)。**AI SDK 7 的完整能力评估也在这里做,不在本调研补做**——至少覆盖 Node 22 / ESM-only 对本地 harness 与构建链的成本,以及 v7 `HarnessAgent` 适配层(Claude Code / Codex / Deep Agents / OpenCode / Pi)是否改写 Scope 4/7 把官方 Harnesses 判为"假朋友"的结论。
  - Spike D(Workers 路径,§九新增):部署探针 Worker,对 `10.x`/`169.254.169.254`/`100.64.0.1`(CGNAT)/`100.100.100.200`(阿里云元数据 IP)发起 `fetch()`,确认默认 `Network.allow=["public"]` 是否挡下这些目标,并验证 redirect 链是否逐跳复核。结果直接决定第二节 #7 行与 BYOK egress 成本是否下修。
  - 交付物:Spike B/C 必做;Spike A 或 D 按终选运行时二选一(运行时未终选则两条都做)+ owner 签核的框架终选决定,作为 Wave 1 的门禁。

- **Wave 1(最低风险,独立可发布)**:streaming 协议层(zero-cost 已确认)+ **不含用户可控 `baseURL` 的** BYOK provider 构造(Anthropic / Gemini 工厂,以及 OpenAI-compat **不转发**请求里的 `baseURL`)。`docs/specs/2026-07-28-284-byok-design.md` Goal 5 要求凡用户可影响的出口必须先过 post-resolution IP SSRF 守卫;请求可控的 `baseURL`(OpenAI-compatible 家族的核心路径)留到 Wave 4 与 egress guard 一并落地,不得以"非关键旁路"提前暴露。部署在 Workers 上,非关键流量做旁路对照(不切主流量)。

- **Wave 2**:harness capabilities 对等重建——compaction 三层 + memory,用生产会话回放日志验证 token 预算行为与现有系统一致。

- **Wave 3(门控 Wave 4 的关键波次)**:eval 生态重建(按 §九收窄)——ToolCorrectness/MaxToolCalls 基于现成布尔匹配原语+span 转接;TrajectoryMatch 默认渐进 F1 与 MaxModelRequests 从零手写;bootstrap 统计闸机械迁移。双跑并行核对直至连续 ≥2 次全量对齐。没有这一波,后续波次无法用 eval 验证正确性。

- **Wave 4**:agent 主循环整体切换(工具+BYOK egress guard——含请求可控 `baseURL` 的 OpenAI-compat 出口+输出校验回喂),Workers 与 Python 容器双跑一个完整 eval 周期 + 一段 canary 流量观察期,两轮干净周期后才进入 Wave 5。

- **Wave 5(收尾,独立可发布/可随时回滚)**:容器基础设施退役——移除 3 处重复 `[[containers]]` 配置块、专用代理层(`container-env.ts`)、CI build-arg 绕过步骤、220 秒冷启动探针预算。

---

## 八、Sources(primary source,已去重)

**AI SDK 官方文档(`ai-sdk.dev`)**:`/docs/ai-sdk-core/generating-structured-data` · `/docs/reference/ai-sdk-core/generate-text` · `/docs/agents/loop-control` · `/docs/reference/ai-sdk-core/stream-object` · `/docs/ai-sdk-core/tools-and-tool-calling` · `/docs/ai-sdk-ui/chatbot-tool-usage` · `/docs/migration-guides/migration-guide-6-0`(+`#generateobject-and-streamobject-deprecation`)· `/docs/migration-guides/migration-guide-7-0`(+`#minimum-nodejs-version`、`#esm-only--commonjs-support-removed`;v7 能力面未复核,只核平台约束与 harness 层存在)· `/docs/ai-sdk-ui/streaming-data` · `/docs/ai-sdk-ui/stream-protocol` · `/docs/reference/ai-sdk-ui/create-ui-message-stream` · `/docs/reference/ai-sdk-ui/use-object` · `/docs/agents/building-agents` · `/docs/ai-sdk-harnesses/overview` · `/docs/ai-sdk-harnesses/harness-adapters` · `/providers/ai-sdk-providers/{openai,anthropic,google}` · `/providers/openai-compatible-providers`(+`/custom-providers`)· `/docs/ai-sdk-core/{provider-management,telemetry,testing}` · `/docs/reference/ai-sdk-core/tool-loop-agent` · `/v7/cookbook/guides/agent-context-compaction`

**Vercel 官方**:vercel.com/blog/ai-sdk-6 · vercel.com/blog/ai-sdk-7(发布日 2026-06-25;harness 层点名 Codex / Claude Code / Deep Agents / OpenCode / Pi)· vercel.com/kb/guide/an-introduction-to-evals · vercel.com/docs/ai-gateway/ecosystem/framework-integrations/mastra

**vercel/ai GitHub(issues/PR,gh api 当场核实)**:github.com/vercel/ai/issues/{4906,10856,8240,11696} · github.com/vercel/ai/pull/4937

**第三方输出回喂补件**:github.com/zirkelc/ai-retry · ui.paukraft.com/scripts/ai-sdk-plus · vercelai-ts.dev/structured-output/

**pydantic-ai / logfire-js**:github.com/pydantic/pydantic-ai/blob/main/docs/output.md · github.com/pydantic/logfire-js(`/packages/logfire-api/src/evals/index.ts`、`/src/vars`、顶层 `/packages`)· registry.npmjs.org/logfire · pydantic.dev/docs/logfire/{typescript-sdk,evaluate/datasets-and-experiments}/

**Eval 生态候选**:promptfoo.dev/docs/tracing/ · github.com/langchain-ai/agentevals · github.com/vercel-labs/agent-eval · evalite.dev(`/guides/scorers`)· v1.evalite.dev/tips/vercel-ai-sdk · langfuse.com(changelog/2025-09-17-experiment-runner-sdk、prompt-management/get-started、prompt-management/features/prompt-version-control)· npmjs.com/package/langfuse

**Mastra**:mastra.ai/docs/deployment/cloud-providers/cloudflare-deployer · mastra.ai/docs/agents/structured-output · mastra.ai/blog/using-ai-sdk-with-mastra

**LangChain / LangGraph.js**:docs.langchain.com/oss/javascript/langchain/structured-output · github.com/langchain-ai/langchainjs/issues/9426 + pull/9434 · github.com/langchain-ai/langgraphjs/issues/1692 · langchain.com/{langsmith/evaluation,resources/ai-agent-frameworks}· docs.langchain.com/langsmith/evaluate-graph

**VoltAgent**:voltagent.dev/blog/vercel-ai-sdk/

**Cloudflare 官方文档/changelog**:developers.cloudflare.com/agents/(`/`、`/runtime/agents-api/`、`/harnesses/think/lifecycle-hooks/`、`/api-reference/codemode/`、`/tools/codemode/ai-sdk/`)· `/changelog/post/{2025-12-22-agents-sdk-ai-sdk-v6,2026-02-17-agents-sdk-v0.5.0,2026-07-23-ai-sdk-v6-v7-support,2025-03-25-higher-cpu-limits}/` · `/workers/{platform/limits,platform/pricing,wrangler/configuration}/` · `/workers-ai/configuration/ai-sdk/` · `/durable-objects/{best-practices/websockets,platform/pricing,best-practices/rules-of-durable-objects}/` · `/containers/{faq,platform-details/architecture}/`

**npm**:npmjs.com/package/@cloudflare/codemode

**undici / Node SSRF**:github.com/nodejs/undici/issues/2019 · advisories.gitlab.com/npm/@budibase/server/GHSA-v42f-v8xc-j435/

**Genkit**:genkit.dev/ · genkit.dev/docs/js/deployment/any-platform/

**Claude Agent SDK**:code.claude.com/docs/en/agent-sdk/hosting · platform.claude.com/docs/en/agent-sdk/hosting

**OpenAI Agents SDK JS**:openai.github.io/openai-agents-js/extensions/cloudflare/ · developers.openai.com/api/docs/guides/agent-evals · deepeval.com/integrations/frameworks/openai-agents

**Inngest AgentKit**:github.com/inngest/agent-kit(gh api + npm view 当场核实停更)

**BeeAI**:framework.beeai.dev/modules/templates · research.ibm.com/projects/bee-ai-framework · github.com/i-am-bee/beeai-framework

**框架全目录枚举来源**:github.com/caramaschiHG/awesome-ai-agents-2026 · github.com/ARUNAGIRINATHAN-K/awesome-ai-agents-2026 · docs.elizaos.ai/ · dust.tt/blog/ai-agent-development-frameworks

---

*报告作者:综合席(Sonnet)。§八 Sources 按章节/厂商**聚合**,不是逐条 claim→URL 映射。"框架/平台/库 有/无能力 X"类断言多数能在对应章节的 source 块里找到出处,但**没有**做到任务书 §六要求的逐条可审计引用——这是已知局限,本修订不补做映射。仓库内部计数(行数、test 函数)的可复现口径见 Scope 8;`662` 与 `6` 的路径与命令见 Scope 2 / Scope 8 与任务书 `[^baseline-numbers]`。REFUTED 断言已剔除结论,UNVERIFIED 断言已降级进 open questions。2026-08-21 口径修订:已核证据止于 AI SDK v6,v7 缺口见 §五。*

---

## 九、补充调研(2026-08-18):对"零等价物"断言的反向复查

本节是**补充复核**,与 §一头部 / §六的初始复核统计分列,两组数字不得加总或改写对方。被本节修订的正文结论(评分表第 5 行、Scope 2、Wave 0、SSRF 运行时范围)以本节为准。

**触发**:owner 质疑第二节 scope2(eval evaluator)与 scope5(SSRF)两条"TS 生态零等价物"断言下得太快。本节以反向偏置(拼命找现成货推翻断言)重跑 6 路搜寻 + 1 轮独立复核判决(5 项候选抽查:2 HOLDS / 1 OVERSOLD / 2 WRONG),结论:两条断言均未被推翻,但断言 A 的严重程度需下修,断言 B 意外获得了比原报告更具体、更新的证据,同时浮现一个未经验证的运行时错位问题。

**方法**:6 个搜索角度(agentevals+langsmith-sdk 交叉核查、Mastra Scorers、eval 生态扫盘、npm SSRF 库枚举、undici 自身 API 演进、workerd 运行时错位检查),每个候选当场读 primary source(GitHub 源码/npm registry/官方文档),不采信营销页/摘要。产出的"最强候选"再过一轮独立复核判决(HOLDS/OVERSOLD/WRONG 三档);诚实原则:OVERSOLD/WRONG 不得计入 REFUTED 依据。

### 断言 A:pydantic-evals 5 个官方 agentic evaluator 在 TS 生态零等价物

**裁决:WEAKENED**(非 REFUTED,非 STANDS)。

逐评估器复核结果(仅将独立复核判为 HOLDS 的部分计入正面证据):

| 评估器 | 现成候选 | 复核裁决 | 覆盖程度 |
|---|---|---|---|
| ToolCorrectness | `agentevals`(npm 0.0.7,2026-03-03)`createTrajectoryMatchEvaluator({trajectoryMatchMode:'unordered'\|'superset'})` | **HOLDS** | Counter 多重集+allow_extra 语义逐行同构验证(js/src/trajectory/unordered.ts+superset.ts vs pydantic_ai agentic.py 191-244行) |
| MaxToolCalls | Mastra `checks.maxToolCalls`(@mastra/evals 1.7.0,2026-08-05) | **HOLDS** | `passed: tools.length<=max` 与官方 `tool_count<=max_calls` 边界语义逐字对齐(含等于阈值场景) |
| ArgumentCorrectness | `agentevals` 内部 `_exactMatch`/`_supersetMatch` | 部分(未独立复核) | 算法形状与官方 `_diff_arguments` 同构,但为私有函数、未在 index.ts 导出,需自抄 ~15 行胶水;复核发现候选原文把 `_subsetMatch`/`_supersetMatch` 方向说反,不影响"私有算法存在"这一结论 |
| TrajectoryMatch | `agentevals` strict/unordered/subset/superset | 部分 HOLDS | 仅覆盖 `order='exact'` 布尔判定;pydantic **默认**模式(`in_order` LCS-F1、`any_order` multiset-F1)是连续 [0,1] 打分,agentevals 全部模式只返回布尔——这条渐进评分算法六路搜寻全部零命中(agentevals/Mastra/promptfoo/Evalite 均确认无等价) |
| MaxModelRequests | 无 | 排除 | 6 路搜寻(含 Mastra 全站文档搜索)零命中,唯一"确认无等价物"的评估器 |

关键反转:原报告列为"关键语义"的 **ANY-of-N 析取匹配,核实后不是 pydantic-evals 官方类自带语义**——是 animichi 自己在 `apps/agent/src/animichi/tests/eval/official_evaluators.py` 里对官方类包的 userland wrapper(docstring 原话:"preserves the dataset's ANY of N contract **without changing the official evaluator implementations**")。这意味着原始"零等价物"论证部分建立在对 pydantic-evals API 面的误读上:TS 侧同样只需原样包一层循环,不构成框架级缺口。

Mastra `trajectory-accuracy` scorer 复核为 **OVERSOLD**(非 WRONG):序列排序能力(strict 布尔/relaxed 连续分)真实存在,但候选描述的 `toolArgs` 参数匹配读源码后只是脆弱的 `JSON.stringify` 精确相等(无 subset 模式,需显式设 `stepType` 才触发),比对标对象(ArgumentCorrectness 默认 subset 语义)窄得多——候选把"算法未公开"列为 gap,实际是"算法已确认存在但明显更弱",属覆盖面被夸大而非无货。

**结论**:五个评估器里 2 个(ToolCorrectness、MaxToolCalls)有独立验证为真的现成等价物,1 个(ArgumentCorrectness)有算法级对应但需自抄私有代码,1 个(TrajectoryMatch)仅默认模式外的 exact 子集被覆盖,1 个(MaxModelRequests)确认零等价物。"零等价物"作为 5/5 全称判断不成立,但"存在完整、无成本的现成替代"同样不成立——两个极端表述都需要改写为上表这种逐项分级。

### 断言 B:Node/undici 无一等 SSRF/connect-time IP pinning 方案

**裁决:STANDS(且被强化)**,但需要一条重要的运行时范围限定(见下)。

npm 候选枚举(request-filtering-agent/ssrf-req-filter/ssrf-safe-fetch/dssrf/ssrf-agent-guard)逐一核查,结果与原报告一致:要么只挂传统 `http.Agent`(对 undici/native fetch 无效——`request-filtering-agent` 维护者自己在 README 承认并链接 open 3年+ 的 issue #23),要么是教科书式 TOCTOU(`ssrf-safe-fetch` 源码直读证实校验用的 hostname 与真正连接时重新 DNS 解析的 hostname 是同一个,无 pinning)。

本轮"最强候选"——业界推荐为"正确写法"的 `undici Agent({connect:{blockList}})` + Node 原生 `net.BlockList`(含被引作生产先例的 papra-hq PR #1099,2026-05-17 合并)——过独立复核判决为**双双 WRONG**:
- 源码追踪(`lib/core/connect.js` vs `lib/internal/tls/wrap.js` 的 `TLSSocket` 构造选项白名单)+ 本机 Node v24.18.0/undici@7.29.0 活体实测证实:`blockList` 只在明文 HTTP 路径生效,**HTTPS 路径被 TLSSocket 构造函数的显式选项白名单静默丢弃**——同一 Agent 对 `http://127.0.0.1` 正确抛 `ERR_IP_BLOCKED`,对 `https://127.0.0.1` 直接连通。这是一个此前未被任何 issue/CVE 记录过的 Node 核心级静默绕过,恰好命中 SSRF 现实攻击面的主战场(HTTPS)。
- papra-hq PR #1099 被当作"生产可行"证据引用,复核读其测试套件(`webhooks.usecases.test.ts`)发现全部断言用例测的是**注册时预检(preflight)层**,而非 connect-time blockList 层是否真的拦下 HTTPS 连接——测试盲区与上一条发现的漏洞完全吻合,该"先例"实际上是把同一个失效模式带进了生产代码。

**结论**:原断言不仅站得住,本轮还补上了比原报告(仅引用 open issue + 一个 CVE)更具体、更新、可复现的证据链,包含一个新发现的 Node 核心级 silent-bypass。

**重要限定——运行时可能问错了对象**:workerd(Cloudflare Workers 运行时)的 `Network.allow` 默认 `["public"]`,config schema(`workerd.capnp`)doc comment 原文"prevent SSRF attacks",官方博客原文"totally immune to SSRF attacks",TCP sockets 文档独立佐证 hosted 产品行为一致——三个独立 primary source 互相印证:workerd 在网络层(而非应用层)默认只放行公网可路由地址,架构上没有"JS 先校验、runtime 再重新解析连接"的两段式管线,Node/undici 这整类漏洞在 workerd 上没有对应攻击面。**此候选未进入本轮复核判决的 5 项抽查(无 HOLDS/WRONG 裁定),不能提升为确认事实**,但证据强度足以要求:若 Scope 6 已倾向的 Workers 部署最终确认,断言 B 讨论的"undici 低层重建"这套工程量,主战场可能从来不该是 Node/undici 层——**B 断言本身没错,但可能问错了迁移目标的运行时对象**,需要专项 spike 而非直接假设"Workers 天然安全"划掉这项成本(CGNAT/云元数据 IP 覆盖、redirect 链逐跳复核均未实测)。

### 对第二节评分表的修订

| # | 维度 | 原分 | 修订分 | 理由 |
|---|---|---|---|---|
| 5 | Eval 生态对齐 | 3/10 | **5/10** | ToolCorrectness+MaxToolCalls 有独立验证为真的现成等价物(agentevals+Mastra checks),ArgumentCorrectness 算法级对应但需自抄私有代码,TrajectoryMatch 仅 exact 子集覆盖(默认渐进 F1 模式仍零等价),MaxModelRequests 确认零等价物;`agentevals` 硬依赖 langchain/@langchain/openai/langsmith 是真实安装摩擦,不是零成本迁移 |
| 7 | BYOK 多 provider | 3/6(含"3-5倍工程量,undici 无一等方案") | **维持 3/6,加注运行时分支** | Node/undici 层结论不变(甚至加固——新发现 blockList 对 HTTPS 静默失效);若最终确认 Workers 部署(呼应 Scope 6 的 6/6 结论),workerd 平台层默认 SSRF 防护可能大幅收窄该项成本,但该证据未过独立复核,**需 Wave-0 Spike D 实测后才能改分**,当前不预先下修 |

### 对第四节成本表的修订

- **eval 基础设施(非测试)行**:"同量级从零重建——无 TS 候选覆盖 5 个官方 agentic evaluator"改为"**收窄重建**——ToolCorrectness/MaxToolCalls 可基于 agentevals/Mastra 现成布尔匹配原语搭建(仍需补 spans→messages 转接层,工程量降档但非零);TrajectoryMatch 默认渐进 F1 打分算法仍需从零手写(唯一残留的算法级硬缺口);MaxModelRequests 从零手写(唯一确认零等价物的完整评估器);ANY-of-N 循环包装 TS/Python 两侧同等成本,不是额外负担"。
- **BYOK egress/SSRF 守卫行**:估算"3-5 倍工程量,1-2 周"加两条运行时分支注记:**若 Node 容器部署,估算维持不变、甚至应上修**——新发现的 TLSSocket silent-bypass 意味着"connect:{blockList}"这条本被认为最省事的路径实际不可用,需要更复杂的自定义 connect hook 或双重校验;**若 Workers 部署,该行成本可能大幅下修**至"应用层策略(own-infra 拒绝表+响应体上限)"量级,但此分支需 Spike D 验证,当前表格数字暂不改动。

### 对 Wave 0 三个 spike 的影响

- **Spike A**(undici IP-pinning demo + DNS-rebinding 测试):原定目标"把'官方无推荐模式'从 medium confidence 提到可执行结论"**已被本轮完成且强化**(新发现 TLSSocket silent-bypass,含可复现实测脚本)。剩余工作改形为:若仍走 Node 路线,需设计并验证一个 HTTP+HTTPS 都生效的 connect-time 方案(候选:自定义 `lookup`+手动 pinned connect,或 `'connect'` 事件 post-check——后者 Firecrawl 实测有私网段遗漏史,需专项覆盖);若确认 Workers 路线,Spike A 由新增的 Spike D 取代,不再需要单独执行。
- **Spike B**(手工复刻 1 个官方 evaluator 验证分数与 Python 基线一致):工作量从"从零手写整套匹配算法"降档为"基于 `agentevals` 现成 `unordered`/`superset` 布尔匹配原语,补一层 span→messages 转接,对 ToolCorrectness 做双跑核对";应在 spike 中一并回答新增 open question——animichi 的 gate 逻辑是否依赖 TrajectoryMatch 默认模式的连续 F1 分数(而非布尔阈值),若依赖则 LCS/multiset-F1 打分算法仍需专项开发,若不依赖(仅用布尔阈值即可)则该缺口可忽略。
- **Spike C**(LangChain.js `handleError` 业务语义校验):不受本轮(§九)影响,维持原计划不变。2026-08-21 口径修订把 **AI SDK 7 完整能力评估**也挂到 Spike C(见 §五 / §七),不改写本节对 §九 的结论。
- **新增 Spike D**(workerd 平台 SSRF 边界实测):部署探针 Worker,对 `10.x`/`169.254.169.254`/`100.64.0.1`(CGNAT)/`100.100.100.200`(阿里云元数据 IP)发起 `fetch()`,确认默认 `Network.allow=["public"]` 是否真的挡下这些目标;同时验证 redirect 链跨 IP 时是否逐跳复核同一策略。此 spike 结果直接决定第二节 #7 行与第四节 BYOK egress 行是否需要进一步下修。

### 新增 Sources

`github.com/langchain-ai/agentevals`(js/src/trajectory/{unordered,superset,strict,utils}.ts、js/src/index.ts、js/package.json)· `registry.npmjs.org/agentevals` · `github.com/pydantic/pydantic-ai`(pydantic_evals/pydantic_evals/evaluators/agentic.py)· `apps/agent/src/animichi/tests/eval/official_evaluators.py`(本仓库)· `mastra.ai/reference/evals/{trajectory-accuracy,scorer-utils}` · `mastra.ai/docs/evals/built-in-scorers` · `mastra.ai/blog/mastra-scorers` · `github.com/mastra-ai/mastra`(packages/evals/src/scorers/{code/trajectory/index.ts,utils.ts,code/checks/index.ts})· `registry.npmjs.org/@mastra/evals` · `github.com/promptfoo/promptfoo/blob/main/src/assertions/trajectory.ts` · `github.com/nodejs/undici/blob/main/lib/core/connect.js` · `github.com/nodejs/node/blob/main/lib/{net.js,internal/tls/wrap.js}` · `github.com/papra-hq/papra/pull/1099`(+ webhooks.http-client.ts、webhooks.usecases.{ts,test.ts})· `raw.githubusercontent.com/cloudflare/workerd/main/src/workerd/server/workerd.capnp` · `blog.cloudflare.com/workerd-open-source-workers-runtime/` · `developers.cloudflare.com/workers/runtime-apis/tcp-sockets/` · `developers.cloudflare.com/workers-vpc/configuration/vpc-networks/` · 本地可复现空跑实测脚本(blockList 对 HTTP/HTTPS 行为差异)

