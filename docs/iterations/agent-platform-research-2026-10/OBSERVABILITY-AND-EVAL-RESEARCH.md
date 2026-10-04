# 可观测性与评测调研（2026-10-03）

状态：调研记录，不是决定。2026-10-03 由一个九 agent 的 workflow 产出：四路调研（pi 自身、成熟项目可观测性、
成熟项目评测、本仓库现状），每路各配一个核验 agent 重新打开每条出处、换关键词重搜每条"未找到"，最后一路汇总。
只收录核验为 confirmed/corrected 的结论（corrected 取更正后说法）。§6 的 owner 问题待定；决定落到
`docs/agents/owner-decisions.md`，提炼出的学习落到 `docs/agents/agent-and-eval.md`。§8 是主会话事后复核。

记法：本仓库文件写 `路径:行`，同一文件再次出现只写文件名；node_modules 内的 pi 包写 `包名 dist/...`；pi 上游
earendil-works/pi 写 `pi@commit 路径:行`；其他上游仓库的路径以 `/` 接在仓库简称后（`genai/docs/...`，genai =
open-telemetry/semantic-conventions-genai@e07f4eb）。标签：[事实]；[建议]=来源的建议；[推断]=我们的推断。

## 1. pi 自己提供什么

可观测性
- [事实] pi-telemetry 0.87.1 是契约不是管道：callback 式 TelemetryContext、NOOP/InMemory 参考适配器、typed schema、adapter conformance 套件；不带 exporter，buffering/flush/sampling/backend id 全归应用自写的适配器。node_modules/.pnpm/@earendil-works+pi-telemetry@0.87.1/node_modules/@earendil-works/pi-telemetry/README.md:11,13,132
- [事实] pi-agent-core 0.87.1 声明 12 个 `pi.*` span（pi.ai.request、pi.harness.run/turn/step/tool/hook…、pi.session.write），运行时只启动 pi.harness.hook，startAiSpan 零调用点，pi-ai 仅透传 telemetryContext；上游自述 "declared, largely unimplemented"，无 trace carrier API。接入缝只有每次调用传 withTelemetryContext；本仓库从未调用，一律 BACKGROUND_CONTEXT。 packages/eval/node_modules/@earendil-works/pi-agent-core/dist/harness/hooks.js:256；pi-ai dist/api/simple-options.js:19；pi@f29ea3de packages/agent/docs/harness.md:1238；telemetry.md:71,207； workers/edge/src/agent/host/session-agent.ts:58,76,112
- [事实] 原生信号：28 种被动事件（`run_end/turn_*/tool_*/retry_*/usage/fault`）、11 个 hook、持久 usage ledger（每次 settled provider attempt 一行，scanUsage 按 seq 追补）、每条消息 Usage/cost；事件不重放，崩溃后只剩 ledger；作者说 cost 是 best-effort，不适合精确计费。pi-agent-core dist/harness/agent-harness.d.ts:206-420；pi@f29ea3de harness.md:341,346,1146；mariozechner.at/posts/2025-11-30-pi-coding-agent/
- [事实] 上游走向：2026-10-01 pi-agent-core 1.0.0 删除 harness 与 telemetry schema，后继 pi-durable 1.0.0 零 telemetry 代码。github.com/earendil-works/pi/commit/7fd478a2e888；pi@9fba660 packages/agent/CHANGELOG.md:9
- [建议] span 属性只放 id/名称/计数/时长/状态/usage；prompt、工具参数、凭据走 events/hooks。pi@f29ea3de harness.md:1249；pi-telemetry README:389
- [推断] 今天接 adapter 只得到 hook span；run/turn/tool/usage 可见性只能由 harness.events + ledger 自行映射成 span，这样也不绑定 pi 的版本线。据 hooks.js:256、harness.md:1146、commit 7fd478a2e888。

