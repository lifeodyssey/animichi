# pydantic-ai 能力面普查(installed source 实测)

- **Date**: 2026-07-15 · **Status**: survey(read-only,零代码变更)
- **Source of truth**: `apps/agent/.venv/lib/python3.13/site-packages/` 安装态源码逐树走查——`pydantic_ai 2.9.1`(slim+full)、`pydantic_ai_harness 0.7.0`、`pydantic_evals 2.9.1`、`pydantic_graph 2.9.1`(已装)、`pydantic_monty 0.0.18`(CodeMode 沙箱)、`pydantic_handlebars 0.2.1`(prompt 模板)、`logfire 4.37.0`;用法交叉引用 = `apps/agent/agent` 全量 import/调用点 grep
- **前提信条(本文所有 verdict 均已按其过滤)**:structured-first 无向量(SD-29,视觉通道豁免)· agent 工具 upstream-free(AST 测试强制)· MiMo/DeepSeek 纯文本 OpenAI-compat 网关 · W1-W3 已采集合 · CodeMode 已按预注册判据否决(9.1% < 40%)

**普查头条**:harness 0.7.0 中 `experimental/*` 已全部变成 `warn_moved` 弃用垫片——**Planning / SubAgents / Memory / Compaction 家族 / RepoContext / Docs / DynamicWorkflow / StepPersistence / OverflowingToolOutput / Media / RuntimeAuthoring 全部毕业为顶层稳定 API,仅 `acp` 仍 `warn_experimental`**。W2 spec 当时"SubAgents/Planning/compaction 观望(experimental)"的前提已过期,相关 verdict 本文按新事实重判。

---

## §1 逐能力矩阵

Verdict 词表:`in-use` 已采 · `adopt-now` 建议立即小改采纳 · `small-wave` 值得独立小 wave(eval 门禁) · `product-decision` 需用户拍板 · `watch` 记录暂缓 · `reject` 明确不采(理由§4)。

### 1a. Agent core(pydantic_ai)

| 能力 | 一句话(源码依据) | 我们的用法 | Verdict | 效 |
|---|---|---|---|---|
| `ToolOutput` 联合输出 | 输出=命名工具调用,天然承载意图路由(output.py) | `animichi_agent.py _output_types()` ×5 | **in-use** | — |
| `NativeOutput` | provider 原生 structured-output(json_schema) | NONE | **watch**(spike 级):意图路由建立在 5 个 ToolOutput 名上,validator 也按 intent 键校验;MiMo/DeepSeek 的 json_schema 严格度未实测。仅当 MiMo 工具调用坏格式(clarify 串化)复发时值得一 spike | S |
| `PromptedOutput` / `TextOutput` | prompt 注入 schema / 纯文本裁剪 | NONE | reject-no-need(路由必须 typed) | — |
| `Agent.from_file`(YAML/JSON spec,`custom_capability_types`) | 声明式 agent 定义(agent/__init__.py:700) | NONE | watch(eval 场景 agent 可用,非产品路径) | S |
| run 家族:`run/run_sync/run_stream/run_stream_sync/iter` | `iter()` 暴露 graph 级逐节点迭代(abstract.py:366-997) | `run()`(runner)、`run_stream` 经 VercelAIAdapter | in-use(iter 无需求) | — |
| `Agent.to_web()` | 内置本地调试 chat UI(agent/__init__.py:2677) | NONE | **adopt-now**(纯 dev QoL:配 LM Studio 手测,不进产品) | S |
| `UsageLimits`(request/tool_calls/input/output/total token 上限,`count_tokens_before_request`) | usage.py;默认 request_limit=50 | NONE 显式——W0 已实测 MiMo thrash 撞默认 50 | **adopt-now**:runner 显式传保守 `tool_calls_limit`,把 MiMo 重试风暴变 typed `UsageLimitExceeded` | S |
| `FallbackModel` | 多模型失败链(models/fallback.py) | `agents/base.py` resolve_model ×2 | **in-use** | — |
| `OpenAIChatModel`+`OpenAIProvider`+`ModelProfile` | 直构 ChatModel 侧步 `openai:` 前缀默认 Responses API | `agents/base.py` `_parse_openai_model`(W0 钉测) | **in-use** | — |
| `direct.py`(`model_request*`) | 无 Agent 的裸模型调用 | NONE | no-need | — |
| `retries.py`(tenacity `AsyncTenacityTransport`) | httpx 传输层官方重试 | NONE——`CatalogClient._with_retry` 手搓退避 | small-wave(§2-7) | S |
| `pydantic_graph`(已装) | 显式状态图编排 | NONE | reject-no-need(单 agent 教义) | — |
| `format_prompt`/`pydantic_handlebars` | prompt 模板(ManagedPrompt `render_template=True` 用) | 间接(ManagedPrompt 未开模板) | in-use-indirect | — |
| A2A(`fasta2a`) | **未安装**(extra 未选) | — | n/a | — |

