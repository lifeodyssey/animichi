# Research Brief — agent TS 化对标复查(SD-4 重开候选)

- Status: OPEN(owner 授权重开对标 2026-08-17;调研票 = #1106,`wayfinder:research` + `ready-for-agent`)
- 本文件为权威任务书;#1106 的 body 是它的索引副本,分歧以本文件为准。
- 性质:**调研票,不是翻案本身**——产出报告后由 owner 决定是否正式重开 SD-4。
- 与 #1046(Migration Executor × CI Secrets 归零)**明确解耦**:迁移执行器的方案选择不等待本调研。

## 一、背景:被重开的决策与它的原始依据

SD-4(`docs/specs/2026-07-06-frontend-rebuild-inputs.md:227`)定案 agent 运行时 = Python FastAPI 容器,"不再议"。原文依据:

> 基于 TS agent SDK 对标调研的知情决定:Vercel AI SDK 50/60 可行但需自养 ~100 行重试基建,pydantic-ai 的 ModelRetry + output_validator 护城河保留。

即当年的护城河 = 两个"校验失败自动回喂模型"的闭环:① 工具层 `raise ModelRetry` → 错误作为 tool result 回喂;② 输出层 `output_validator` 校验类型化输出、失败自动回喂重试。

对标是**移动靶**:13 个月后的初步复核(下节)显示差距已收窄一半,且成本大头发生转移——故重开。

## 二、2026-08-17 初步核查(已验,含来源)

| 闭环 | pydantic-ai | AI SDK v6/v7 现状 |
|---|---|---|
| 工具执行出错 → 回喂模型继续 | 内建 | **已补齐**:多步循环(`stopWhen`)里 tool 执行错误作为 `tool-error` part 自动回传([tools-and-tool-calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)) |
| 工具输入无效 → 回喂修复 | 内建 | **半补齐**:`repairToolCall` 已转正 + 官方 re-ask 策略示例(~40 行,钩子需自填、非默认开启) |
| 最终输出校验失败 → 回喂重试 | 内建(`output_validator`) | **仍缺**:`Output.object()` 校验失败抛 `NoObjectGeneratedError`,官方教 try/catch 自包(~30-50 行);`maxRetries` 仅网络层指数退避([generating-structured-data](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data)) |

- AI SDK 6 已统一"工具循环 + 末端结构化输出"(当年需 `generateText`/`generateObject` 手工串接;`generateObject` 现已 deprecated,统一到 `generateText` + `output`)([AI SDK 6](https://vercel.com/blog/ai-sdk-6))。
- CF Agents SDK 定位 = **运行时层**(Durable Objects 状态 / 调度 / `needsApproval` / WebSocket),模型编排层就是 AI SDK(v0.3.0 起对齐 v6,[changelog](https://developers.cloudflare.com/changelog/post/2025-12-22-agents-sdk-ai-sdk-v6/));其 v0.5.0 `this.retry()` 为网络层指数退避,**非**校验回喂([changelog](https://developers.cloudflare.com/changelog/post/2026-02-17-agents-sdk-v0.5.0/))。
- 小结:重试基建差距 ~100 行 → ~50 行。**预期的最大成本项已不在重试基建,而在 eval 体系绑定**(实测 662 case + pydantic evals 官方 runner + SD-30 双轴评估 + official-v1 八指标签核基线,2026-07-18 校准;任务书起草时写的是 617,来源不明,以报告实测为准)。

## 三、调研范围 = 全部当前绑定(不只当年决胜项)

1. **重试/校验闭环**:输出层回喂在 AI SDK 的实现成本与稳健性(含 streaming 下的 partial validation)。
2. **eval 体系**:TS 侧候选(Evalite / Braintrust / AI SDK testing / Logfire Experiments / 其他——枚举)迁移成本与基线重建方案。预期最大成本项。
3. **streaming**:评估现有手搓 SD-9 帧编码与 TS 原生 API 的等价性(生产代码从未使用 pydantic-ai 的 `VercelAIAdapter`,只用同包更底层的 `response_types` 手搓帧);typed output 渐进流验证。
4. **harness capabilities**(按生产绑定三分,不以 harness 包名为准):
   - **生产必需**:`memory` 与 `compaction`(pydantic-ai-harness 生产实际绑定的仅此两项)。
   - **已退役**:ManagedPrompt(生产零绑定)。
   - **候选能力**:CodeMode 只在 `spikes/codemode/`、从未进入 `build_animichi_agent()`;`AgentCapability` / `Hooks` / `CombinedCapability` 来自**原生 pydantic-ai**,不是 harness。CF Think harness / `@cloudflare/codemode` 只作为候选对照,不计入生产迁移验收。
5. **BYOK 多 provider**(SD-11):三家族(OpenAI-compat / Anthropic / Gemini)per-request override 的 AI SDK 等价。
6. **运行时形态**:Workers vs CF Agents SDK(DO 基座);agent 容器退役的收益量化(X2 保温 SLO 消解、部署面简化)vs Workers CPU/时长约束对 agent loop 的适配。
7. **框架全目录枚举**(规矩:先枚举厂商全目录,不预设清单):AI SDK ToolLoopAgent、CF Agents SDK、Mastra、LangGraph.js、OpenAI Agents JS、VoltAgent、其他。
8. **迁移成本**:实测 **23,563 生产行 + 47,967 测试行 / 1,815 个 `def test_` / 6 个模型工具**,逐项估算。[^baseline-numbers]
9. **编排影响**:与 #1046 解耦(已定);若 go,迁移链终局 = Atlas → Drizzle schema.ts 一次性切换(单语言仓库中 schema.ts 单源天性合法,无需"手写 SQL 军规"中间态)。眼下保 Atlas 即是对本调研两种结论都兼容的实物期权(2026-08-17 编排结论,详见 memory / #1046 侧讨论)。

## 四、交付物

- 调研报告落 `docs/specs/`:SD-4 式评分对比表 + go/no-go 建议 + 若 go 的分波次迁移草案。
- 报告走 spec 双评审(per `docs/workflow.md`)后交 owner 决策是否正式重开 SD-4。

## 五、Non-goals

- 不写任何实现代码;不动 #1046 战役;不重开 SD-9 / SD-11 本身。

## 六、验收标准

- [ ] 9 项 scope 每项有结论;"框架 X 有/无能力 Y"类断言全部附**当场核查**的 primary source 链接(不得凭训练记忆)。
- [ ] go/no-go 建议 + 迁移成本区间。
- [ ] owner 决策(重开或维持 SD-4)记录在 #1106 评论。

[^baseline-numbers]: 任务书起草时写的是 617 eval case / 800+ tests / 7 tools / ~30.6k 行 Python,来源不明。报告 Scope 8 用 `git`/`wc -l`/`def test_` 实测后取代这些数字;旧数字本身是调研结论之一(口径对不上),不是仍可用的规划基线。
