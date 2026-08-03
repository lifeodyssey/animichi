# C5 — 两侧 Clean Architecture 用例层归位(#666,建立在 C4 九张 Protocol 之上)

**结论:Python 侧把 `interfaces/` 里的 6 个应用服务模块 + `RuntimeAPI` 编排整体迁入 `agent/application/`(interfaces 只剩 fastapi/routes/chat_wire 三类 wire 适配),依赖收 C4 窄 Protocol;守护不变量 = "wire 层不含业务决策、application 不 import infrastructure(组合根除外)",用 **import-linter layers+forbidden 契约**钉死(现存违例 6,起步 ignore-ratchet)。TS 侧不造 class 仪式:catalog `api/*` 与 users `api/routes.ts` 的函数模块**已是用例**,只做两件事——users 行映射抽 `lib/rows.ts`(与 B4 协同)+ catalog 封死 `api→ingest 内部件` 深入口;约束用 **oxlint `no-restricted-imports`**(零新依赖,复用 L1 的 --deny-warnings 门)。**

## 1. Python(apps/agent)用例层重建

现状实测:`application/` 只有 errors.py;真正的应用层散在 `interfaces/`(public_api.py 875 行 + persistence 384 + session_facade 338 + usage_metering 149 + anon_quota 99 + response_builder)。agents/domain 零上行 import(已测),病灶只在 interfaces 混层。

**用例清单(现居 public_api.py,行号 2026-08-03 实测)**:

| 用例(→ application/use_cases/) | 入参 → 出参 | C4 Protocol 依赖 | 现居 |
|---|---|---|---|
| `HandleChatTurn`(主编排:handle+_prepare/_load_session+_execute_pipeline+_dispatch+_model_request) | `PublicAPIRequest`+identity(user_id/user_type/is_byok)+model override+`OnStep` → `PublicAPIResponse` | SessionRepo·ConversationLog·CatalogLookup(经 runner)·UsageMeter·RequestAudit + SessionStore/MemoryStore 新港口(§下) | 236-335, 363-373, 375-393, 395-532, 534-559, 604-637 |
| `ExecuteSelectedRoute` | point_ids+`SessionState`+origin+locale → `AgentResult` | CatalogClientProtocol | `_point_selection` 561-574(实体已在 agents/selected_route.py,薄委托即可) |
| `ExecuteMultiSelection` / `ExecutePlaceSelection` | candidate_ids/candidate_id+state+locale → `AgentResult` | CatalogClientProtocol | `_candidate_selection` 576-602(实体 agents/selection.py) |
| `MeterTurnUsage`(实测新发现) | `AgentResult`+identity+`UsagePrices` → None | UsageMeter | `_record_usage` 343-361 + `_record_attributed_usage` 836-845 + usage_metering.py:78/102 |
| `AuditRequest`(实测新发现) | session_id+request+result+latency → None(best-effort) | RequestAudit·ConversationLog | `_log_request` 666-713(:698 getattr 死路径由 C4-B1 先修) |
| `PersistTurn`(实测新发现) | session_id+request+result+response+delta → (state,persisted,title) | SessionRepo·ConversationLog | persistence.py:57 `persist_result`(:148/:227/:243 同迁) |
| `ValidateSessionOwner` | session_id+user_id → None/404 语义错误 | SessionRepo | 224-234(HTTPException 换 ApplicationError,wire 层再译 404) |
| `ApplyTranslationGate`(实测新发现) | `AgentResult`+locale+payer 隔离 → None(原地改 message) | —(模型解析) | 777-827 + 639-664 |
| `CheckAnonQuota`(实测新发现) | anon_id+date → verdict | AnonQuotaCounter | anon_quota.py:66 |

**新港口(C4 未覆盖,C5 补 2 张)**:`SessionStorePort`、`MemoryStorePort` —— `HandleChatTurn` 现直接 `from agent.infrastructure.{session,memory} import ...`(public_api.py:63/68),是 forbidden 契约的主违例源;Protocol 放 domain/ports.py,实现留 infrastructure。