### 1b. Capabilities(pydantic_ai.capabilities 全 22 项)

| 能力 | 一句话 | 我们的用法 | Verdict | 效 |
|---|---|---|---|---|
| `ProcessHistory` | 历史处理管道 | `animichi_agent.py _history_capabilities()`(compact+sliding) | **in-use**(内容层见 §2-1) | — |
| `Hooks`(before/after run·node·model_request、`run_error`、wrap 系,`HookTimeoutError`) | 官方横切面 | `_modern_hooks()`:`before_model_request` 会话注入 + `on.run_error` 遥测 | **in-use** | — |
| `ToolSearch(strategy='keywords')` | 本地关键词工具发现(native BM25/regex 于 Anthropic/OpenAI) | `build_animichi_agent`;defer=web_search/translate | **in-use** | — |
| `Thinking` | 推理/思考配置(budget、summary) | NONE——MiMo 是 reasoning 模型,thrash 或与思考预算相关 | **watch→spike**:OpenAI-compat 网关对 thinking 参数透传度未知,一条实测定生死 | S |
| `WebSearch`/`WebFetch`/`XSearch`/`ImageGeneration`/`MCP`(NativeOrLocalTool 系) | provider 原生工具+本地回退配对 | NONE——web_search 为自研(SD-19 包装,见 §2-4) | WebSearch: keep-ours;WebFetch: product-decision(新上游);X/Image: reject;MCP: reject-for-now | — |
| `HandleDeferredToolCalls` | 人审/外部工具调用在 run 内解决 | NONE | product-decision(§3-8 关联) | M |
| `ReinjectSystemPrompt` | 历史被剪后补回系统提示 | NONE(instructions 按请求注入,无此洞) | no-need | — |
| `ProcessEventStream` | 事件流转发到 async handler | NONE——`deps.on_step` + `_emit_step` 手搓 SSE(§2-3) | small-wave | M |
| `PrepareTools`/`SetToolMetadata`/`PrefixTools`/`IncludeToolReturnSchemas`/`Toolset`/`ThreadExecutor`/`Instrumentation`/`DynamicCapability`/`CombinedCapability`/`WrapperCapability`/`Capability` | 组合/装配基元 | Instrumentation 经 `logfire.instrument_pydantic_ai()`;其余间接 | in-use-indirect | — |
| `load_capability` / 自定义 authoring(`AbstractCapability` 子类) | 自定义能力 | `_AnimichiManagedPrompt`(W2)即自定义子类实践 | **in-use** | — |

### 1c. Tools 进阶(pydantic_ai.tools / toolsets)

