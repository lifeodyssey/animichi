# Spec — agent TS 重写（pi agent core × DO × Neon 单一真相源）

- Status: OPEN — owner 已定方向（2026-09-01 grilling），本文件为简化版权威决策记录；复杂化 spec 由后续更强的模型在此基础上扩展。
- 决策输入：`docs/specs/2026-09-01-pi-agent-core-research-report.md`（workerd 实测通过）× `docs/iterations/production-readiness-2026-08/PI-AGENT-CORE-RESEARCH.md`（8/29 NO-GO 全量迁移 / GO 限 spike 门——本 spec 保留其门）× `docs/specs/2026-08-17-agent-ts-research-report.md`（#1106）。
- 战略动机：消灭 Python 容器冷启动（2026-09-01 实测：睡醒唤醒 28–32s、部署后 74s；PR #1239 只是把库的 20s 等待预算放宽到 55s，没有缩短冷启动本身）；异步病根（#729 / #1235 request-parked ingest / turn 生命周期补丁群）根治为"回合活在请求之外、Neon 唯一真相源"；仓库收敛为纯 TS 单流水线。
- 2026-09-01 二轮 grilling（Q1–Q5，owner 定案）：回合宿主 = DO alarm；断线 = 不续流、回来按会话 ID 拉最终结果；W1/W2 不设自动 eval；eval 只对真实环境测；agent 住进 `workers/edge` 不新建 Worker。已并入 §二–§八。

## 一、目标 / Non-goals

**目标**：`apps/agent`（Python 23,563 生产行）整体退役，chat agent 以 TS 重写跑在 Cloudflare Workers DO 上，Neon 为唯一真相源，全量功能对等（6 模型工具、BYOK、compaction/memory、662-case eval 统计门），完成后直接删除 Python，无影子期。

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
- **S2**：mimo-v2.5 网关方言定版（compat 开关阵逐项实测：tool calling 往返 / strict / maxTokensField / streaming usage）。
- **S3**：esbuild `.lazy` chunk bug——file upstream issue；我方 CI 加"bundler 产物 smoke 执行"门；先用已验证 workaround。
- **S4**：DO 状态机：并发同 session、eviction/restart、provider/tool 中途故障 → 进行中 turn 必须能恢复到"收尾一致"（不依赖上游 harness）。**硬条件（Q1 定）**：在真部署 DO 的 alarm handler 内跑一个刻意 5 分钟、含 3 次工具调用的回合，期间客户端断开，最终 Neon 里 run=succeeded 且转录完整；同时实测 alarm 内一次回合的 DO 计费 wall-clock。**该 spike 使用独立的 spike-only 回合 deadline（≥ 6 分钟，spike 配置项，不进生产默认值）**——生产的整回合 deadline 仍是 100s（§二），5 分钟只是为了逼近 alarm 的 15 分钟上限做压力验证；恢复用例必须含"工具成功但结果未落库前崩溃"分支（§三 幂等契约）。
- **S5**：BYOK/egress 红线（8/29 note 条件 6 全表：allowlist、非空 key、无 server-key fallback、SSRF 边界、redirect、日志脱敏）。

**Kill-switch**：S1–S5 任一硬失败 → 内核层回退 Vercel AI SDK ToolLoopAgent（#1106 的 39/60 基线，输出回喂自建 ~50–100 行）；**架构壳（DO/Neon/intake/GET）不变**，只换 loop 层。spike 结论与复测数据必须回填本 spec 后才进 W1。

## 五、波次（顺序，非减法）

| Wave | 内容 | 出口判据 |
|---|---|---|
| W0 | spike S1–S5 + kill-switch 裁决 | 结论回填 §四 |
| W1 | 核心环路（全部在 `workers/edge` 内）：intake + AgentSession DO（alarm 内跑回合）+ pi + mimo + 4 个 catalog 工具 + 连接在时的 SSE + `GET …/messages` 加 run 状态 + 配额结算 | staging 匿名可完整对话；切走再回来拉到完整结果（手动验证，无自动 eval） |
| W2 | parity：web 工具×2、route 工具、BYOK、compaction/memory（fact_ledger 适配） | 功能对等清单逐项勾（手动验证） |
| W3 | eval 搬到 TS：框架用 `logfire/evals`（与 pydantic-evals 同数据模型与文件格式，`run_agent_eval.py:133` 的 `Dataset.to_file` 导出 → TS `Dataset.fromFile` 读取；"零迁移"的前提：导出文件里序列化的 8 个评估器名必须以 TS 实现通过 `customEvaluators` 注册、runner 在 Node/Bun/Deno 跑（Workers 内无文件 helper）、两侧包版本钉死；W3 第一张卡 = Python 导出 → TS 导入的 round-trip fixture，跑通前不得声称零迁移）；task = 对 staging 的 HTTP 调用；自写 8 个评估器（4 个官方 agentic：ToolCorrectness / TrajectoryMatch / ArgumentCorrectness / MaxToolCalls，TS 版无内置，轨迹从转录取；4 个自定义照抄 `evaluators.py:162-215`）+ 移植 `gate.py` 的分层配对 bootstrap 统计门 + ANY-of-N + 662 case 双跑 | 双跑无回归（8/29 note 硬条件 3） |
| W4 | 删除 `apps/agent` + uv CI 臂 + 容器构建 + `[[containers]]`/`RuntimeContainer`/#1239 等待逻辑；CD/文档里的 `root` 旧名统一为 edge；空壳 `workers/jobs` 处置；docs/AGENTS.md/coverage floors 更新；launch 链（#1181/#1183/#1184）接上新架构 | repo 无 Python agent 残留 |

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

## 八、留给后续复杂 spec 的 open items

DO 计费实数与并发模型（S4 出数）；typebox↔zod 桥的落点代码；`runs`/Drizzle schema 细节与 migration；`GET …/messages` 的 run 状态字段形状（web 端只多读一个字段）；launch 链（#1181/#1183/#1184）接线顺序；CI lane（coverage floors 迁移、nightly eval 工作流改造为对 staging 的 HTTP 跑）；edge 侧 D5 挂死的定位路径（Workers Logs 权限）。