**mapper 归位**:`agent_result_to_response`(response_builder.py:144)= domain `AgentResult` → 应用 DTO `PublicAPIResponse` 的映射,随 schemas.py(DTO)一起迁 `application/`(mappers.py + dto.py);interfaces 只剩 chat_wire(SSE 帧)与 routes(HTTP 状态码/headers)。`build_response_session`/`extract_plan_steps`(persistence.py:371/381,纯查询)同归 mappers。无兼容 shim(owner 政策:重构期不留 backward compat)。

**import-linter 契约(pyproject.toml,新 dev dep;make lint 加 `uv run lint-imports`)**:
```toml
[tool.importlinter]
root_package = "agent"
[[tool.importlinter.contracts]]
name = "layers"; type = "layers"
layers = ["agent.interfaces", "agent.application", "agent.agents | agent.tools | agent.clients", "agent.domain"]
[[tool.importlinter.contracts]]
name = "infra-only-from-composition-root"; type = "forbidden"
source_modules = ["agent.interfaces", "agent.application", "agent.agents", "agent.domain"]
forbidden_modules = ["agent.infrastructure"]
ignore_imports = [  # 组合根 + 明文 sanctioned 横切面(F8 observability、T13 egress 卫兵)
  "agent.interfaces.fastapi_service -> agent.infrastructure.*",
  "agent.interfaces.routes._deps -> agent.infrastructure.*",
  "* -> agent.infrastructure.observability.*", "* -> agent.infrastructure.egress_*",
]
```
**现存违例实测(上述豁免后)= 6**:public_api.py:63(memory)/:68(session)、persistence.py:23(session)、session_facade.py:17(session)——即 SessionStore/MemoryStore 港口化解决 4 处;tools/eval_feedback_miner.py:61 + eval_scorer.py:83(lazy import SupabaseClient,dev 工具,改收窄参数)。layers 契约今天即 0 违例(agents/domain 上行已测为零)。**方案对比**:import-linter vs 自写 AST 检查——选 import-linter:声明式契约 + `ignore_imports` 白名单可逐条销账(与 L1 的 overrides 销账法同构)、社区维护;自写 AST 脚本要自担 300 行维护 + 无 ratchet 语义,唯一优势(检查 getattr 反射)C4 已用窄 Protocol 根治。

## 2. TS 侧同构(函数模块即用例,不造 class)

