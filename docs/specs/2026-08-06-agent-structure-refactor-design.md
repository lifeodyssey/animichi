# Agent 结构重构设计（已有代码 · 真搬家 / 化简 / SOLID）

- Status: **ACCEPTED**（owner 2026-08-06 — best-practice 默认；**不含实现 / 不含产品 enabler**）
- Date: 2026-08-06
- Package: `apps/agent` only（`src/animichi/`）
- Parent CA: [`2026-08-06-agent-clean-architecture-design.md`](./2026-08-06-agent-clean-architecture-design.md)（ACCEPTED）
- Greenfield: [`2026-08-06-greenfield-language-and-data-plane.md`](./2026-08-06-greenfield-language-and-data-plane.md)
- Inventory basis: **仓库实文件**（2026-08-06 读盘）；禁止凭想象补目录

---

## 0. 范围与原则

| 锁 | 含义 |
|---|---|
| **ONLY `apps/agent`** | 不设计 edge / web / users 产品能力 |
| **已有代码** | 移文件、抽 use case / port、删死路径、对齐 SOLID 与 1-10-50 |
| **非只 rename** | 语言改名只作为搬家列车的同车或紧邻切片，不单独当目标 |
| **Catalog 只读客户** | 删主数据双写 / 双读死路径；**Session / Conversation / fact ledger / quota / usage 写保留** |
| **未写产品** | `match_scene` 全管线等 → **ticket 指针 only**，本文件不落 runtime |

**发布语言（本包）：** `Point` · `Itinerary` · `Session` · `Bangumi`。
**SavedRoute** 归属 Users；Agent 侧若仍有 session 内 `routes` 归档表，语义是 **Session 附属行程快照**，不得冒充 SavedRoute 权威。

依赖硬规则（继承 parent CA §3）：

```text
FastAPI · PydanticAI · asyncpg · httpx · Logfire
        ▲
interfaces/ (inbound) + infrastructure/ (outbound impl)
        ▲
application/  (use cases)
        ▲
domain/       (Session 规则 · entities · Port Protocols)
```

- `domain/` 不 import FastAPI / PydanticAI runtime / infrastructure 实现
- `application/` 只依赖 domain + Protocol
- `agents/` = **PydanticAI 外圈适配器**（tool 绑定 + runner），调用 application/domain，禁止反向
- 抽象纪律：优先 **删** 错误分层与上帝对象，再加 port；禁止空 interface 表演

---

## 1. Current inventory

路径根：`apps/agent/src/animichi/`。下列为 **实存** 模块角色与主要职责（非愿望目录）。

### 1.1 `agents/` — 现状最大混合包（framework + 编排 + 部分 domain 形状）

