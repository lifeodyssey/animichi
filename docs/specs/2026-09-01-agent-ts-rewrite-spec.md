# Spec — agent TS 重写（pi agent core × DO × Neon 单一真相源）

- Status: W0 closed 2026-09-03（S1–S5 全通过硬条件，kill-switch 未触发，#1249）；W1 in progress — owner 已定方向（2026-09-01 grilling），本文件为简化版权威决策记录；复杂化 spec 由后续更强的模型在此基础上扩展。
- 决策输入：`docs/specs/2026-09-01-pi-agent-core-research-report.md`（workerd 实测通过）× `docs/iterations/production-readiness-2026-08/PI-AGENT-CORE-RESEARCH.md`（8/29 NO-GO 全量迁移 / GO 限 spike 门——本 spec 保留其门）× `docs/specs/2026-08-17-agent-ts-research-report.md`（#1106）。
- 战略动机：消灭 Python 容器冷启动（2026-09-01 实测：睡醒唤醒 28–32s、部署后 74s；PR #1239 只是把库的 20s 等待预算放宽到 55s，没有缩短冷启动本身）；异步病根（#729 / #1235 request-parked ingest / turn 生命周期补丁群）根治为"回合活在请求之外、Neon 唯一真相源"；仓库收敛为纯 TS 单流水线。
- 2026-09-01 二轮 grilling（Q1–Q5，owner 定案）：回合宿主 = DO alarm；断线 = 不续流、回来按会话 ID 拉最终结果；W1/W2 不设自动 eval；eval 只对真实环境测；agent 住进 `workers/edge` 不新建 Worker。已并入 §二–§八。

## 一、目标 / Non-goals

**目标**：`apps/agent`（Python 23,563 生产行）整体退役，chat agent 以 TS 重写跑在 Cloudflare Workers DO 上，Neon 为唯一真相源，全量功能对等（6 模型工具、BYOK、上下文与记忆（§九）、662-case eval 统计门），完成后直接删除 Python，无影子期。

**Non-goals**：
- 不引入独立队列系统（pg-boss / CF Queues 第一天都不要）。
- 不改 edge 鉴权模型（Neon Auth JWT 仅 edge 验证，AUTH-2 #950 契约不动）。
- 不改 `packages/contract` 的 zod 契约与 SD-9 帧 surface（web 端改动最小化）。
- 不押注 pi 上游未实现的 `AgentHarness`（HEAD 仍抛 `HarnessNotImplemented`）——只用 core Agent 层。
- 不动 launch 链依赖（#1072/#1077 照旧并行）。

## 二、已定决策（2026-09-01 grilling 记录）

| 决策点 | 结论 |
|---|---|
| 内核 | `@earendil-works/pi-agent-core` + `pi-ai`，钉 exact version，每周跟进 CHANGELOG breaking 段 |
| 语言/运行时 | 全 TS；agent 作为 DO class **住进 `workers/edge`**（今天 Python 容器就挂在 edge 名下，重写只是容器换 DO class，不新建 Worker——每多一个 Worker 就多一份 secret 触点 / cohort 扩散 / 队列阻塞；users 因持有独立最小权限 DB 凭证保留独立，catalog/migrator 因生命周期不同保留独立）；`apps/agent` Python 全删 |
| agent loop 承载 | DO，每 session 一个实例；**回合跑在 alarm handler 里**：intake 写 Neon → `setAlarm(now)` → DO 在 alarm 内跑完回合并落库。依据 CF 文档（2026-07-28）：fetch 调用的 wall time 只在调用方保持连接期间无限，断开后关联任务可能被取消；alarm handler 有独立 15 分钟 wall time，与连接无关（现行整回合 deadline 100s，余量 9 倍） |
| 队列 | 无。`runs` 表（状态+超时）+ DO alarm 扫描回收；"outbox 本质"= message+run 同事务落库 |
| 断线语义 | 回合在后台跑完；客户端回来**按会话 ID 拉一次最终结果**（现有 `GET /v1/conversations/{id}/messages`，加 run 状态字段），**不续流**——owner 定：续流是加分项不是门槛，砍掉后落库粒度不受"可寻址 delta"约束。连接在时仍按 SD-9 帧实时推 SSE |
| W1/W2 回归守护 | **不设自动 eval**，靠 staging 手动验证（owner 接受风险）；W3 一次性搬完考卷 |
| eval 被测目标 | **只对真实环境**（staging HTTP）测整个 agent，不做进程内档；工具轨迹从 SSE/GET 转录取，不依赖 span tree |
| 范围 | 全量 parity，波次仅是执行顺序（§五） |
| Python 退场 | 直接删，无影子期（生产冻结于 staging-only，删除风险最低窗口） |
| schema 边界 | `packages/contract` zod 不动；pi 工具参数用 typebox，单一转换点（zod↔JSON Schema 桥位置在 W1 定，防双 schema 漂移） |
| 结构化输出 | "submit_result 工具 + 校验 throw 回喂 + terminate"模式复刻 `output_validator` 闭环（8/29 note 硬条件 2） |
| 上下文与状态栏 | **转录重放每一轮的工具调用与结果为结构化消息**（不再把早先一轮降级为文本）；**工具返回摘要在写入时定稿并冻结**，删除「最新 8 条」的每轮再压缩，只保留阈值批量压缩；`SessionEnvelope` 从系统提示词移到转录末尾的 `<agent_status>` user 消息、每轮替换 ⇒ 系统提示词按模型/工具集字节稳定。依据李博杰《深入理解 AI Agent》第 2 章（owner 2026-09-05，#1297）。展开见 §九 |