评测
- [事实] 发布的原语：fauxProvider（确定性脚本 provider，FauxResponseFactory 可断言请求）、Storage/SessionRepo conformance 与 benchmark（InstrumentedStorage/GatingStorage，本仓库已对 Neon 跑）、telemetry adapter conformance。 packages/eval/node_modules/@earendil-works/pi-ai/README.md:1256； packages/pi-session-neon/test/storage-conformance.db.test.ts:3,15
- [建议] pi 自家规则：agent 测试用 faux provider，禁真实 API/key/网络/付费 token，live e2e 单独跑；写序断言用 InstrumentedStorage spy 而非 durable log。pi@9fba660 packages/coding-agent/test/suite/README.md:8；pi@f29ea3de harness.md:1399-1412
- [事实] pi 自己的 agent 级 eval 包私有未发布：vitest-evals + 每次新 Docker 容器，只用确定性 judge（StructuredOutputJudge、ToolCallJudge、Levenshtein），默认每 variant 1 次，报告 pass-rate/lift/mean-delta/flaky，无 pass@k/pass^k/置信区间。pi@9fba660 packages/evals/README.md:3,57-65；src/report.ts:355,380-401
- [建议] "One repetition cannot establish stability"；低分是数据不是基础设施故障；缺 telemetry 报 unavailable 不报 0。 packages/evals/README.md:103,105,129
- [推断] 留给集成方：pass^k 等统计、LLM judge、数据集、可复用 reporter、record/replay（pi 无 VCR，上游全文检索 cassette/vcr 无命中）。据上两条及 pi-ai README:1256。

## 2. 成熟项目可观测性共识

- [建议] 每轮一条 trace：invoke_agent → 每次模型调用一个 chat span → 每个工具一个 execute_tool span，OTel GenAI、Cloudflare Agents、AI SDK v7、Pydantic AI、OpenAI、Langfuse、OpenInference 一致；Langfuse 反对把整个循环裹成一个 generation。 genai/docs/gen-ai/gen-ai-agent-spans.md:549-559； langfuse.com/docs/observability/best-practices.md
- [事实] 模型调用 span 记请求/实际模型、provider、input/output/cache/reasoning tokens、finish reason、首块时延、error.type；cost 不在 OTel 标准（PR #443 仍 open），由后端按 model+tokens 算（Langfuse、Phoenix）或客户端上报（OpenInference `llm.cost.*`、Pydantic operation.cost）。 genai/docs/gen-ai/gen-ai-spans.md:64-100；gen-ai-token-metrics.md:32-34
- [建议] 关联：会话 id（gen_ai.conversation.id/session.id/group_id）串多轮，工具带 call id；OTel 只许用应用已有的 id，禁止拿 UUID/trace id/hash 凑。genai gen-ai-spans.md:149-153
- [事实] 消息与工具载荷各平台都有开关，默认分裂：OTel、Cloudflare Think/wrapAISDK 默认关，pi 不放；AI SDK、OpenAI Agents、Pydantic AI、OpenInference 默认开。OTel 推荐生产用外存+引用，引用约定仍 TODO。genai gen-ai-spans.md:1295-1314,1383； ai-sdk.dev/docs/ai-sdk-core/telemetry.md:76； openai-agents-python/docs/tracing.md:151
- [事实] 采样基本是 trace 级 head sampling，tail 要缓冲或 collector；保留期短：Cloudflare 7 天，Logfire 30-90 天，Langfuse 按计划，Phoenix 默认无限；Cloudflare 2026-12-01 起持久化日志/trace 计费。 developers.cloudflare.com/workers/observability/traces/；pydantic.dev/pricing.md； langfuse.com/docs/administration/data-retention.md
- [建议] 脱敏：Logfire scrubbing 自称 backstop；Langfuse mask 在应用侧、只影响本 exporter、抛错丢整批；OpenAI 要求 redaction 与投递在同一 exporter；Cloudflare 有 observability.redactQueryString（默认 false）。Serverless 用 ctx.waitUntil 显式 flush。 pydantic.dev/docs/logfire/instrument/typescript/scrubbing/； langfuse.com/docs/observability/features/masking.md； openai-agents-python/docs/tracing.md:171； pydantic.dev/docs/logfire/instrument/typescript/packages/cloudflare/
- [事实] trace→评测：评分是事后新记录指回 trace/span/session（OTel gen_ai.evaluation.result 事件、Langfuse Score、OpenInference carrier span + Span Link）；各平台都有"坏生产 trace 升级进数据集"路径。genai gen-ai-events.md:404-415；github.com/Arize-ai/openinference/spec/annotations.md:116； langfuse.com/docs/evaluation/experiments/datasets.md:562-606
- [事实] 标准 vs 厂商：标准只有 OTLP、W3C trace context、OTel trace 模型；`gen_ai.*` 全是 Development，无 tag 无 release，命名仍在改（cache_creation→cache_write、client.token.usage→`inference.usage.*`、gen_ai.system→provider.name），OTel 自己说勿对 Development 信号做长期依赖。厂商侧：Logfire Agents view 按 invoke_agent 识别；Pydantic AI 自加 `gen_ai.aggregated_usage.*` 防双计；OpenAI trace/span_data 非 OTel；Cloudflare Workers Traces open beta、名称未定、无 OTel API、custom span 无 spanContext()、不向 Cloudflare 外传播（service binding/DO 之间 2026-05-07 起自动传播）；Cloudflare 自家 agents SDK 把 `gen_ai.*` 名集中一张内部表吸收改名。genai README.md:7；CHANGELOG.md:3；github.com/open-telemetry/opentelemetry-specification versioning-and-stability.md:75-81； developers.cloudflare.com/workers/observability/traces/known-limitations/；developers.cloudflare.com/changelog/post/2026-05-07-automatic-tracing-across-do-and-worker-subrequests/； workers/edge/node_modules/agents/dist/observability/ai/index.js:33-37