| 文件 / 子树 | 角色（今日） | 目标层 |
|---|---|---|
| `animichi_agent.py` | PydanticAI `Agent` 构造、instructions、hooks、memory capability | **agents/** 外圈（保留） |
| `animichi_runner.py` (~330 LOC) | `run_animichi_agent`：注入 RuntimeDeps、preflight、模型 run、partial/blocked | **agents/** 薄 runner；主路径语义 → **application** |
| `animichi_tools.py` | 四 catalog tools 的 PydanticAI 包装 → `catalog_tools` / `catalog_route_tools` | **agents/** tool surface |
| `web_tools.py` · `web_trust.py` | web_search / 注入检测 | **agents/** |
| `catalog_tools.py` (~278 LOC) | resolve / search_bangumi / search_nearby 业务循环 + Session 写入 | **application**（catalog 用例）+ 适配残留在 agents |
| `catalog_route_tools.py` | plan_route | 同上 |
| `catalog_adapter.py` | Catalog DTO → `SessionState` / wire payload（`build_search_state` / `build_route_*`） | **application** 或 `infrastructure/catalog` 映射；**不属 domain** |
| `catalog_failures.py` | 失败文案 / 结果形状 | agents 或 application 错误映射 |
| `runtime_deps.py` | `RuntimeDeps`：`db: CatalogLookup` + **`catalog: CatalogClientProtocol`** + tool_state | 拆：catalog port 单路径；`db` 主数据侧删除 |
| `runtime_models.py` | 模型 output types（Search/Route/Clarify/…） | **agents/**（PydanticAI 外圈 DTO） |
| `session_state.py` (~293 LOC) | 版本化 Session 注册表（search/route refs、fact_ledger 挂载） | **domain/session** |
| `session_ownership.py` | 会话归属 | domain 或 application |
| `tool_state.py` · `tool_outcomes.py` · `tool_event_bridge.py` | 工具状态 / 判别结果 / 生命周期事件 | agents 运行时细节；outcomes 可留 agents |
| `selection.py` (~373 LOC) · `selection_messages.py` | multi/place 选择（旁路模型） | **application**（`ApplySelection` 类用例） |
| `selected_route.py` | 选点直算 Itinerary（`catalog.route`） | **application**（`RequestItinerary`） |
| `agent_result.py` | 运行结果 / provenance / usage | agents ↔ application 边界 DTO（可放 application 或 agents） |
| `step_recording.py` | 服务端 step 记录 | agents / application 协作 |
| `history_compaction.py` | 历史压缩 capability | agents（PydanticAI）+ domain 规则已在 `compaction_retention` |
| `photo_search.py` · `photo_vision.py` | 图片搜圣地 | application use case + agents 适配 |
| `translation.py` · `title_matching.py` | 标题翻译 / 变体匹配 | application 或 agents 工具侧 |
| `byok_models.py` | BYOK 模型构建（依赖 egress_*） | **infrastructure/llm** 或 agents 外圈；egress 留 infrastructure |
| `base.py` | model alias 解析、httpx model client | infrastructure 或 agents/llm |
| `error_boundary.py` · `error_messages.py` | 工具错误边界 / 用户可见文案 | agents + interfaces 映射 |
| `export/` · `route_export.py` · `route_area_splitter.py` | ICS / maps URL / 区域切分 | application 工具函数或 agents/export |
| `geo_utils.py` · `geo_names.py` · `data/city_names_jp.json` | 地理辅助 | domain VO 辅助 或 infrastructure/geo |
| `models.py` | `TimedItinerary` / `TimedStop` / `TransitLeg` / `ToolName` | **domain** 或 catalog 消费 DTO（与 greenfield `Itinerary` 对齐） |
| `source_tiering.py` | 来源分层 | domain / application 策略 |
| `handlers/_helpers.py` | 图片 URL rewrite、nearby groups | **infrastructure** 或 catalog adapter 内部 |
| `handlers/__init__.py` | 空壳说明 | 可删或收敛 |

**观察：** 工具链路已 **catalog-only**（`deps.catalog`）；`RuntimeDeps.db: CatalogLookup` 在 `agents/` 内 **无 `deps.db` 读点**（grep 空），但是 runner / RuntimeAPI 仍注入并 cast —— **死双路径注入**。

### 1.2 `application/` — 极薄

| 文件 | 内容 |
|---|---|
| `__init__.py` | 仅说明 errors |
| `errors.py` | `ApplicationError` 族 + `ErrorCode` |

**无** `HandleUserMessage` / `StreamAgentTurn` / `RestoreSession` 等用例模块。主路径在 `interfaces/public_api.RuntimeAPI` + `agents/animichi_runner`。

### 1.3 `domain/`

| 文件 | 内容 | 评价 |
|---|---|---|
| `entities.py` | `Coordinates`, `Station`, `Bangumi`, `Point`, **`Route`/`RouteSegment`**, `AnimichiSession`, `TransportInfo` | 真 domain 碎片；**`Route` 应 → `Itinerary`**；`AnimichiSession` 与 runtime `SessionState` **双轨** |
| `ports.py` | `BangumiRepo`（含 **upsert**）、`PointsRepo`（含 **upsert_points_batch**）、`CatalogLookup`、`SessionRepo`、`RouteArchive`、`UsageMeter`、`AnonQuotaCounter`、`ConversationLog`、`RequestAudit` | Port 形状正确一半；**主数据写 + CatalogLookup 聚合是债** |
| `fact_ledger.py` | pacing / scene refs；`record_turn_facts` | **真 Session domain** |
| `compaction_retention.py` | 压缩保留实体账本 | **真 Session domain** |
| `text_sanitize.py` | 截断 | domain 工具 |
| `errors.py` | `DomainException` 等 | 与部分旧流程相关；审计是否仍被调用 |
| `llm_schemas.py` | 旧 Gemini 抽取 schema（`BangumiNameExtraction` 等） | **疑似遗留**；重构时确认引用后删或迁 spikes |

`domain/` 内部 import 仅 domain 自引用 —— **依赖方向已干净**。

### 1.4 `infrastructure/`

| 子树 / 文件 | 角色 |
|---|---|
| `supabase/client.py` · `client_types.py` · `helpers.py` | Neon/asyncpg 客户端门面 |
| `supabase/repositories/bangumi.py` | 含 **`upsert_bangumi` / `upsert_bangumi_title`**、`filter_existing_ids`、list/get |
| `supabase/repositories/points.py` | **读** + **`upsert_point` / `upsert_points_batch`** |
| `supabase/repositories/routes.py` | `save_route` → 表 `routes`（**Session 侧归档**，非 Users SavedRoute） |
| `supabase/repositories/session.py` | sessions / conversations / claim / purge 查询 |
| `supabase/repositories/messages.py` | `conversation_messages` |
| `supabase/repositories/usage.py` · `anon_quota.py` · `feedback.py` | 计量 / 配额 / 反馈 |
| `session/` | `SessionStore` factory / memory / supabase_session |
| `gateways/geocoding.py` | 出站 geocode（若仍用） |
| `egress_*.py` | SSRF 防护传输（BYOK） |
| `memory.py` | postgres memory store |
| `observability/` | logfire spans |
| `safe_output_path.py` | 路径安全 |
| `migrations/` | 空包占位 |

### 1.5 `interfaces/` — 入站 + **部分应用编排**

| 文件 | 角色 |
|---|---|
| `fastapi_service.py` | app 工厂、lifespan、catalog client 注入 |
| `public_api.py` (~896 LOC) | **`RuntimeAPI`**：会话准备、pipeline、选择旁路、翻译门、持久化编排、usage —— **上帝对象** |
| `persistence.py` (~400+ LOC) | `persist_result` / messages / session / **`maybe_persist_route`**（读 `bangumi_repo.filter_existing_ids`） |
| `session_facade.py` | session envelope 归一、context block、history |
| `response_builder.py` | `AgentResult` → `PublicAPIResponse` |
| `chat_wire.py` · `schemas.py` | wire DTO |
| `db_repos.py` | `db: object` → 窄 Protocol 抽取（含 `bangumi_repo`） |
| `anon_quota.py` · `usage_metering.py` | 配额 / 计量用例式函数 |
| `error_registry.py` | 对外错误映射 |
| `routes/chat.py` · `chat_stream.py` · `chat_body.py` | AI SDK 入站 |
| `routes/photo_search*.py` · `byok.py` · `conversations.py` · `session_migration.py` | 边界路由 |
| `routes/bangumi.py` | **直连 DB 读** `points`/`bangumi`（**主数据双读**） |
| `routes/search_preview.py` | **直连 DB 读** |
| `routes/health.py` · `runtime.py` · `feedback.py` | 运维 / 反馈 |
| `routes/_deps.py` · `_middleware.py` | 依赖与中间件 |

### 1.6 `clients/`

| 文件 | 角色 |
|---|---|
| `catalog_client.py` (~370 LOC) | HTTP Catalog；镜像类型 **`PilgrimagePoint`**, **`Route`**（应对齐 **Point / Itinerary**）；`CatalogClientProtocol` |
| `catalog_errors.py` | oRPC 错误镜像 |
| `geocode.py` | geocode DTO（client 侧） |
| `errors.py` | `APIError` / `TransientAPIError` |

### 1.7 其它（本重构不强制搬家）

| 路径 | 说明 |
|---|---|
| `config/` | settings、model aliases、cron、byok defaults |
| `utils/` | language、logger |
| `scripts/` · `spikes/codemode/` | 运维 / 实验；spike 不进生产分层 |
| `tests/` | unit / integration / eval；随切片改 import，不预建空 domain 测试树 |

### 1.8 主数据双路径（写 / 读）— 实况

| 路径 | 存在位置 | 生产调用 |
|---|---|---|
| **写** `upsert_points*` / `upsert_bangumi*` | `domain/ports.py` Protocol + `infrastructure/.../points|bangumi.py` | **无业务调用点**；仅 unit / `NullDatabase` / repo 单测 |
| **读** catalog 工具 | `CatalogClient` only | 主路径正确 |
| **读** HTTP `routes/bangumi.py` · `search_preview.py` | 直连 `db.bangumi` / `db.points` | **仍活**；违反 X12「只经 Catalog」 |
| **读** `filter_existing_ids` | `maybe_persist_route` | Session 归档时校验 bangumi id 是否在本地表 — **主数据读耦合** |
| **注入** `RuntimeDeps.db: CatalogLookup` | runner / RuntimeAPI | agents 内未用；可删 |

Greenfield / parent A3：**删除** 写端口与实现优先于标债；读统一 **CatalogGateway**；Session 写保留。

---

## 2. File / function move table（from → to）

目标树（与 parent CA §4 对齐；**近端可保留 `interfaces/` 名**，不强制一次改成 `adapters/`）：

```text
animichi/
  domain/
    model/                 # Point, Bangumi, Itinerary, Coordinates, …
    session/               # SessionState, fact_ledger, compaction_retention
    ports.py               # 仅 Protocol（无主数据 upsert）
    errors.py
  application/
    handle_user_message.py
    stream_agent_turn.py   # 若从 chat_stream 抽出
    apply_selection.py
    request_itinerary.py
    search_points.py       # 自 catalog_tools 抽出的纯用例内核
    photo_search.py
    persist_turn.py        # 自 persistence 抽出的会话写编排
    errors.py              # 已有
  agents/                  # PydanticAI only: agent, tools, runner 薄壳, runtime_models
  infrastructure/
    catalog/               # CatalogClient 实现 + DTO 映射
    session_store/
    supabase/…             # Session/messages/quota 等（无 points/bangumi 写）
    egress/ · observability/
  interfaces/              # FastAPI routes, wire, RuntimeAPI 薄 facade
  config/ · tests/
```

### 2.1 必做搬家 / 函数迁移

| from | to | 备注 |
|---|---|---|
| `agents/session_state.py`（`SessionState`, ref 注册表, PointState…） | `domain/session/state.py`（或 `domain/session/session_state.py`） | Session 权威形状；agents/application 共引 |
| `domain/fact_ledger.py` | `domain/session/fact_ledger.py` | 可选同 PR 子目录整理 |
| `domain/compaction_retention.py` | `domain/session/compaction_retention.py` | 同上 |
| `domain/entities.py` 中 `Point`/`Bangumi`/`Coordinates`/`Station` | `domain/model/*.py` | **`Route` → `Itinerary`**；删或合并与 `SessionState` 重复的 `AnimichiSession`（确认无引用后删） |
| `agents/models.py` 中 `TimedItinerary`/`TimedStop`/`TransitLeg` | `domain/model/itinerary.py` **或** 与 catalog 消费 DTO 合并到 `infrastructure/catalog/dto.py` 再 map 进 domain | 避免三套 Itinerary |
| `clients/catalog_client.py` 类型 `PilgrimagePoint`/`Route` | 改名 **`Point`/`Itinerary`**；实现迁 `infrastructure/catalog/client.py`；**Protocol** 升为 `domain/ports.CatalogGateway` | Protocol 在 domain；httpx 实现在 infrastructure |
| `agents/catalog_adapter.py` | `infrastructure/catalog/session_mapper.py` 或 `application/catalog_mapping.py` | 纯函数映射；不碰 DB |
| `agents/catalog_tools.py` 内核 `run_resolve` / `run_work_search` / `run_nearby_search` | `application/search_points.py`（+ 细分文件若 >300 LOC） | PydanticAI `RunContext` 包装留 `agents/animichi_tools.py` |
| `agents/catalog_route_tools.py` `run_route` | `application/request_itinerary.py` | 同上 |
| `agents/selected_route.py` `execute_selected_route` | `application/request_itinerary.py`（同用例族） | 选点旁路 |
| `agents/selection.py` `execute_multi_selection` / `execute_place_selection` / `validate_candidate_selection` | `application/apply_selection.py` | 确定性旁路 |
| `interfaces/public_api.py` `RuntimeAPI.handle` 主体 | `application/handle_user_message.py` | RuntimeAPI 只做 DI + 调 use case + 错误→HTTP |
| `interfaces/public_api.py` 选择 / 翻译 / pipeline 私有方法 | 同上 use case 或 `application/translate_title_gate.py` | 拆 1-10-50 |
| `interfaces/persistence.py` `persist_result` 族 | `application/persist_turn.py` | ports: SessionRepo, ConversationLog, RouteArchive, … |
| `interfaces/session_facade.py` 中 **无 FastAPI** 的 session 归并 | `application/session_context.py` 或 domain 服务 | wire 相关留 interfaces |
| `interfaces/anon_quota.py` · `usage_metering.py` | 可标为 application 配额用例（物理搬家或文档层角色二选一，优先搬家） | 已接近 use case 形态 |
| `agents/photo_search.py` 业务 | `application/photo_search.py` | route 与 vision 钩子留 interfaces/agents |
| `agents/handlers/_helpers.py` | `infrastructure/catalog/image_proxy.py` + nearby group helper 旁路 | 去掉空 `handlers/` 包若无其他模块 |
| `agents/byok_models.py` 中 egress 组装 | 可留 agents 或 `infrastructure/llm/byok.py` | 保持 T12 工厂不散落 |
| `domain/ports.BangumiRepo` upsert* · `PointsRepo` upsert* | **删除** | 连同 repository 写方法 |
| `domain/ports.CatalogLookup` | **删除**；读一律 `CatalogGateway` | RuntimeDeps 去掉 `db` |
| `infrastructure/.../points.py` upsert* | **删除** | 测删或改断言「不存在」 |
| `infrastructure/.../bangumi.py` upsert* | **删除** | `filter_existing_ids`：改为不读主表（见 §2.2） |
| `interfaces/routes/bangumi.py` · `search_preview.py` | 经 **CatalogGateway** 重写 **或** 删除端点（X12：不新增 agent 数据端点；旧数据端点能删则删） | 产品若仍要 guide/popular → **Catalog/Workers 拥有**；agent 不代持 |
| `interfaces/db_repos.bangumi_repo` | 删除或仅保留 session 侧需要的窄协议 | 与主数据解耦 |
| `domain/llm_schemas.py` | 确认零引用后 **删除** | 非 CA 装饰 |

### 2.2 `maybe_persist_route` / `RouteArchive` 语义

| 今日 | 目标 |
|---|---|
| `RoutesRepository.save_route` → 表 `routes` + `route_anime` | **保留为 Session 附属归档**（G4 允许写编排状态） |
| 名称 `RouteArchive` | 文档与代码注释标明 **非 SavedRoute**；可选 rename → `SessionItineraryArchive`（与 Users 语言切割） |
| `bangumi_repo.filter_existing_ids` 过滤 anime_ids | **删除该主数据读**：直接信任本回合 Catalog 结果中的 `bangumi_id`，或只写 session_state 内已有 id，**不**再查本地 `bangumi` 表 |

### 2.3 明确 **不** 因「好看」搬家

| 项 | 原因 |
|---|---|
| `tests/eval/**` 整树重排 | 非生产分层；import 跟随即可 |
| `spikes/codemode/**` | 实验 |
| 一次把 `interfaces/` 全局 rename 为 `adapters/inbound/` | parent A5 **可选**；独立 PR，非阻塞 |

---

## 3. SOLID / god-object / 1-10-50 smells（带路径）

仓库规则：函数 ≤10 行、类 ≤50、文件 ≤300、≤2 缩进。下列为重构列车应处理的实味，不是风格洁癖清单。

### 3.1 上帝对象 / 过重编排

| 路径 | 问题 | 处置 |
|---|---|---|
| `interfaces/public_api.py` (~896 LOC) `RuntimeAPI` | SRP 失败：会话生命周期 + 模型解析 + 选择旁路 + 翻译 + 持久化 + 计量 + span | 抽 `HandleUserMessage`；类变 DI facade |
| `interfaces/persistence.py` | 多持久化关注点 + 主数据 `filter_existing_ids` | 抽 `PersistTurn`；去 bangumi 耦合 |
| `agents/catalog_tools.py` | 多工具实现同文件；Session 突变 + catalog IO | 按工具或按「resolve / search / nearby」拆 application |
| `agents/selection.py` (~373 LOC) | multi + place 选择纠缠 | 拆文件或拆私有模块；进 application |
| `clients/catalog_client.py` | DTO + Protocol + HTTP + retry 一体 | Protocol→domain；DTO/HTTP→infrastructure |
| `agents/runtime_deps.py` | 仍持有无用的 `CatalogLookup db` | 删字段；只保留 `CatalogGateway` |
| `domain/entities.AnimichiSession` vs `agents/session_state.SessionState` | 双 Session 模型 | 收敛到 **一个** Session 权威（runtime `SessionState`） |

### 3.2 SOLID 违反

| 原则 | 现状 | 目标 |
|---|---|---|
| **S** | `RuntimeAPI` / `public_api` 多责 | 一用例一模块 |
| **O** | 新 catalog 能力易直接改 tools 大文件 | tools 薄包装 + application 扩展 |
| **L** | `CatalogLookup` 暗示「半个 DB」 | 窄 `CatalogGateway`；Session ports 分离 |
| **I** | `BangumiRepo` 塞满 upsert + find + filter | 删写；读迁 Catalog；Session 归档不依赖宽接口 |
| **D** | application 空缺导致 interfaces→agents→clients 硬依赖 | use case 依赖 Protocol；interfaces 只组装 |

### 3.3 1-10-50 与分层污染

| 路径 | 味 |
|---|---|
| `agents/animichi_agent.py` | 已 import `infrastructure.observability`（外圈可接受，但 domain 禁止；保持 observability 不渗 domain） |
| `agents/byok_models.py` | 直接依赖 `egress_*` — 可接受外圈；勿上提 domain |
| `interfaces/routes/bangumi.py` · `search_preview.py` | 入站适配器直读主数据表 — **架构违规** |
| `domain/ports.py` upsert 方法 | 端口定义了 **禁止的写能力** |
| `handlers/` 空包 + 仅 helpers | 名不副实的「handler 层」；删除误导 |
| `application/` 仅 errors | 分层名存实亡 — 本设计核心是 **填实 application** |

### 3.4 语言债务（同列车或紧邻 G1）

| 今日符号 | 目标 |
|---|---|
| `PilgrimagePoint` | `Point` |
| `Route`（catalog 规划结果 / domain.entities.Route） | `Itinerary` |
| `plan_route` 工具名 | 产品 ticket 前可 **保留工具字符串** 以免 eval 抖动；类型与 path 先改；工具 rename 另卡评估 |
| `RouteArchive` / 表 `routes` | 语义文档化；表 rename 跟 greenfield agent 审计（Session 快照 ≠ SavedRoute） |

---

## 4. Patterns

### 4.1 Use Case（Application）

每个用例：**输入 DTO（非 FastAPI）→ 调 ports → 领域规则 → 输出 DTO**。
不 import FastAPI `Request`；不构造 PydanticAI `Agent`（那是 agents 的事）。

| Use case（目标模块） | 覆盖的已有路径 | Ports |
|---|---|---|
| **HandleUserMessage** | `RuntimeAPI.handle` 非流式主路径 | SessionRepo, SessionStore, CatalogGateway, ConversationLog, RouteArchive, UsageMeter, RequestAudit, MemoryStore? |
| **StreamAgentTurn** | `routes/chat_stream` + on_step | 同上 + step sink |
| **ApplySelection** | `selection.execute_*` | CatalogGateway |
| **RequestItinerary** | `selected_route` + `plan_route` 内核 | CatalogGateway |
| **SearchPoints / ResolveAnime** | `catalog_tools` | CatalogGateway |
| **PersistTurn** | `persistence.persist_result` | Session* ports only |
| **PhotoSearch** | `photo_search` | CatalogGateway + vision port |
| **EnforceAnonQuota** | `anon_quota` | AnonQuotaCounter |

### 4.2 Port（Protocol）— `domain/ports.py` 目标集

| Port | 读写 | 说明 |
|---|---|---|
| **CatalogGateway** | **只读** | resolve / points-by-bangumi / nearby / itinerary / geocode-as-exposed-by-catalog |
| **SessionRepo** | 读写 | sessions / conversations ownership |
| **ConversationLog** | 读写 | messages |
| **SessionItineraryArchive**（今 RouteArchive） | 写（会话快照） | **非** SavedRoute |
| **UsageMeter** · **AnonQuotaCounter** | 读写 | 计量 / 配额 |
| **RequestAudit** | 写 | request_log |
| ~~BangumiRepo / PointsRepo / CatalogLookup~~ | — | **删除** |

实现：`infrastructure/catalog/client.py`、`infrastructure/supabase/repositories/*`（仅 session 域表）。

### 4.3 Adapter

| 方向 | 位置 | 例子 |
|---|---|---|
| **Inbound** | `interfaces/routes/*`, 薄 `RuntimeAPI` | HTTP/SSE → use case 输入 |
| **Outbound** | `infrastructure/*` | Protocol 实现 |
| **Framework** | `agents/*` | PydanticAI tools 调 application；`build_animichi_agent` |

### 4.4 PydanticAI 留在外圈

- **保留在 `agents/`：** `animichi_agent`, tool 注册, `runtime_models` output_type, hooks, history compaction capability, runner 的 `agent.run` 调用。
- **禁止渗入 `domain/`：** `RunContext`, `Agent`, `Model`, tool decorators。
- **application** 可依赖「已完成的工具结果 DTO」或调用 **CatalogGateway**，但不依赖 PydanticAI 类型（必要时 application 定义自己的 Command/Result）。

### 4.5 明确 **NOT** 使用

| 反模式 | 原因 |
|---|---|
| 为每个 repo 再套一层空 ABC / BaseRepository | 已有 Protocol 结构子类型足够 |
| 领域事件总线 / Unit of Work 框架 | 现有 turn 边界清晰；增加噪音 |
| CQRS 全套 read model | 过重；Session 读模型已在 `SessionState` |
| 微服务内再拆进程 | monorepo 单容器 agent 足够 |
| 在 agent 内重建 Catalog 规划 kernel | SD-28 / X12：Itinerary 算法归 Catalog |
| 在 agent 实现 SavedRoute / Share / Check-in | Users BC；本包禁止 |
| 用「接口层 Facade」无限膨胀代替 use case | 正是 `RuntimeAPI` 现状 |
| 兼容层双名（`Route` alias `Itinerary`） | greenfield **无兼容** |

---

## 5. PR slices（仅已有代码）

每片可合并、可测、独立绿。对齐 parent **A1–A5** 与仓级 **G1/G2**。
命令：`make check`（agent 相关 lane）；切片后跑触及的 unit + 关键的 integration。

### Slice S0 — 边界文档与 import 护栏（小）

- AGENTS.md / CONTEXT：写明 `agents/` = framework adapter；**禁止** `domain → agents|interfaces|infrastructure`。
- 可选：简单 import-linter / 测试断言 domain 无出界 import。
- **无行为变更。**
- 对应 parent **A1**。

### Slice S1 — Greenfield 语言 + 删除主数据写（G1）

- `PilgrimagePoint`→`Point`，catalog `Route`→`Itinerary`（client + adapter + tests/eval fixtures 在 **agent 包内**）。
- 删除：`upsert_*` Protocol 方法、repository 实现、相关 unit 测试（或改为「方法不存在」）。
- `CatalogClient` path 跟随 contract 列车（若 contract 未合，本片可先类型改名、path 紧后）。
- **不**改产品行为除命名与删死写。
- 对应 parent **A2** 前半。

### Slice S2 — 统一 CatalogGateway；杀死双读 / 死注入（G2）

- 提升 `CatalogClientProtocol` → `domain.ports.CatalogGateway`；infrastructure 实现。
- 从 `RuntimeDeps` / `run_animichi_agent` / `RuntimeAPI` **移除** `CatalogLookup db`。
- `routes/bangumi.py` · `search_preview.py`：改走 Catalog **或删除**（优先删除 agent 数据端点；若 web 仍依赖，先在 **catalog worker** 提供等价 API，再删 agent 路由——该协调属 contract/catalog 列车，agent 侧只停直连表）。
- `maybe_persist_route` 去掉 `filter_existing_ids`。
- 删除/收缩 `BangumiRepo`/`PointsRepo` 与 supabase bangumi/points **写后的只读死代码**（若全无引用则整 repo 删除）。
- 对应 parent **A3**。

### Slice S3 — 抽出 HandleUserMessage + PersistTurn（核心结构）

- 新建 `application/handle_user_message.py`：自 `RuntimeAPI.handle` 迁编排。
- 新建 `application/persist_turn.py`：自 `persistence.py` 迁。
- `RuntimeAPI` 退化为构造 ports + 调用。
- 单测：对 use case 用 fake ports（可从现有 public_api 单测迁）。
- 对应 parent **A4**。

### Slice S4 — Selection / Itinerary / Search 进 application

- `apply_selection.py` ← `selection.py`
- `request_itinerary.py` ← `selected_route` + route tool 内核
- `search_points.py` ← `catalog_tools` 内核
- `agents/*_tools.py` 仅 `RunContext` 胶水。
- 目标：agents 不再持有大块业务分支。

### Slice S5 — Session domain 归位

- `SessionState` + fact_ledger + compaction_retention → `domain/session/`。
- 收敛 `entities.AnimichiSession` / 过时 `llm_schemas`。
- 保证 compaction / fact 规则 **无 DB 单测** 路径更短。

### Slice S6 — 1-10-50 拆文件与去 handlers 空壳

- 拆超标文件（`public_api` 剩余、`catalog_client`、selection 遗留）。
- `handlers/` 清空或删除；helpers 迁出。
- `RouteArchive` 文档/rename 与 SavedRoute 切割。

### Slice S7 — 可选目录 A5

- 文档层角色稳定后，评估 `interfaces`→`adapters/inbound` 等 **大 rename**（单独 PR，防 diff 噪音淹没行为）。

### 推荐顺序

```text
S0 → S1 → S2 → S3 → S4 → S5 → S6 → (S7)
```

S1/S2 可与仓级 contract/catalog path 改名 **同列车**；S3+ 不依赖 web/users 功能。

### 验收（每片）

| 检查 | 标准 |
|---|---|
| 测试 | 触及包 `make test` + 相关 integration 绿 |
| 依赖 | domain 无新出界 import |
| 主数据 | 无新 upsert；S2 后无 agent 直读 points/bangumi 表 |
| Session 写 | conversations / messages / session store / quota / usage 仍工作 |
| 覆盖 | 不靠 noqa；不降 coverage floor |
| 产品偷渡 | PR 描述声明无 enabler |

---

## 6. Non-goals

| 不做 | 原因 |
|---|---|
| edge / web / users **产品** enabler 设计或实现 | SCOPE LOCK |
| SavedRoute 权威、Share、Check-in、しおり、presign、OSRM 层 2 | Users / Catalog tickets |
| **match_scene 全管线** 首次实现 | 未写产品 → **ticket only**（挂既有 issue；实现时遵守本文分层，不在本重构 PR 偷渡） |
| 跨会话 UserMemory 产品 | Users / SD-15 |
| 重写 PydanticAI 或换 agent 框架 | parent 非目标 |
| 为未实现用例预建空 domain 模块 / 空表 | greenfield 原则 6 |
| 长期兼容别名（`Route = Itinerary`） | 无历史用户 |
| Agent 新增 **数据端点**（catalog 或用户域） | X12 / G4 / A3 |
| 工具侧随便写库 | SD-19；写 Session 走 application + port |
| 本文件阶段改生产代码 | DESIGN ONLY |
| monorepo 其他包目录重构 | 仅 agent |

### 6.1 Ticket 指针（未写能力 · 不实现）

重构列车 **不** 打开下列首次交付；仅要求未来实现遵守 CA + greenfield：

- **match_scene / 场景匹配全管线** — 既有产品 ticket（实现时：Catalog 读 + Session 写边界同上）
- Share / Check-in / しおり 等 — Users 设计文 + 对应 issue
- 跨会话 memory 唤醒 — Users
- 主战场结构债跟踪：#432 · #666（及 agent boy-scout 卡）

---

## 7. 与 parent 文档的映射

| Parent | 本文 |
|---|---|
| CA §3 圈层 | §0 依赖规则 + §4 |
| CA §5 端口 | §4.2（收紧删除主数据 port） |
| CA §6 用例 | §4.1 + §5 S3–S4 |
| CA §9 A1–A5 | §5 S0–S7 |
| CA §9.1 做/不做 | §0 + §6 |
| Greenfield §0 真结构 | 全文；§2 move table |
| Greenfield Agent §4.3 删直连写 | §1.8 + S1/S2 |

---

## 8. 变更日志

| 日期 | 变更 |
|---|---|
| 2026-08-06 | 初稿：基于 `src/animichi` 实盘 inventory 的结构重构设计（DESIGN ONLY） |
| 2026-08-06 | Owner **ACCEPTED**（best-practice 默认）；实现按 §5；§9 实现时微选项用推荐默认 |

---

## 9. Owner 阅读清单（实现前）— 默认已按 best practice

| # | 项 | 默认（ACCEPTED） |
|---|---|---|
| 1 | `bangumi` / `search_preview` 双读 | **删 agent 数据端点**；读只经 Catalog |
| 2 | Session 附属 `routes` 表名 | 结构片先语义切割；DB rename 可并 greenfield |
| 3 | `plan_route` 工具名字符串 | **类型/内部先 Itinerary**；工具对外名评估 eval 成本后改（可同波或紧后） |
| 4 | 实现 | 按 §5 切片开 PR |