**决策日志**

- 2026-09-05 · #1297（W2：跨轮工具返回重放 vs 每轮压缩窗口）：**选项 (b) accepted-with-redesign** — 采纳「重放早先各 run 的工具返回」，但按李博杰第 2 章重塑为 §九 的三个动作（结构化重放 / 写入时冻结摘要 / `<agent_status>` 状态栏）；选项 (a)「把 per-run 保留窗口当作 TS 层语义接受」否决。卡片 #1377 · #1378 · #1379。

## 三、目标架构

```text
浏览器 ──SSE（连接在时）──> workers/edge
   │ POST /v1/chat        ├─ 身份/Turnstile（不动）
   │ GET /v1/conversations/:id/messages（回来时拉最终结果）
   ↓                      ├─ intake：dedupe + 单 TX 写 Neon（messages + runs + 配额预留）→ setAlarm(now)
                          └─ AgentSession DO class：alarm 内跑 pi loop + 工具 → 结果落库
                                     │ 卡死回收：runs 表超时 + alarm 扫描
                                     ↓
                          Neon = 唯一真相源 · Logfire = trace（@pydantic/logfire-cf-workers）
```

组件职责（全部在 `workers/edge` 内，不新建 Worker）：
- **身份层**：不变。验 Neon Auth JWT / 匿名 Turnstile，受信身份进入 intake。
- **intake**：按 (session, client_message_id) dedupe；单事务写 messages + runs(running) + 配额预留；事务提交后 `setAlarm(now)` 叫醒该 session 的 DO（快路径）。**兜底必须独立于 session DO**（提交与 `setAlarm` 之间崩溃时该 DO 未被武装，它自己的 alarm 永远不会响）：一个单例 `RunSweeper` DO 以周期 alarm 扫 `runs` 表中 `running` 且租约过期/从未取得租约的行，对其 session DO 重新 `setAlarm(now)`；扫描幂等（重复叫醒无副作用，由 DO 侧租约保证）。这就是 at-least-once 的来源。
- **AgentSession DO**：alarm handler 内载入转录 → pi Agent（mimo-v2.5 经 `createProvider` custom Model）→ 工具执行 → 若有连接在则按 SD-9 帧推 SSE；结束 = assistant message + usage 结算 + run=succeeded 同一 TX。落库粒度按工具步骤 + 文本段聚合（不需要可寻址 delta）。单写者语义 = turn 租约；admission 沿用现有 `turn_admission` 语义移植（忙时并发回合拒绝/排队）。
  - **alarm → SSE 交接契约**：`alarm` 与 `fetch` 是同一 DO 实例上的两次调用，共享内存。`fetch(POST /v1/chat)` 在实例内存里登记一个订阅者（`WritableStream` writer），返回 SSE 响应；alarm 内的 loop 每产出一帧就对当前订阅者集合 `write`（await，天然背压）；写失败或客户端断开 → 移除订阅者，loop 不受影响。订阅者**不持久化**：DO 被驱逐、或 alarm 在没有订阅者时跑完，客户端拿不到直播，按 §二"断线语义"回落 `GET …/messages` 取最终结果。这是 best-effort 直播，不是投递保证；W1-5 的 browser AC 覆盖"连接在时看到帧、切走回来 GET 拿到完整结果"两条路径。
  - **工具步骤幂等（alarm 重试安全）**：每个工具步骤的结果以 `(run_id, step_index)` 为键**先落库再继续**；alarm 因驱逐/重启重跑同一 run 时，从已落库的步骤回放，不再执行已有结果的步骤。有副作用的工具（当前只有 route 工具的落库、未来的 BYOK 出站）必须接受该幂等键；只读工具（catalog、web search）天然幂等。S4 的"驱逐/重启恢复"用例必须包含"工具成功但结果未落库前崩溃"这一分支，验证只执行一次。
- **取回面**：现有 `GET /v1/conversations/{id}/messages` 加 run 状态（running / succeeded / failed+reason）；web 今天断线本来就是整体重拉这个接口（`use-stream-recovery.ts:62-66`），改动 = 多读一个状态字段。

## 四、Phase 0 spike 门（= 8/29 note 五痛点表 + GO 硬条件的工程化）

按新报告 §七 S1–S7 执行，全部**真部署 Worker + 真实网关**，wrangler dev 不算数：