| 能力 | 一句话 | 我们的用法 | Verdict | 效 |
|---|---|---|---|---|
| `Tool(...)` 参数面:`requires_approval` / **`timeout`** / `strict` / `sequential` / `defer_loading` / `metadata` / `max_retries`(tools.py:454-466) | 逐工具行为位 | 仅 `defer_loading`(web_tools.py DEFERRED_TOOLS) | **adopt-now(timeout)**:catalog RPC 工具挂 per-tool 超时,替代纯客户端超时叠层;approval 见 product-decision | S |
| `ApprovalRequiredToolset` / `DeferredToolRequests` | 人在环审批 | NONE | product-decision(§3-8) | M |
| `ExternalToolset` | 结果在 run 外产生的工具 | NONE | no-need | — |
| `ToolReturn(value, content, metadata)` 富返回 + 多模态 content | 给模型的 content 与给代码的 value 分离(messages.py:912) | NONE——`_summarize_for_llm` 手搓同一语义(§2-2) | **small-wave** | M |
| 工具校验/`ModelRetry` 守卫 | — | 全部 7+2 工具 in-use | **in-use** | — |
| `MCPToolset`(mcp.py,客户端;Resource/Prompt 全套) | 消费 MCP 服务器 | NONE | reject-for-now(catalog=oRPC) | — |

### 1d. 输入/历史

| 能力 | 一句话 | 我们的用法 | Verdict |
|---|---|---|---|
| `ImageUrl`/`AudioUrl`/`VideoUrl`/`DocumentUrl`/`BinaryContent`/`FilePart` | 多模态输入(messages.py:292-521) | NONE | reject-for-now:MiMo/DeepSeek 文本网关;"截图找圣地"是真实产品想象但属模型阵容决策(§4-9) |
| 历史管理(ProcessHistory + 官方 compaction 家族) | 见 1f harness | 自研两段 | §2-1 / §3-3 |

### 1e. 编排/集成/UI

| 能力 | 一句话 | 我们的用法 | Verdict |
|---|---|---|---|
| Agent delegation(tool 内调子 agent) | 官方文档模式 | NONE(translation_agent 是独立 agent 非委派) | no-need |
| `durable_exec`(temporal/ dbos/ prefect/) | 持久化执行 | NONE | reject(§4-4) |
| `embeddings/`(openai/google/bedrock/cohere/voyageai/sentence_transformers/test + instrumented) | 官方嵌入 API | NONE | **reject——SD-29 信条**(§4-1) |
| `ui.vercel_ai.VercelAIAdapter` `sdk_version: Literal[5,6,7]`(v6=工具审批流,**v7 wire==v6**,_adapter.py:140-144) | AI SDK 适配 | `routes/chat.py` sdk_version=6 | **in-use**;v7 零迁移成本,前端升 SDK v7 时改一个字面量 |
| `ui.ag_ui` | AG-UI 协议适配(含 thinking/multimodal) | NONE | reject-no-need(Vercel 已选) |
| `ui._web` | to_web 的实现 | — | 同 to_web |
| `ext/langchain.py` / `ext/skills/` | LangChain 工具桥 / **Agent Skills(SKILL.md)加载器** | NONE | watch(skills 加载器与本仓 harness 工程谱系同源,暂无产品用途) |
| `common_tools/`(duckduckgo/exa/tavily/web_fetch/x_search/image_generation) | 现成工具函数 | duckduckgo(web_tools 内自研包装引用) | in-use(局部) |

### 1f. Harness 0.7.0 全矩阵(稳定性=安装源实测)