## 3. 成熟项目评测共识

李博杰《深入理解 AI Agent》第 7 章（github.com/bojieli/ai-agent-book@dc2fd304 book/chapter7.md，下列只写行号）
- [建议] 评估对象是模型+Harness 组合体；固定 Harness 换模型看分差。:17,19
- [建议] 环境五要素（数据集、状态、工具、rubric、交互协议），每次回到同一起点；副作用操作在沙盒采样、每次失败计入。:164-180,160
- [建议] Pass@k 看天花板，Pass^k 才是支付/退款/部署级可靠性（p=0.6、k=5：99% 对 7.8%）。:158
- [建议] 验证器核实机器可复核事实而非 agent 自述；能写断言就断言，LLM 只判无法机械判定的维度；多模型家族评判；rubric 带一票否决。:224,302,404,320
- [建议] 公开基准只粗筛，产品决策靠自建业务集和生产回流（轨迹→脱敏→新用例）；提示词当代码跑回归；归因首个偏离错误，记录保存目标、环境、agent 版本、工具版本、完整轨迹。:280-286,714,813,436,460
- [建议] 两层回归：端到端 + 轨迹前缀（截到首错前，答案是可接受动作集+禁止动作，确定性规则评分）；高可靠生产 agent 前缀集更重要，但不能替代完整回放。:515-533；ai-agent-book@73ffc0d7 chapter7/user-memory-policy-eval/README.md:81
- [建议] n=100、p=70% 置信区间约 ±9pp，73% 对 70% 不足以切换；配对分析（McNemar/配对 bootstrap）、3-5 seed；超噪声+配对成立+可复现才切换；分数下降先查评测系统；子集结果只换来更大的测试。:680,682,696,726,758
- [建议] 环境漂移：AWorld 用可重放 MCP 沙盒避免封禁，OSWorld 锁版本+离线备份。:833,266
- [事实] 第 7、9 章对"进程内 vs 部署"的 SUT 没有立场（两轮关键词复核均无）。