- **S1**：三 provider matrix + deployed Worker + abort 三处断点 + cold/warm 唤醒毫秒数实测（写回本 spec 附录）。
  - 结论：**通过**。cold / warm 唤醒 477 / 803 ms，唤醒 <1s 的收益成立；mimo 与 Gemini 往返均 200 且 clean；三处 abort（provider_stream / tool_call / final_frame）全部 aborted=yes clean=yes。Anthropic 因本地无 key 未测（非 workerd 故障），作为 [U] 带入 W1，不构成硬失败。（附录 A）
- **S2**：mimo-v2.5 网关方言定版（compat 开关阵逐项实测：tool calling 往返 / strict / maxTokensField / streaming usage）。
  - 结论：**通过**。19 个直连用例（默认 + 9 个开关各两值）全部完成工具往返且带流式 usage，mimo 直连不需要任何 compat 覆盖；单轮 wall 4–12 s、中位数约 6.5 s。zen 路由无 `ZEN_GO_API_KEY` 未测，W1 用直连，故不阻塞。（附录 B）
- **S3**：esbuild `.lazy` chunk bug——file upstream issue；我方 CI 加"bundler 产物 smoke 执行"门；先用已验证 workaround。
  - 结论：**通过**。常驻门 `pnpm --filter edge-worker run test:bundle-smoke` 打包 `workers/edge/bundle-smoke/pi-kernel.worker.ts` 并在 workerd 内**执行**产物；把入口换回 `api/openai-completions.lazy` 即转红，workaround 因此被机器盯住。（CI 门 #1263 已合并；upstream 报告 `docs/specs/2026-09-01-pi-ai-esbuild-lazy-chunk-report.md`）
- **S4**：DO 状态机：并发同 session、eviction/restart、provider/tool 中途故障 → 进行中 turn 必须能恢复到"收尾一致"（不依赖上游 harness）。**硬条件（Q1 定）**：在真部署 DO 的 alarm handler 内跑一个刻意 5 分钟、含 3 次工具调用的回合，期间客户端断开，最终 Neon 里 run=succeeded 且转录完整；同时实测 alarm 内一次回合的 DO 计费 wall-clock。**该 spike 使用独立的 spike-only 回合 deadline（≥ 6 分钟，spike 配置项，不进生产默认值）**——生产的整回合 deadline 仍是 100s（§二），5 分钟只是为了逼近 alarm 的 15 分钟上限做压力验证；恢复用例必须含"工具成功但结果未落库前崩溃"分支（§三 幂等契约）。
  - 结论：**通过**。同 session 的第二个回合被唯一索引 `runs_one_running_per_session` 以 409 直接拒绝；"工具成功、步骤行未落库"崩溃分支重放精确一次（3 个步骤共 4 次工具执行）；刻意 5 分钟、3 次工具调用的回合在客户端断开后仍在 alarm 内跑完，staging Neon 里 run=succeeded 且转录完整，DO 计费 wall-clock 100.9 s。（附录 C）
- **S5**：BYOK/egress 红线（8/29 note 条件 6 全表：allowlist、非空 key、无 server-key fallback、SSRF 边界、redirect、日志脱敏）。
  - 结论：**通过**。应用层每条红线都 deny 且带出拒绝原因（`host_not_allowlisted` / `unknown_provider` / `scheme_not_https` / `port_not_443` / `metadata_address` / `own_infrastructure` / `empty_key`）；allowlist 内的三个供应商 host 真实到达对端，假 key 得 401/400 且错误文本不含 key；恶意 302 在第 1 跳即 deny；平台出站代理对私网/元数据目标另有一层拒绝（9 个目标，403；`metadata.google.internal` 为 530）。DNS 混合 A 记录与"验证→连接"之间的重绑定仍 [U]（需自控 nameserver），作为 [U] 带入，不构成硬失败。（附录 D）

**Kill-switch**：S1–S5 任一硬失败 → 内核层回退 Vercel AI SDK ToolLoopAgent（#1106 的 39/60 基线，输出回喂自建 ~50–100 行）；**架构壳（DO/Neon/intake/GET）不变**，只换 loop 层。spike 结论与复测数据必须回填本 spec 后才进 W1。

**裁决（2026-09-03，W0-KS #1249）**：S1–S5 全部通过硬条件，kill-switch 不触发；内核层保持 pi-agent-core + pi-ai，W1 按 §五 开工。

- 带入的 [U]（都不是硬条件的一部分，拿到条件后各补一行即可）：Anthropic 在 workerd 上的往返未证实（本地无 key，附录 A）；DNS 混合 A 记录与"验证→连接"之间的重绑定未测（需自控 nameserver，附录 D）。
- spike 产出的两条实现硬要求：assistant 的 tool-call 消息必须与 `run_steps` 一起持久化并从转录重放，重放才能落在同一 `step_index`（附录 C，W1-3 #1252）；Google BYOK 走 pi-ai 的 OpenAI 兼容面，因为其 `google-generative-ai` 拒绝注入 fetch（附录 D，W2）。

## 五、波次（顺序，非减法）