| 能力 | 稳定性 | 一句话 | 我们的用法 | Verdict | 效 |
|---|---|---|---|---|---|
| `ManagedPrompt` | 稳定(`__all__`) | Logfire 管理 prompt,label 定targeting | `_AnimichiManagedPrompt`(W2,四门禁+fail-closed) | **in-use** | — |
| `CodeMode` | 稳定(`__all__`) | Monty 沙箱路由工具 | spike 已判弃(`agent/spikes/codemode/`) | **reject(已裁决)** | — |
| `Guardrails`(`InputGuard`/`OutputGuard`,`__all__`) | 稳定 | 首请求/输出拦截守卫 | NONE——SD-19 手搓(guardrails.py 自研模块重名!) | **small-wave**(§3-6) | M |
| `FileSystem` / `Shell` | 稳定(`__all__`) | 沙箱文件/命令 | NONE | **reject——upstream-free**(§4-2) | — |
| compaction 家族:`SlidingWindow`/`SummarizingCompaction`/`TieredCompaction`/`ClearToolResults`/`ClampOversizedMessages`/`DeduplicateFileReads`/`LimitWarner` | **已毕业** | 官方历史压缩全家桶 | NONE——`_compact_tool_results`+`_sliding_window` 手搓 | **small-wave**(§3-3) | M |
| `OverflowingToolOutput` | 已毕业 | 生产时超大工具返回分band缩减 | NONE——`_summarize_for_llm` 手搓 | **small-wave**(§3-5) | M |
| `Memory`(含 `_postgres` store) | 已毕业 | 持久笔记本+按需记忆文件 | NONE——`user_memory` 表自研雏形 | **product-decision**(§3-7) | M |
| `Planning` | 已毕业 | 模型自有任务计划(cache 友好) | NONE | reject-no-need(流程 1-3 工具) | — |
| `SubAgents` | 已毕业 | 命名子 agent 委派(effort 分级) | NONE | watch(单 agent 教义;若 Walk Mode 复杂化再议) | — |
| `RepoContext`/`Docs(PyaiDocs)`/`DynamicWorkflow`/`RuntimeAuthoring`/`StepPersistence`/`Media(S3)` | 已毕业 | 面向 coding-agent/长任务 | NONE | reject/watch(§4-5/6;StepPersistence watch——与会话持久化谱系相近但我们已有 DB 方案) | — |
| `ACP` | **experimental(唯一)** | Zed/Toad 终端协议 | NONE | reject-experimental | — |

### 1g. pydantic_evals 2.9.1

| 能力 | 一句话 | 我们的用法 | Verdict | 效 |
|---|---|---|---|---|
| `Dataset`/`Case`/`evaluate(lifecycle=, progress=, repeat=, retry_*)` | 官方运行器 | W3 全采(`eval_harness.py`/`run_agent_eval.py`) | **in-use** | — |
| `CaseLifecycle`(setup/prepare_context/teardown) | 官方生命周期 | `StreamingProgress`(W3 流式) | **in-use** | — |
| `Dataset.to_file/from_file` | 官方序列化 | `--export-dataset`(W3) | **in-use** | — |
| **agentic 评估器**:`ToolCorrectness`/`TrajectoryMatch`/`ArgumentCorrectness`/`MaxToolCalls`/`MaxModelRequests`(evaluators/agentic.py) | 官方轨迹级评估 | NONE——`ToolCallRecall`/`RouteOrderCorrect`/`StepEfficiency` 手搓(evaluators.py) | **small-wave 头号**(§3-1) | M/L |
| `LLMJudge` | LLM 裁判 | L3 in-use(evaluators.py build_l3_evaluators) | **in-use** | — |
| `GEval` | G-Eval 链式裁判 | NONE | watch(L3 升级候选,受裁判纪律约束) | — |
| `Equals/Contains/IsInstance/MaxDuration/HasMatchingSpan` | 通用断言(含 OTel span 断言) | NONE | watch(HasMatchingSpan 可作轨迹断言替代面) | — |
| `ReportEvaluator` | 报告级元评估 | NONE(gate.py 承担) | no-need | — |
| `generation.py` | **LLM 生成数据集**(schema 驱动) | NONE | small-wave(L2 对抗族扩充器) | S |
| `online.py`/`online_capability`/`_online` | **线上流量挂评估器→后台自动评估** | NONE | **small-wave/product**(§3-2) | M |
| `otel/span_tree` | span 树查询 | NONE(evals OTel 已进 Logfire) | in-use-indirect | — |