SUT 边界
- [事实] 所有来源 SUT=harness+model（Anthropic "the harness and the model working together"，Sierra "product behind its agent interface"，Logfire 的 task 是任意函数）；Anthropic 的离线台架标准是与生产 agent 行为大致一致、每 trial 干净环境，可 "without deploying to production" 跑，但 agentic eval 是端到端系统测试，Terminal-Bench 2.0 仅资源差异就 6pp。anthropic.com/engineering/demystifying-evals-for-ai-agents；anthropic.com/engineering/infrastructure-noise； github.com/sierra-research/tau2-bench/docs/leaderboard-submission.md:33-36
- [事实] 没有来源把部署的 staging 当 PR 回归套件的 SUT；staging 只出现为 LangSmith preview deployment + 在线评测门控、Logfire/Braintrust 采样在线评测、OpenAI Realtime 指南的人工 review、Braintrust 的状态快照来源。docs.langchain.com/langsmith/cicd-pipeline-example； braintrust.dev/docs/best-practices/agents
- [事实] 本仓库 2026-09-09 已定 SUT=进程内 agent：QA 身份、限速、测不到 PR 代码、662 case 跑 2.4-4h。 docs/agents/agent-and-eval.md:34-44

外部数据依赖
- [建议] 模拟/录制的理由分三类：副作用（LangSmith mock mode）、封禁/漂移（tau2 用 LLM 生成 mock DB 加单测）、成本（LangSmith pytest cassette，仅 Python）；测工具使用质量则保留真实（Anthropic 反对 toy sandbox，OpenAI MCP cookbook 直连 live server）。OpenAI Realtime 指南 "Mock tools deterministically"；Braintrust 离线用 production/staging 快照 stub、在线用真实环境。anthropic.com/engineering/writing-tools-for-agents；developers.openai.com/cookbook/examples/realtime_eval_guide； braintrust.dev/docs/best-practices/agents；docs.langchain.com/langsmith/pytest
- [事实] 活网最危险：BrowseComp 答案泄漏、URL 黑名单失效、agent 搜索留下永久痕迹；研究型 ground truth 随参考内容漂移。Inspect 只缓存模型输出，不缓存工具输出。anthropic.com/engineering/eval-awareness-browsecomp；inspect.aisi.org.uk/caching.html
- [事实] 本仓库硬矛盾：spec 要求真实 catalog 不 mock，eval 需要 CATALOG_API_URL，但 staging catalog 无 host，edge 只转发两条匿名 GET，本机起 catalog 会在 cache miss 时调 api.bgm.tv，仓库禁止。 docs/specs/2026-09-09-agent-on-pi-harness-spec.md:222； packages/eval/NATIVE.md:31-55； workers/catalog/wrangler.toml:82-85； packages/contract/src/public-catalog.ts:42-45；AGENTS.md:46
- [推断] catalog/web_search 只读，副作用理由不适用，漂移与活网泄漏适用；仓库已有两种模式（真实 catalog 端到端、deterministic-case-fixture 冻结前缀）。据 spec:222、packages/eval/AGENTS.md:52-58。

评分器
- [建议] 分层一致：代码/状态检查优先，LLM judge 只在代码判不了时用且对人工标注校准（OpenAI 用 TPR/TNR、20/40/40 切分）；给 judge "Unknown" 出口，验证器可拒绝评分。developers.openai.com/cookbook/examples/evaluation/building_resilient_prompts_using_an_evaluation_flywheel；anthropic.com/engineering/demystifying-evals-for-ai-agents；ai-agent-book@728bfaa3 book/chapter9.md:47
- [推断] outcome 与 process：Anthropic outcome-first（评产出而非路径，但 code grader 含工具调用校验）；tau2 在 airline/retail/telecom 只看结果，action matching 仅作诊断；书的前缀任务、pydantic TrajectoryMatch、agentevals 是路径感知。可调和为 outcome 定 pass/fail、路径作诊断或预算。据 anthropic demystifying-evals； tau2-bench/docs/evaluation.md:79-81,153-156； pydantic.dev/docs/ai/evals/evaluators/agentic/
- [事实] 对话 agent 需 LLM 用户模拟器；tau2 模拟器关键错误 12-13%（retail/airline）对 6%（telecom）。arxiv.org/html/2506.07982