| Wave | 内容 | 出口判据 |
|---|---|---|
| W0 | spike S1–S5 + kill-switch 裁决 | 已回填（#1249） |
| W1 | 核心环路（全部在 `workers/edge` 内）：intake + AgentSession DO（alarm 内跑回合）+ pi + mimo + 4 个 catalog 工具 + 连接在时的 SSE + `GET …/messages` 加 run 状态 + 配额结算 | staging 匿名可完整对话；切走再回来拉到完整结果（手动验证，无自动 eval） |
| W2 | parity：web 工具×2、route 工具、BYOK、上下文与记忆（fact_ledger 适配；按 §九 = 跨轮结构化重放 + 写入时冻结的工具返回摘要 + 阈值批量压缩 + `<agent_status>` 状态栏，**不是**每轮滑动窗口再压缩） | 功能对等清单逐项勾（手动验证）+ 同一 session 两轮的系统提示词字节相同 |
| W3 | eval 搬到 TS：框架用 `logfire/evals`（与 pydantic-evals 同数据模型与文件格式，`run_agent_eval.py:133` 的 `Dataset.to_file` 导出 → TS `Dataset.fromFile` 读取；"零迁移"的前提：导出文件里序列化的 8 个评估器名必须以 TS 实现通过 `customEvaluators` 注册、runner 在 Node/Bun/Deno 跑（Workers 内无文件 helper）、两侧包版本钉死；W3 第一张卡 = Python 导出 → TS 导入的 round-trip fixture，跑通前不得声称零迁移）；task = 对 staging 的 HTTP 调用；自写 8 个评估器（4 个官方 agentic：ToolCorrectness / TrajectoryMatch / ArgumentCorrectness / MaxToolCalls，TS 版无内置，轨迹从转录取；4 个自定义照抄 `evaluators.py:162-215`）+ 移植 `gate.py` 的分层配对 bootstrap 统计门 + ANY-of-N + 662 case 双跑 | 双跑无回归（8/29 note 硬条件 3） |
| W4 | 删除 `apps/agent` + uv CI 臂 + 容器构建 + `[[containers]]`/`RuntimeContainer`/#1239 等待逻辑；CD/文档里的 `root` 旧名统一为 edge；空壳 jobs Worker 处置（DONE，#1316）；docs/AGENTS.md/coverage floors 更新；launch 链（#1181/#1183/#1184）接上新架构 | repo 无 Python agent 残留 |

## 六、验收标准

- [ ] **(unit)** DO 状态机：alarm 回收 stuck run、配额回冲 exactly-once、admission 拒绝、dedupe 重放幂等。
- [ ] **(integration)** staging 全链：POST → DO → Neon → GET 取回，run 状态机 running/succeeded/failed 各可达。
- [ ] **(browser)** staging 实测断线续跑：回合中切走 → 回来 GET 拿到完整结果（owner 的核心场景）。
- [ ] **(security)** BYOK/egress 红线全绿（S5 清单逐项）+ 无 Supabase-auth/下游自验证引入。
- [ ] **(eval)** 662 case × 8 evaluator（4 官方 agentic + 4 自定义，与 §五 W3 同一清单）+ 统计门按现行阈值无回归；model-backed，非 faux provider。
- [ ] **(unit)** bundler 产物 smoke 执行门在 CI 常驻。
- [ ] **(api)** 生产行为契约：edge 转发的受信身份 = 唯一身份来源；契约包 zod surface 未破坏。
- [ ] W4 后：`make check` 无 uv 臂；CD 无 agent 容器构建；全仓 `pnpm` 单流水线。

## 七、风险登记

- pi 0.x 破坏性变更 ~2–4 周一次 → 钉版本 + 每周跟进列入 ops 日历；升级窗口固定。
- DO 按 wall-clock 计费（含 LLM 等待）→ W1 出实测账单数字再评估，超预期则把 fanout 拆回普通 Worker + SSE 中继。
- eval 搬迁成本降为 M（`logfire/evals` 与 pydantic-evals 同数据模型与文件格式，框架与数据集零成本）；剩余成本 = 8 个评估器 + `gate.py` 统计门的移植，照抄不重发明。
- 上游 `AgentHarness` 未来落地 → 我们的 DO/Neon 编排以 core Agent 为界，保持可平移。
- **2026-09-01 14:33 staging 的一次 D5（前端 110s 看门狗超时）不在容器层**：容器当时已休眠、Logfire 无 POST 记录，请求在到达 DO 之前就挂在 edge 侧（候选：Turnstile siteverify / `RATE_LIMITER` DO fail-closed / 身份流程）。重写不解决它，不得计入重写收益；需 edge 侧 Workers Logs 定位（现有 API token 无 observability 权限）。
- W1/W2 无自动 eval（owner 接受）→ 这段时间的回归只能靠 staging 手动发现；W3 双跑是 Python 退役的硬前置，不可再往后挪。
- eval 只对真实环境测 → 依赖 staging 可用且 CD 队列畅通；#1204 的 prod 审批门阻塞问题在 W3 前必须修，否则每次合并都要手动拒一次才能跑 eval。

## 附录 A · W0-S1 实测（2026-09-02，#1244 / PR #1260）

真部署 Worker `animichi-spike-pi`（`workers.dev`，无正式路由；测完即删）。脚本 `scripts/spike/pi-s1-measure.sh all`，
13:29–13:31Z：