### 1h. logfire 4.37(tracing 之外)

| 能力 | 一句话 | 我们的用法 | Verdict | 效 |
|---|---|---|---|---|
| `VariablesOptions`/`LocalVariablesOptions`(managed variables) | ManagedPrompt 后端 | `routes/_deps.py` timeout=(1.0,1.0) | **in-use** | — |
| `instrument_pydantic_ai/fastapi/httpx` | — | `routes/_deps.py:244` | **in-use** | — |
| `instrument_asyncpg`/`instrument_psycopg` | DB span | NONE(asyncpg 在用!) | **adopt-now** | S |
| `ScrubbingOptions`/`ScrubMatch` | PII 洗擦 | NONE——request_log/span 里有用户 query 原文 | **adopt-now/product**(§3-6) | S |
| `SamplingOptions` | 采样控费 | NONE | watch(流量起来再开) | S |
| `experimental/query_client.py`(46KB API client + SQL 查询) | 程序化查询 trace/metrics | NONE——`eval_feedback_miner` 挖 request_log 表 | small-wave(§3-7 关联) | M |
| `metric_counter` 等(Logfire 实例方法) | 显式 metrics | NONE(以结构化 log 事件代替:`geocode_miss` 等) | no-need(现状够用) | — |
| `instrument_system_metrics`/30+ 其他 instrument | — | NONE | watch | — |

---

## §2 手搓 vs 官方已提供:偏差清单

1. **历史压缩**:`_compact_tool_results`(>200 字符工具返回摘要化)+ `_sliding_window`(按轮次边界截窗)≈ 官方 `compaction.ClearToolResults` + `compaction.SlidingWindow` 的窄化版;官方版另有我们没有的 token 估算、`LimitWarner`、`SummarizingCompaction`、`TieredCompaction`。我们的版本按 40 消息阈值/8 保留硬编码,官方按 token 预算。
2. **工具返回瘦身(给模型)**:`_summarize_for_llm`(rows>5 → row_count+preview+note)≈ 官方 `ToolReturn(value=..., content=...)` 的手工模拟——官方语义正是"value 给代码、content 给模型"。我们叠加的 tool_state/SSE 分发是自有边界,采纳时只动"给模型"半边。
3. **SSE 步骤流**:`deps.on_step` + `_emit_step` 手搓事件通道 ≈ 官方 `ProcessEventStream`(转发原生事件流)。手搓版语义更粗(工具级 running/done/failed),官方版是模型/工具事件全谱;chat 端点已走 VercelAIAdapter 原生流,两套并存。
4. **Web 守卫**:自研 `guardrails.py`(`detect_prompt_injection`/`wrap_untrusted_web_results`/source_tier)≈ 官方 harness `InputGuard`/`OutputGuard` 的宿主位——官方守卫是钩子框架不含我们的域检测,可把自研检测移植进官方守卫壳。注意命名撞车:我们有 `agent/agents/guardrails.py`,harness 有 `pydantic_ai_harness.guardrails`。
5. **HTTP 重试**:`CatalogClient._with_retry`(指数退避,上限 30s)≈ 官方 `retries.py` 的 tenacity 传输层(`AsyncTenacityTransport`);官方版在 httpx transport 层,天然覆盖所有经该 client 的调用。
6. **模型回退**:`resolve_model` 的 fallback 已用官方 `FallbackModel` ✓(无偏差,列此为界)。
7. **用户记忆**:`user_memory` 表(visited_anime/visited_points JSONB)自研雏形 ≈ 官方 `harness.Memory`(+`_postgres` store)的注入式笔记本模式。
8. **请求预算**:无显式 `UsageLimits`,靠默认 request_limit=50 兜底(W0 实测 MiMo thrash 撞顶)——官方有 `tool_calls_limit` 等整套细粒度旋钮。
9. **轨迹评估器**:`ToolCallRecall`/`RouteOrderCorrect`/`StepEfficiency`(evaluators.py,自研)≈ 官方 `agentic.ToolCorrectness`/`TrajectoryMatch`/`MaxToolCalls`——官方版还有我们没有的 `ArgumentCorrectness`(参数级正确性,正中 MiMo clarify 串化 bug 的量尺缺口)。
10. **生产质量信号**:`request_log.plan_quality_score` + `eval_scorer` 离线批评 ≈ 官方 `pydantic_evals.online`(评估器直接挂生产函数,后台自动评估进 Logfire)。