统计 [建议] 都要重复，聚合分裂：pass^k（tau、书、Anthropic、Inspect 的 pass_k_{k}/ci_wilson/聚类 stderr）对 mean+spread（Braintrust trialCount、LangSmith num_repetitions、pydantic repeat）；Anthropic 另要报 SEM、聚类 SE、配对差分、功效分析。anthropic.com/research/statistical-approach-to-model-evals；inspect.aisi.org.uk/metrics.html。[推断] logfire/evals JS 只有 repeat + caseGroups，无 pass^k/CI/p 值；仓库 src/gate 已有 paired-bootstrap、clopper-pearson；33 case held-out 单次 pass 在 p=0.7 时约 ±15.6pp。据 github.com/pydantic/logfire-js@4406323d packages/logfire-api/src/evals/Dataset.ts:193、packages/eval/src/gate/、NATIVE.md:18。

基线 [事实] Braintrust experiment 不可变、持久基线、对照生产版本、<5pp 看均值；LangSmith 数据集每次改动自动版本化+tag，比较视图标出回归；Logfire 只有 UI Compare runs，JS renderReport 无 baseline 参数；tau3 修 50+/75+ 任务后 <1.0.1 分数不可比。 braintrust.dev/docs/evaluate/compare-experiments；docs.langchain.com/langsmith/evaluation-concepts； pydantic.dev/docs/logfire/evaluate/review-experiments/；logfire-js@4406323d packages/logfire-api/src/evals/render.ts；tau2-bench README.md:26。[建议] capability eval 毕业成接近 100% 的回归集；0% pass@100 多半是任务或 grader 坏了，保留 reference solution。anthropic demystifying-evals

在哪跑 [建议] 一致：离线/CI 每次改动（Anthropic、Braintrust GitHub Action、OpenAI continuous evaluation）、在线采样评测 staging/production、失败回流数据集；Logfire JS 在 Cloudflare Workers 只支持内存数据集与在线评测；OpenAI Evals 平台 2026-10-31 只读、11-30 关闭，官方迁到 Promptfoo 放代码/CI。 pydantic.dev/docs/logfire/instrument/typescript/evals/； braintrust.dev/docs/evaluate/run-in-ci； developers.openai.com/api/docs/deprecations

## 4. 差距表

（usage-meters = packages/pi-session-neon/migrations/app/20260913T1711_data_plane_baseline/usage-meters.ts）