| case | label | ms | status | detail |
| --- | --- | --- | --- | --- |
| cold | cold wake-up (GET /healthz) | 477 | 200 | 部署后首个请求，无前置流量 |
| warm | warm wake-up (GET /healthz) | 803 | 200 | idle=0 |
| turn-mimo | round trip via mimo（直连 `MIMO_API_KEY`） | 51957 | 200 | clean=yes |
| turn-anthropic | round trip via anthropic | 477 | 503 | 未提供 `ANTHROPIC_API_KEY`，**未测**（非 workerd 故障） |
| turn-gemini | round trip via gemini | 3484 | 200 | clean=yes |
| abort-provider_stream | abort at provider_stream | 9621 | 200 | aborted=yes clean=yes |
| abort-tool_call | abort at tool_call | 26141 | 200 | aborted=yes clean=yes |
| abort-final_frame | abort at final_frame | 34992 | 200 | aborted=yes clean=yes |

结论：
- **唤醒延迟 <1s**（477/803ms），对比 Python 容器睡醒 28–32s、部署后 74s——重写的核心收益成立。
- mimo-v2.5 直连一次回合 **52s**，是模型侧响应时长而非平台开销（同一 Worker 上 Gemini 3.5s）；S2（#1245）定方言时必须把这个数字当基线，若 zen 网关路由显著更快应改路由。
- 三处 abort 均无残留状态，S1 的 abort 验收通过。
- Anthropic 在 workerd 上的往返**仍未证实**（本地无 key）；拿到 key 后跑 `scripts/spike/pi-s1-measure.sh turn --provider anthropic` 补一行即可，不阻塞 S2/S4/S5。
- 已知未覆盖：`enable_request_signal` 开/关对照（8/29 报告 S1 清单项）被 Q1"回合独立于连接"的决定取代，未做。

## 附录 B · W0-S2 实测（2026-09-02，#1245 / PR #1266）

同一 spike Worker，`scripts/spike/pi-s2-compat.sh --route direct`，17:14–17:17Z，19 轮（默认 + 9 个开关各两值），每轮一次
`lookup_spot` 工具往返。zen 路由无 `ZEN_GO_API_KEY`，记为 skipped。

| route | switch | value | tool round trip | streaming usage | wall ms | first token ms |
| --- | --- | --- | --- | --- | --- | --- |
| direct | (defaults) | auto | yes | yes | 6320 | 2288 |
| direct | supportsStore | true / false | yes / yes | yes / yes | 5671 / 7185 | 1586 / 2981 |
| direct | supportsDeveloperRole | true / false | yes / yes | yes / yes | 6908 / 7595 | 1085 / 1901 |
| direct | supportsReasoningEffort | true / false | yes / yes | yes / yes | 11179 / 5611 | 3325 / 1873 |
| direct | supportsUsageInStreaming | true / false | yes / yes | yes / yes | 5777 / 5444 | 711 / 1100 |
| direct | supportsFinishReason | true / false | yes / yes | yes / yes | 8875 / 6702 | 1912 / 1129 |
| direct | supportsStrictMode | true / false | yes / yes | yes / yes | 10795 / 6534 | 1308 / 1281 |
| direct | requiresToolResultName | true / false | yes / yes | yes / yes | 5952 / 11817 | 1358 / 3436 |
| direct | requiresAssistantAfterToolResult | true / false | yes / yes | yes / yes | 4015 / 7534 | 774 / 1788 |
| direct | maxTokensField | max_tokens / max_completion_tokens | yes / yes | yes / yes | 5232 / 28667 | 966 / 2298 |

结论（S2 定版）：
- **mimo 直连不需要任何 compat 覆盖**：pi-ai 的 `detectCompat()` 不认识 `api.xiaomimimo.com`，按 `api.openai.com` 的默认集处理，19 个取值全部完成工具往返且带流式 usage。W1 的 mimo Model 保持"无 `compat`"即可；`maxTokensField` 两种字段名都被接受，沿用默认 `max_completion_tokens`。
- 单轮 wall **4–12s，中位数约 6.5s**，唯一离群值 28.7s（`max_completion_tokens` 那轮）。附录 A 记录的 52s 未复现，按偶发慢响应处理，不作基线。
- zen 路由（`opencode.ai/zen/go`）落在 pi 的 `isNonStandard` 默认集，与直连不同；拿到 `ZEN_GO_API_KEY` 后跑 `--route zen` 补齐即可，不阻塞 W1（W1 用直连）。

## 附录 C · W0-S4 实测（2026-09-02，#1247 / PR #1268）

真部署 spike Worker 的第二个 DO class（`DurableTurnSession`，alarm 内跑回合，`RunStore` 直写 staging Neon 的
`runs` / `run_steps` / `messages`；staging 迁移由 CD 33639988005 落地）。`scripts/spike/pi-s4-durable.sh all`，
17:31–18:03Z，测完即删 Worker。