## §3 Top opportunities(≤8,按价值/信条兼容排序)

1. **官方 agentic 评估器接管 L2 轨迹层**(§2-9)。用 `ToolCorrectness`/`TrajectoryMatch`/`MaxToolCalls` 替换自研三件套,并新增 `ArgumentCorrectness`——首次获得"工具参数是否正确"的官方量尺(MiMo 把 `options` 串化正是参数级缺陷,现量尺不可见)。前置:eval 语义变更=基线重置=红线用户决策;`_STAGE_TOOL_CHAINS` 的 disjunction 语义需映射进 TrajectoryMatch 配置。效:M/L。
2. **Online evals 上线**(§2-10)。给 `run_animichi_agent` 挂 `nonempty_results`/locale 等 L1 确定性评估器跑生产流量,后台评估进 Logfire——检索质量第一次有实时标尺,直接续接"检索质量量尺体系化"待办。前置:prod logfire token(已有)、`SamplingOptions` 控费。效:M。
3. **官方 compaction 家族替换手搓两段**(§2-1)。`ClearToolResults`+`SlidingWindow`(必要时 `LimitWarner`)替代 `_compact_tool_results`/`_sliding_window`,token 预算制替代消息数硬编码。前置:全量 eval 门禁 + 多轮(G/H 族)回归;W1 回退开关模式复用。效:M。
4. **`UsageLimits` 显式化 + `Tool(timeout=)`**(§2-8)。runner 传保守 `tool_calls_limit`/`request_limit`,catalog 工具挂 per-tool timeout——MiMo thrash 从"撞默认 50 的谜之错误"变成典型 typed 异常可处理。效:S,可直接 adopt。
5. **`ToolReturn` + `OverflowingToolOutput` 替换 `_summarize_for_llm`**(§2-2)。"给模型的摘要"走官方富返回,超大 payload 走官方 band 缩减;tool_state/SSE 边界不动。前置:token A/B 复测(W1 方法论现成)。效:M。
6. **SD-19 迁入官方 Guardrails 壳 + `ScrubbingOptions`**(§2-4)。自研注入检测移植进 `InputGuard`/`OutputGuard`(域逻辑不变,宿主官方化);同批把 logfire 洗擦开起来(span 中用户 query 原文的 PII 面)。注意自研 `guardrails.py` 与 harness 模块重名,迁移时顺手更名。效:M(洗擦部分 S,可先行)。
7. **`instrument_asyncpg` 一行 + `query_client` 喂 feedback-miner v2**(§1h)。DB span 立得;中期把 `eval_feedback_miner` 的挖掘源从 request_log 表换成 Logfire SQL(query_client),与 evals OTel 轨迹同源。效:S+M。
8. **人在环审批链(product-decision)**:`Tool(requires_approval=True)` + `ApprovalRequiredToolset` + `HandleDeferredToolCalls`,前端 sdk_version=6 的审批流已就绪——未来 Walk Mode 高代价动作(长途路线确认、付费 API)有整条官方通道。现在只记录,不动。效:M。

## §4 明确不采与理由