| # | 维度 | 我们现在 | 成熟做法 | 出处 |
|---|---|---|---|---|
| 1 | 每轮 trace | 无应用级 span；pi telemetry 走 NOOP（0.87.1 本身也只发 hook span）；只有平台自动 span | invoke_agent→chat→execute_tool 每轮一条 | session-agent.ts:58；hooks.js:256；genai gen-ai-agent-spans.md:549 |
| 2 | 日志与关联 id | edge 11 个 JSON 事件无 session/turn/operation 字段；两个 edge_auth_* 事件却记完整路径（含 session id），违反 request.ts 自家规则；limiter 告警记 ip/用户 key；agent tier 自身不写日志（平台 invocation log 仍在，无 id）；catalog/users 无 caller id | 每个 span 带 conversation.id + tool call id | workers/edge/src/gateway/request.ts:33-55；responses.ts:38-40,61-63； workers/edge/src/protect/native-limiter.ts:31； workers/catalog/src/router.ts:125-143 |
| 3 | 模型/版本 | 模型只在 pi payload；/healthz 只回 {status:ok}；ServiceMetadata 无消费者；commit 以 deploy tag `sha-<SHA>` 发布（publish-services.sh:7），平台 trace 的每个 span 都带 `faas.version`（部署的版本标签），另有 `cloudflare.script_tags` 与 `cloudflare.script_version.id`（版本 UUID）；应用运行时自己读不到，缺的是模型与 prompt 版本 | response.model、prompt.version、service.version/release | workers/edge/src/agent/host/native-models.ts:11；request.ts:137-139； .github/scripts/release/publish-services.sh:7；developers.cloudflare.com/workers/observability/traces/spans-and-attributes |
| 4 | 成本/用量 | daily_usage 只有日×scope；BYOK 记 0 且与未定价不可分；data-usage 帧无消费者 | 每次 generation 记 usage，后端算 cost，ingested 优先 | usage-meters:20-29； workers/edge/src/agent/settlement/usage-charge.ts:3,10； workers/edge/src/agent/views/event-chunks.ts:19 |
| 5 | 采样/保留 | 四个 Worker 100% persist，12-01 起计费；pin 测试只看顶层块，env 覆盖发现不了 | 显式 head sampling 决策 | workers/edge/wrangler.toml:227-240； workers/edge/test/wrangler-toml.test.ts:99-110 |
| 6 | 脱敏 | SecretScrub 只用于视图投影，无日志/span 路径 | 应用侧 mask + backstop | workers/edge/src/agent/egress/secret-scrub.ts:7-9 |
| 7 | 导出管道 | LOGFIRE_TOKEN 绑定但无读者，却是部署硬门槛；ADR 定的 logfire-cf-workers 从未装；无 OTLP destination | 一条管道 + 显式 flush | wrangler.toml:73,334,526； infra/database-access/runtime-secrets.ts:25-28； docs/specs/2026-06-13-architecture-adr.md:111 |
| 8 | 故障/告警 | fault 只设 flag；provider 错误体被丢弃；仓库内无应用级告警配置，runbook 缺；dashboard 侧告警未核实（§7） | — | session-agent.ts:268； packages/agent/src/provider-fetch.ts:19-20； docs/ops/neon-backup-rpo.md:63-69 |
| 9 | 评估器 | 只注册 execution_pass + PassCaretK；六个必需断言无实现（next_action 有一个未接线、名字不同的 ExpectedActionPass），每次都 required-assertion-missing | 代码断言优先 + 校准 judge | packages/eval/src/native/native-run.ts:184-185；required-assertions.ts:25-33 |
| 10 | 模型一致 | eval 默认 mimo-v2.5，生产 pin mimo-v2.6-flash | SUT 与生产同配置 | native-run.ts:110；native-models.ts:11 |
| 11 | 数据集/基线 | 8 套 1208 case，loader 能全量跑的只有 heldout 33 和 input_guard 15（代码推断）；三套 suite pin 无 roster；无原生报告或基线，`packages/eval/results/` 与 `packages/eval/baselines/` 都是 Python 旧 SUT 的产物（results 来自 f4ac5f34a），报告默认写 tmp | 小集从真实失败起步、版本化；持久基线 | packages/eval/src/native/evaluation-dataset.ts:133-170；suite-pins.ts:48-92；native-run.ts:272-275 |
| 12 | CI/回流 | 无 eval 在 CI 或定时（nightly 随 Python 删，cecfc816a）；无真实模型 native run 验证；privacy.md 禁 collector 直到边界证明；staging smoke 只探 /healthz 与 SSR 外壳，不跑任何 agent 对话 | 每次改动离线评测 + 在线采样 + 回流 | docs/testing-strategy.md:380；NATIVE.md:118-120； docs/ops/privacy.md:34-37； .github/scripts/staging-smoke-check.sh:2-6 |
| 13 | 文档漂移 | tool-routing 说共享 Logfire dashboard；secrets.md 说 ZEN_GO 路由 mimo-v2.5；deployment.md 说 budget 0 关闭断路器（实际全拒） | — | docs/agents/tool-routing.md:25； docs/ops/secrets.md:163； docs/ops/deployment.md:297； workers/edge/src/agent/host/native-authority.ts:6-9 |

## 5. 可选方向