- **workers/users**:api/routes.ts(147 行)的 `listRoutes/saveRoute/deleteRoute/claimRoutes` 已是显式用例(收 `DbExecutor` 注入,含 `assertOwner` 所有权不变量)。改两处:① 行映射 `toUserRoute/iso/nullableIso/strings/isStatus/ownerFrom`(routes.ts:15-52/77-82)抽 `src/lib/rows.ts` = DB row→contract 的唯一入口(与 B4 卡协同;timestamptz 归一化集中于此,守护不变量="wire 上只出 ISO 字符串与 contract 形状");② 顺手满足 L1 对该文件的 ×5 函数限拆分。router.ts(32 行)与 index.ts(76 行)已是"解析→用例→序列化",不动。
- **workers/catalog**:ingest→enrich→publish 已是管道;api/* 已是 `(db, input) → contract 输出` 的用例函数,router.ts 的 oRPC handler 已瘦(错误翻译 callSpots/callAnimeOverview 留在 router,正确)。**实测越界 = api→ingest 内部件 8 处/4 文件**:work-points.ts:11-13(含 `JobStore` 深入口)、search.ts:36-37、resolve.ts:5(`enrich/parse` 的 `parseBangumi`)+:12、preview.ts:13。方案:ingest 出一个门面 `ingest/index.ts`(orchestrator 公开面 + `FetchLike` 型别),api 只许进门面——`JobStore`(jobs.ts)与 `enrich/parse` 直捣内脏的 2 处是真违例要改线;其余 6 处改经门面 re-export 即合法(守护不变量="读路径只能经 orchestrator 触发 ingest,永不绕过 singleflight/TTL")。pipeline→api 反向 = 0(实测)。zod 值 import 在 src/ = 0(实测,契约边界纪律已达标)。
- **约束工具对比**:dependency-cruiser vs oxlint `no-restricted-imports`——选 oxlint:零新依赖、已是 `--deny-warnings` 硬门(L1 卡正在收编全 workspace)、per-override glob 可表达"api/** 禁 `../ingest/(jobs|sources)`、`../enrich/*`;所有文件禁 `../db/schema` 值引"。dep-cruiser 胜在环检测/可视化,但多一条 CI 链路且规则与现有 lint 门分裂;环检测需求出现再引入。配置草案(catalog/.oxlintrc.json overrides 节):
```jsonc
{ "files": ["src/api/**"], "rules": { "no-restricted-imports": [2, { "patterns": [
  { "group": ["../ingest/*", "!../ingest/index"], "message": "api goes through the ingest facade" },
  { "group": ["../enrich/*", "../publish/*", "../media/*"], "message": "pipeline internals" } ] }] } }
```
users 侧对应规则:`src/index.ts`/`src/router.ts` 禁 `./db/*` 值引之外的深依赖(现 0 违例,纯设防)。

## 3. 分批与测试策略(每批独立绿、行为零变化)

- **P0(先行快照,TDD 前置)**:为 `handle()` 六条路径(模型轮/点选/候选选/timeout/provider_error/byok 拒绝)落 characterization test——fake model + C4 窄 Protocol double,断言 `PublicAPIResponse.model_dump()` 全字段快照 + repo 调用记录。迁移期间此套件一行不许改(变异验证:任一用例体注释掉须变红)。
- **P1**:usage_metering/anon_quota/persistence/session_facade/response_builder/schemas 整文件迁 `application/`,纯 mv+import 改写,`make check` 前后各跑。**与 C4-B2 撞文件(persistence/session_facade),必须排在 C4-B2 之后**。
- **P2**:public_api.py 拆用例(§1 表),RuntimeAPI 退役为 routes/_deps 组合根装配;SessionStore/MemoryStore 港口化。排 C4-B3 之后(同文件)。
- **P3**:import-linter 上 CI。ignore 清单分两类,别混:**常设 sanctioned 豁免**(组合根 fastapi_service/routes._deps 两条 + observability/egress 横切面两条,§1 契约里的 4 条——是架构决定,长期保留)与**债务豁免**(eval tools 两条,开 issue 销账,销完清零)。P1 后债务违例即 0-2,P3 完成时 ignore 清单 = 常设 4 条 + 债务 ≤2 条。
- **T1(TS,与 P* 全程可并行)**:users `lib/rows.ts` 抽取(先给 toUserRoute 快照测试:draft/null saved_at/Date 与 string 双形态)→ catalog ingest 门面 + 2 处真违例改线 → oxlint 规则落 .oxlintrc.json。

## 4. 明确不做(及理由)

- **战术 DDD(聚合根/领域事件/CQRS)**:owner 已裁;单写者、无并发不变量竞争,聚合根守护的不变量(所有权/singleflight)现由 `assertOwner`+DB 唯一约束已守住,仪式无增益。CQS 注释级实践(public_api.py:526-531)保留即可。
- **edge worker(worker/)不套用例层**:纯转发/鉴权域,无应用状态;其拆分归 C2 卡(app.ts 按信任域)。
- **frontend apps/web**:TanStack 路由即边界,cutover 期不叠架构改造;rebuild 完成后另立卡。
- **catalog api/* 改 class 用例、users 引 repository 类**:TS/Hono 惯用函数模块 + 参数注入已满足 DIP,class 仪式违反 1-10-50 的精神。

---
执行顺序(3 行):
1. C4-B1(#663 修复)→ C4-B2/B3(窄 Protocol 收签名)先行落地;C5-P0 快照与 T1(TS 侧)同期并行开工。
2. C4 收尾后 C5-P1(应用层文件迁移)→ P2(public_api 拆用例 + 双港口)。
3. 最后 P3 import-linter + oxlint 规则双门上 CI(与 L1 卡的 .oxlintrc 收编合并提交,避免两次动同文件)。