1. **`embeddings/` 全家**:SD-29 structured-first 无向量信条(DD-11/12/13/22 冻结;视觉通道豁免不经此 API)。哪怕官方 API 很顺手,采了就是推翻已裁决架构。
2. **`FileSystem` / `Shell`**:直接违反 upstream-free 信条,`test_agent_upstream_free.py` AST 不变量强制;W2 已判,维持。
3. **`CodeMode`**:预注册判据已裁决弃(请求数降 9.1% < 40%,W2 spike 证据入 PR);spike 代码留作化石。
4. **`durable_exec`(Temporal/DBOS/Prefect)**:无对应基础设施,CF 容器架构下引入=新运维面,无诉求。
5. **`SubAgents` / `Planning` / `DynamicWorkflow`**:单 agent 教义 + 我们的流程 1-3 工具即终点,计划/委派没有肉;SubAgents 留 watch 一句(Walk Mode 复杂化再议),Planning/DynamicWorkflow 明确不采。
6. **`RuntimeAuthoring`**:让模型在运行时编写并注册真实 capability——与本仓信任边界(LLM 输出永远是数据不是指令)正面冲突,生产不采,永不。
7. **`ACP`**:harness 唯一 experimental 遗留,终端/编辑器协议,与产品无关。
8. **`ui.ag_ui` / A2A**:前端已定 Vercel AI SDK(v6 wire,v7 等价零成本);A2A extra 未安装且无多 agent 需求。
9. **多模态输入(`ImageUrl`/`BinaryContent` 等)+ `ImageGeneration`/`XSearch` 能力**:MiMo/DeepSeek 纯文本网关下不可达;"用户发截图找圣地"是真实的产品想象,但那是模型阵容(vision 模型入列)的 product-decision,不是本 SDK 面的采纳项;XSearch 无场景。
10. **`MCP`(client/`MCPToolset`)**:catalog 契约=oRPC,无 MCP 服务器可消费;引入=平行契约面,违背 single-source-of-truth。
11. **`NativeOutput` 全面切换**:意图路由与 output_validator 都键在 ToolOutput 工具名上,是三轮 wave 打磨过的裁决机制;NativeOutput 最多允许一次网关兼容性 spike(§1a),不做默认方向。

---
*方法注记:能力清单来自安装源 `__init__` 导出与类 docstring 首行(非记忆);"已毕业/experimental" 判定依据 `pydantic_ai_harness/experimental/_warn.py` 的 `warn_moved` vs `warn_experimental` 实际调用点;用法列 grep 自 `apps/agent/agent`(测试与生产分列时以生产为准)。*

---

## §5 用户复核修正(2026-07-15,owner 反馈后)

1. **embeddings 措辞澄清**:schema 存在 `points.embedding vector(1024)` + HNSW 索引与遗留写入管道,但**读路径为零**(死脚手架)。"reject"的准确范围 = 不为文本检索采纳(SD-29);该信条自带重审触发器(DD-22:真实 miss 率证据),而 §3-2 online evals 正是产生该证据的仪器——**证据到位时 SD-29 应带数据重审**。
2. **A2A:`n/a` → product-decision/backlog**(owner 确认需求存在,未排期)。技术成本低:`fasta2a` extra + `agent.to_a2a()` 即成 A2A 服务端;排期时出 spec。
3. **Media / StepPersistence:watch 维持,但触发器具名 = Walk Mode**(拍照打卡/用户上传 → Media;长会话实时伴游 → StepPersistence)。Walk Mode 立项时与审批链、Memory 连锁重判。
4. **方法论备注**:本表的 watch/reject 混合了三类理由——物理不可达(文本网关)、信条约束(owner 可推翻)、YAGNI 成本纪律(随时可翻)。逐项触发器已在上文标注;owner 表达激进采纳意愿时按触发器提前。
5. **ToolReturn 语义勘误**:§2-2 的“value 给代码、content 给模型”映射有误;安装版本的实际语义是 `return_value` = 模型可见工具结果、`content=` = 额外的 user part、`metadata` = 仅 app 可见。由于 `tool_state` 已是 app 通道,`ToolReturn` 不适合承担这里的分流。