A. 先清理，不建新管道
- 做什么：LOGFIRE_TOKEN 要么给它读者要么解除 preflight 门槛；edge 日志补 operation_id，auth 事件不再记完整路径；定采样率与 persist；修 #13 文档，ADR 可观测性行改成现状。
- 解决：#2 部分、#5、#7 部分、#13。
- 代价：不增加每轮可见性。生产目前是 showcase 模式（#1975 跟踪），agent 遥测今天没有流量，推迟其余工作的即时成本低。 workers/edge/wrangler.toml:266,274
- 依据：§4 #5/#7/#13 出处； docs/ops/secrets.md:166。

B. 自建 pi 事件→GenAI span 映射，加一条导出管道
- 做什么：订阅 harness.events（run_end/turn/tool/usage/fault）与 ledger，自写 invoke_agent/chat/execute_tool span，`gen_ai.*` 名集中一表；conversation.id 用 Neon session id，operation id 作每轮属性；默认不记 prompt/工具载荷。管道二选一：(a) Workers custom spans + OTLP destination，与平台 trace 同一 id，可 persist=false，能否喂 Logfire 未核实；(b) @pydantic/logfire-cf-workers 的 instrument/instrumentDO，Logfire Agents view 直接识别，但与平台 trace 是两条 id。
- 解决：#1、#2、#3（模型与 prompt 版本；release 已由平台 span 的 `faas.version` 覆盖）、#8 部分，并给 #12 的回流一个载体。
- 代价与风险：`gen_ai.*` 仍 Development、还会改名；pi 1.0 已删 harness，映射器要独立于 pi 版本线；Workers Traces beta、custom span 64KB 上限、不向 Cloudflare 外传播；destination 配置在 dashboard 不在 Git。
- 依据：§1 [推断]；§2 标准/厂商段；developers.cloudflare.com/agents/runtime/operations/observability/tracing/（custom harness 自写三类 span）； developers.cloudflare.com/workers/observability/traces/custom-spans/。

C. 评测先补内容：评估器、模型对齐、首个原生基线
- 做什么：实现 tool_correctness/trajectory/data_keys/detection/admission 五个评估器并把现有 ExpectedActionPass 接线为 next_action（确定性优先，读 after_tool 属性或 HasMatchingSpan）；EVAL_MODEL 默认改为生产 pin；按 spec 先 2-3 case smoke，再跑 heldout 33 把 EvaluationReport 提交进仓库当基线；injection_g1（空 query）与 long_context（preseed）改造或退役。
- 解决：#9、#10、#11。
- 代价：每次真实模型运行付费（owner 规则只经 OpenCode Go，#1974 跟踪）；33 case 置信区间 ±15.6pp，小分差只能靠配对分析或扩集；最大阻塞是 catalog origin（§3 矛盾），三条路各有代价：给 staging catalog 加 host 并允许 eval 调用；经 edge 开放路由；从允许路径录制快照回放（Braintrust/AWorld 做法）。 docs/agents/owner-decisions.md:27-31
- 依据：§3 书 :302,515-533 与评分器段； docs/specs/2026-09-09-agent-on-pi-harness-spec.md:229； packages/eval/src/native/attempt-observations.ts:9-13。

D. 前缀门进 CI、端到端夜跑、之后再在线评测
- 做什么：把 phase1c 式冻结前缀扩成 prefix_gate_v1（60 case），deterministic fixture + 规则评分，PR/merge queue 跑，不碰活网；reliability_v1（40 case）真实模型 nightly，repeat 5 算 pass^k；有了 B 的 span 后用 logfire/evals withOnlineEvaluation 在 Workers 采样打分，人工 review 升级进数据集。
- 解决：#11、#12；前缀集绕过外部数据依赖。
- 代价：前缀不能替代完整回放；现有前缀用 faux 模型录制，不是真实轨迹，真实录制需授权；nightly 费用与 roster 工作；在线评测受 privacy.md 边界与 gen_ai.evaluation.result 的 Development 状态约束。
- 依据：§3 书 :515-523； packages/eval/src/native/suite-pins.ts:48-92； packages/eval/fixtures/prefix-corpus/README.md:17-21； pydantic.dev/docs/logfire/instrument/typescript/evals/。