| case | label | status | detail |
| --- | --- | --- | --- |
| concurrent-turn | 同 session 第二个回合 | 409 | `runs_one_running_per_session` 直接拒绝，无读-改-写竞态 |
| crash-replay | 工具返回后、步骤行写入前崩溃 | succeeded | steps=3，工具真实执行 **4** 次（= 3 + 崩溃那步重跑 1 次），重放不重复执行已落库步骤 |
| long-turn | 5 分钟、3 次工具调用，客户端 5 秒后挂断 | succeeded | steps=3 tools=3，转录完整；DO 计费 wall-clock **100.9s**（脚本侧 1010s 含轮询等待） |

结论：
- **§四 S4 硬条件通过**：回合在 alarm 内独立于客户端连接跑完并落库；admission 由数据库唯一索引承担；
  `(run_id, step_index)` 先落库再继续的幂等契约在真环境成立（崩溃分支精确一次）。
- **§七 计费实数**：一次 3 工具的长回合 DO 活跃 wall-clock ≈ 101s（工具 hold 之和）；按 Paid 计划 400,000 GB-s/月免费额度与
  basic 实例，日常回合（附录 B 中位数 6.5s）远在免费额内，账单风险登记可降级为"W1 上线后按实际用量复核"。
- **给 W1-3（#1252）的硬要求**：spike 的长回合是脚本驱动的；真模型下要让重放落在同一 `step_index`，assistant 的
  tool-call 消息必须与 `run_steps` 一起持久化并从转录重放——这是 W1-3 的实现条件，不是优化项。
- 未覆盖：DO 驱逐后由**新实例**接手的路径只在单元层（fresh host over same storage）证明，真部署未刻意触发驱逐。

## 附录 D · W0-S5 实测（2026-09-03，#1248 / PR #1271）

真部署 spike Worker，`scripts/spike/pi-s5-egress.sh`，02:57–02:58Z，无任何 secret（key 为故意的假值）。策略模块是
生产代码 `workers/edge/src/agent/egress/`（W2 BYOK 卡直接复用）。

| 红线 | 用例 | 结果 |
| --- | --- | --- |
| provider allowlist | openai / anthropic / google 三个精确 host | allow → 真实到达供应商，假 key 得 401/400，**错误文本不含 key** |
| 非 allowlist / 未知 provider / 错误家族 | 3 条 | deny（`host_not_allowlisted` / `unknown_provider`） |
| HTTPS + 443 | `http://`、`:8080` | deny（`scheme_not_https` / `port_not_443`） |
| metadata | `169.254.169.254`、`metadata.google.internal`、IPv4-mapped IPv6 | deny（`metadata_address`） |
| private / loopback / link-local / CGNAT | v4 + v6（含 ULA、`[::1]`、`100.64.0.1`） | deny，各自原因 |
| own infra | `*.workers.dev`、`catalog.internal` | deny（`own_infrastructure`） |
| userinfo 伪装、DNS 指向 loopback 的公共域名 | `localtest.me`、`*.nip.io` | deny |
| 空 key、无 server-key 回退 | — | deny（`empty_key`），从未发出请求 |
| 302 重验 | 指向 metadata / 非 allowlist / 明文 | 第 1 跳即 deny；控制组（合法 302）被跟随 |
| 平台层（无策略直连） | 9 个私网/元数据目标 | Hosted Workers 出站代理自身返回 403（`metadata.google.internal` 530） |

结论：
- **条件 6 的应用层红线全绿**，且平台层对私网/元数据目标有独立的 403——两层防御都实证。
- 仍 **[U]**：DNS 混合 A 记录、验证→连接之间的重绑定，需要自控的 nameserver 才能测；不阻塞 W1（BYOK 在 W2）。
- pi-ai 的 `google-generative-ai` 拒绝注入 fetch（`dist/api/google-generative-ai.js:33`）：W2 的 Google BYOK 走其 OpenAI 兼容面。
- httpbingo 不能发跨域 302，恶意跳转用隔离内 302 源模拟；真实网络只验证了"合法 302 被跟随"这一条。

## 八、留给后续复杂 spec 的 open items

DO 计费实数与并发模型（S4 出数）；typebox↔zod 桥的落点代码；`runs`/Drizzle schema 细节与 migration；`GET …/messages` 的 run 状态字段形状（web 端只多读一个字段）；launch 链（#1181/#1183/#1184）接线顺序；CI lane（coverage floors 迁移、nightly eval 工作流改造为对 staging 的 HTTP 跑）；edge 侧 D5 挂死的定位路径（Workers Logs 权限）。

## 九、上下文与状态栏（owner 2026-09-05，依李博杰第 2 章）

裁决入口 #1297（W2 跨轮工具返回重放 vs 每轮压缩窗口）。参考书为《深入理解 AI Agent》第 2 章，下文按其小节标题引用。本节改的是**上下文粒度**；§三 的**落库粒度**（工具步骤 + 文本段聚合）不变，`messages` / `run_steps` 仍然只追加、不重写。

三条动作合起来的目标是一个可被机器检验的性质：**同一 session 的两轮之间，系统提示词与工具定义逐字节相同，变化的部分全部追加在转录末尾**——即书中「KV Cache 友好的上下文设计」开头三条核心结论的第 1、2 条。收益是跨请求的 Prompt Cache 命中（书「KV Cache 与 Prompt Cache：两个层级的缓存」：缓存读取约为首次计算的十分之一），而不是单次请求内的 KV Cache。