## 6. 需要 owner 拍板
1. SUT 维持进程内（2026-09-09 决定）？是否补一条 staging 真实对话 canary（需 15 分钟 Neon Auth JWT，minting 代码已在 b6cf74034 删除，QA 凭据仅本地）。 docs/ops/auth-migration-neon.md:82,114-118
2. eval 的 catalog origin：staging catalog 加 host、经 edge、还是录制回放；spec:222 "不 mock" 是否松动。
3. 生产遥测管道：平台 trace + OTLP destination，还是 logfire-cf-workers；接不接受两条 trace id；Logfire 留不留（留则给 token 读者，不留则解除门槛）。
4. 采样率与 persist（12-01 计费）；span 内容政策：默认不记 prompt/工具载荷，还是外存+引用。
5. 评测模型：对齐生产 pin 还是 OpenCode Go；付费上限。
6. 统计口径：pass^k 还是 mean+CI；33 case 扩不扩；切换阈值。
7. 数据集处置：injection_g1、long_context、agent_eval_v3 的 35 个不支持形态；前缀集用 faux 还是真实模型录制。
8. 生产→评测回流：privacy.md 边界何时算"证明"，collector 设计归谁。
9. 文档漂移修正归属（ADR、tool-routing、secrets.md、deployment.md）。

## 7. 未能核实
- 被驳回的推断："spec T1 注记对 0.87.1 已过时"。核验：T1（telemetry 只发 hook span）仍准确，S3 commit 延迟不能从 pi.session.write 取。 docs/specs/2026-09-09-agent-on-pi-harness-spec.md:237
- Cloudflare dashboard 侧配置（OTLP destination、Logpush、告警）仓库看不到。
- 部署运行时是否真的暴露 cloudflare:workers tracing.startActiveSpan：文档 2026-07-28 changelog 说有，edge compatibility_date 2026-07-22，未实测。
- 平台 span 的 `faas.version` 带 deploy tag：依据是 Cloudflare 文档与部署代码，未在实际 trace 上看到。
- Workers Logs 是否把 script version id/tag 作为可查字段（Logpush 有 ScriptVersion，Workers Logs 字段未列）。
- Cloudflare OTLP destination（不支持 protobuf）能否直接喂 Logfire（Logfire 页只列 http/protobuf 与 gRPC）。

## 8. 主会话复核（2026-10-03）

- §4 #7 的"LOGFIRE_TOKEN 无读者"补一个读取方：`packages/eval/scripts/instrument-evals.ts` 在本机跑评测时读它。
  Worker 侧的绑定（`workers/edge/wrangler.toml`）无代码读取而仍是部署必填项，这一点成立；#1750 跟踪该绑定的退役。
- §1 的上游动态属实：npm 上 `@earendil-works/pi-agent-core` 最新为 1.0.0，commit `7fd478a2e888`（2026-10-01）
  标题为 "remove the experimental harness from pi-agent-core"；接替的 `@earendil-works/pi-durable` 1.0.0 自标 Experimental。
- §4 #2 的 auth 事件属实：`edge_auth_invalid_credential` 记录完整路径（`workers/edge/src/gateway/responses.ts:38-39`），
  与 `request.ts:33-35` 自定的"不记路径"规则相悖。
- 本仓库对 harness API 的直接依赖面：`packages/agent/src` 20 个文件、`workers/edge/src` 21 个、`packages/eval/src` 5 个、
  `packages/pi-session-neon/src` 9 个（按 `pi-agent-core/harness`、`AgentHarness`、`AgentLane` 引用计）。
- 评审线程（2026-10-04）指出 Cloudflare 文档写明每个平台 span 都带 `faas.version`（部署版本标签）、`cloudflare.script_tags` 与 `cloudflare.script_version.id`；§4 #3 据此改写，§7 对应条目删去。#8 的"无运行时告警"收窄为仓库内无应用级告警配置，dashboard 侧未核实。