### 9.1 转录重放每一轮的工具调用与结果 → #1377

今天 `workers/edge/src/agent/session/turn-transcript.ts:17-18` 明说：早先一轮的 tool-call 行「degrades to its plain text」，实现在同文件 `messagesForRow` 的 `turn-transcript.ts:115`。这正是书中实验 2-3（「KV Cache 的原理与约束」）点名的两个反模式叠加：**滑动窗口对话历史**（工具结果滑出窗口后 Agent「忘记已获得的结果」，反复重复同一次调用）与**文本格式化方法**（把结构化 role-content 消息压成纯文本流，模型要额外花注意力推断角色边界，表现为「忽略工具调用结果、重复执行已完成的操作」）。

**定案**：转录重放每一轮的 assistant tool-call 消息及其工具结果，作为**结构化消息**（`assistant` + `toolResult`），不再降级为文本。

- 早先各 run 的 `run_steps` 一并载入（今天只载入本 run 的，`turn-transcript.ts:100-104` / `turn-store.ts:75-81`）。
- **崩溃恢复的按 run 配对不变**：`turn-transcript.ts:51-56` 的 `toolCallEnvelopeOf` 用 `messages.response_data` 里的 `run_id` + `step_index` 显式配对，早先 run 的行按各自的 run 配对，本 run 的行仍只与本 alarm 载入的本 run steps 配对；尾部截断分支（`turn-transcript.ts:22-28`）只对**当前 run** 生效，`settledSteps`（`turn-transcript.ts:140-142`）只数本 run 的结果，否则 `StepSequence`（`turn-step-sequence.ts:21-36`）会从错误的序号起步。
- 早先一轮的结果以其**冻结摘要**（9.2）而非原文重放，所以「更大的上下文」是有界的。

### 9.2 工具返回摘要在写入时定稿并冻结 → #1378

书「缓存作为架构约束」：「工具结果的替换字符串在首次出现时就被冻结……即使后续会话重启，系统也会使用完全相同的替换字符串——以保证恢复后的消息序列与缓存中的字节流一致」；「生产级的分层压缩机制」第 1 层「工具结果预算控制」同义。

今天相反：`context-compaction.ts:11-12` 自述「the raw history is replayed and re-compacted on every alarm」，且 `context-compaction.ts:188-190` 明说 pi 每次模型请求都调一次 `transformContext`，于是 `KEEP_RECENT_MESSAGES = 8`（`context-compaction.ts:52`）这个「最新 8 条」窗口在**一轮之内**就随消息增长而滑动：同一条工具结果在第 1 次请求里是原文、第 3 次请求里变成摘要，前缀字节因此每次请求都变。函数本身是纯的（`context-compaction.ts:167-182`），但它产出的**上下文不是字节稳定的**。

**定案**：

1. 摘要在**写入时**决定一次：一个工具结果落 `run_steps` 时，若其文本长度超过 `TOOL_RETURN_MAX_CHARS`（`context-compaction.ts:55`，200 字符），同时持久化它的确定性摘要，与该 step / message 一起写。此后任何 alarm、任何模型请求都读同一个字符串——跨 alarm 字节稳定。
2. **确定性 summariser 保留**：`tool-return-summary.ts:81-85`（含 `tool-return-summary.ts:31-35` 逐字保留 `ordered_candidates` 的分支）不变。理由与书「压缩策略的设计原则」的「语义完整性」一致，也与 `tool-return-summary.ts:6-13` 已写下的理由一致：序数追问（「第二个」）只能对着逐字保留的候选 id 解析。
3. **删除「最新 8 条」的每轮/每请求再压缩**：`KEEP_RECENT_MESSAGES` 及基于它的 `compactToolReturns` cutoff（`context-compaction.ts:177-180`）退役。当前 run 的结果本来就是新写入的，按 (1) 已在写入时定稿。
4. **阈值批量压缩**作为唯一的动态压缩路径，且默认不触发。常量 `CONTEXT_COMPACTION_TRIGGER_TOKENS = 102_400`（= 128k 窗口的 80%），取自书「压缩与 KV Cache：看似矛盾，实则互补」的「最好在上下文接近阈值时批量压缩，而不是每轮都压」与实验 2-10 策略六的阈值触发 + 批量压缩 + 防重复标记三机制。**按现有量级它不会触发**：`context-compaction.ts:26` 记录的实测是本层构建的 3 轮转录 `estimateContextTokens = {tokens:870}`，离 102,400 差两个数量级。它存在是为了给「某个 session 真的逼近窗口」留一条不撞窗的出路，不是日常路径。
5. 实体救援（`context-compaction.ts:119-133` → `retained-entity-ledger.ts`）跟着写入时机走：摘要定稿的那一刻救援一次。`retained-entity-ledger.ts:20-25` 现有的「dedup 是因为每轮重新压缩同一段历史」的自述前提随之失效，dedup 保留但理由改为 alarm 重试的幂等。

### 9.3 `SessionEnvelope` 渲染为 `<agent_status>` 用户消息 → #1379

今天 `turn-instructions.ts:157-161` 的 `turnSystemPrompt(envelope)` 把 `trustedLines`（`turn-instructions.ts:147-153`）拼进系统提示词，`turn-envelope.ts:116` 每轮重算一次。书实验 2-3 的第一条就是**动态系统提示词**：「正确的做法是把时间信息作为用户消息追加到对话末尾」。书「Agent 状态栏在上下文中的具体位置」写得更死：状态栏「实际上是作为**一条 user 角色的消息**插入到上下文末尾的——而不是修改开头的 system 消息。原因正是前面讨论的 KV Cache 约束」。

**定案**：`SessionEnvelope` 的内容改为一条 `role: "user"`、内容以 `<agent_status>` 标签包裹的消息，追加在转录**末尾**（在本轮用户消息之后），每轮**替换**上一条——书「状态更新的两种实现与缓存代价」的**实现一：每轮替换**。选实现一而非实现二（Claude Code 的 `<system-reminder>` 持久追加）的依据是书给的分界：状态较大、每轮都更新时选实现一；且本层转录每次 alarm 从 Neon 重建，状态消息不落 `messages`，实现二会让陈旧状态在上下文里累积却拿不到「只追加」的缓存好处。失效范围只覆盖末尾一轮新增的后缀，整个前缀仍可复用。

状态栏内容（书「Agent 状态栏的构成」的「环境当前状态的观察摘要」一类，逐项对应今天已有的字段）：

| 行 | 来源 | 今天在哪 |
|---|---|---|
| 当前 anime（title + bangumi id，已解析，勿重解析） | `SessionEnvelope.currentAnime`（`session-envelope.ts:79`） | `turn-instructions.ts:104-106` |
| 未决澄清：reason + 有序 `candidate_ids` | `PendingClarification`（`session-envelope.ts:50-54`） | `turn-instructions.ts:109-112` |
| 生效中的用户硬约束（pacing） | `FactLedger.activeHardConstraint()`（`fact-ledger.ts:143`） | `turn-instructions.ts:119-125` |
| 场景引用（用户显式选中的点位） | `FactLedger.activeSceneReferences()`（`fact-ledger.ts:148`） | `turn-instructions.ts:127-129` |
| 压缩救回的逐字实体 | `RetainedEntityLedger.entities`（`retained-entity-ledger.ts:71`） | `turn-instructions.ts:139-144` |
| 本轮各工具的调用次数（成本低才做） | 本 run 的 step 序列（`turn-step-sequence.ts:21-36`） | 不存在，本卡新增 |

约束：

- **只由代码维护**。书状态栏一节的第 1 条注意事项：「状态栏尽量用代码维护……绝不要让它一次性批量统计」，因为「模型几乎无条件地相信状态栏」。本层本来就没有模型抽取环节（`fact-ledger.ts:8-10`：事实来自本轮已落库的 step，不是模型说的），这条继续成立；不得为状态栏引入任何 LLM 汇总。
- **投毒防线不变**：值仍经 `trusted-text.ts` 清洗并按 `turn-instructions.ts:138-143` 的 `「」` 包裹，因为状态栏这条消息虽然挂在 user 槽位，内容全由服务端生成（书同节：「Harness 是在借用 user 角色这个消息槽位」）。
- 澄清的 `id` 仍**不**进状态栏，理由照旧（`turn-instructions.ts:96-100`：那是给客户端和服务端校验器的，不是给模型的）。
- **不删原始上下文**。书同节第 2 条注意事项：状态栏是有损投影，只算了预想会被问到的维度。9.1 的结构化重放是原始记录，状态栏是它之上的加法。

### 9.4 系统提示词里留下什么

`turnSystemPrompt` 去掉 `## Trusted runtime context` 之后，系统提示词 = 一个**常量**，只随模型/工具集变化：

- 静态指令：`TURN_SYSTEM_PROMPT`（`turn-instructions.ts:37-52`，身份、语言、web 工具政策）。
- 输出词汇：`## Answering` 与 `## Compact output`（`turn-instructions.ts:54-67`）——`respond` 工具的 `kind` 词表，是 Python 五个响应模型的移植（`turn-instructions.ts:16-22`）。
- **SD-19 未受信工具输出不变量**：`turn-instructions.ts:69-80`。它是架构级安全要求，不是提示调优（`turn-instructions.ts:24-27`），任何情况下不得移出系统提示词。

由此得到本节的验收锚点：**同一 session 连续两轮，系统提示词字符串逐字节相同**。这条是可测的，也是 9.3 的变异判据。

### 9.5 卡片

| 卡 | 内容 | blocked by |
|---|---|---|
| #1377 | 转录结构化重放（9.1） | — |
| #1378 | 摘要写入时冻结 + 删除滑动再压缩（9.2） | #1377 |
| #1379 | `<agent_status>` 状态栏 + 系统提示词字节稳定（9.3 / 9.4） | #1377 |
