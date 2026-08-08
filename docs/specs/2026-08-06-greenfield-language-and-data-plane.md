# Greenfield：全仓发布语言 + 数据面目标态

- Status: **DESIGN ONLY** — owner 方向 2026-08-06（无历史用户 / 无生产包袱 → **一次最佳，无兼容层**）
- Parent: `2026-08-06-monorepo-target-layout.md`
- Supersedes lag language in ADR-0002「wire 可滞后」— 见下文修订意图
- Per-package detail: Catalog / Agent / Users CA 设计文；本文是 **跨包总表**

---

## 0. 原则（LOCKED）

1. **无历史用户** → 契约、HTTP path、表名、Python/TS 内部类型 **直接最佳名**，不做双写/别名窗。
2. **一词一主**：`Route` 不再作跨包名词（拆成 **Itinerary** / **SavedRoute**）。
3. **同表 ≠ 同 BC**：写权威见各包；Users 列表投影不拥有 Conversation。
4. **无跨 BC FK**：Users 不 REFERENCES `points`/`bangumi`；只存 TEXT id。Catalog 内部 FK 可保留。
5. **实现按包分期 PR**，但 **目标态已定**；禁止新代码再引入旧名。
6. **重构范围 = 已有代码的真·结构重构**（owner 2026-08-06），**不是**「只 rename」：
   - **做：** 按 CA/DDD 目标 **移动文件与函数**、抽出 use case / port、**化简**多余抽象、对齐 **SOLID** 与既有 1-10-50、依赖单向、可测 seam
   - **顺带：** greenfield **语言/契约/表名** 与结构重构同列车或紧前/紧后，避免半旧半新
   - **不做：** 为 **尚未实现** 的产品能力新造 runtime / 空 domain / 抢先建表；那些能力的设计指引挂 **既有 ticket**，随 ticket 做
7. **抽象纪律：** 优先 **删掉** 错误分层与上帝对象，再谈「加 pattern」；禁止为演示 OOP 而堆 interface/base class。SOLID 是约束，不是装饰。

### 0.1 重构列车 vs 产品 ticket（全仓）

| 列车 | 包含 | 排除 |
|---|---|---|
| **Refactor train** | 今日仓库里 **已存在** 的 catalog / agent / users / edge / contract / web 调用点：分层、搬家、化简、命名、删死路径 | Share/Check-in/しおり/presign/OSRM 层2… **未写完的 enabler** 的首次实现 |
| **Product / enabler tickets** | 首次交付未写能力；实现时遵守 CA + greenfield + ticket 上的 design comment | 不借重构 PR 偷渡大功能 |

**主战场 ticket（已有代码）：** #432 · #666（及各包 debt/boy-scout 卡）
**产品票（只挂指引，不随重构实现）：** #235 #243 #249 #212… 等

### 0.2 结构细化范围（讨论中锁定）

| 现在做结构细化（搬家表 / SOLID / pattern） | 以后再讨论 |
|---|---|
| **catalog** · **agent** · **users** | edge · web · maintenance · monorepo 第一层路径搬迁 |

Workflow: `.grok/workflows/structure-design-three-packages.rhai`
产出：`2026-08-06-{catalog,agent,users}-structure-refactor-design.md` + index

---

## 1. 发布语言（全仓）

| 规范名 | 含义 | 禁止（新代码） |
|---|---|---|
| **Point** | 圣地取景点 | `PilgrimagePoint`、`Spot`（契约） |
| **Bangumi** | 作品 | `Work`、`work_id` 字段名 |
| **Itinerary** | Catalog 算出的有序行程 | 裸 `Route`、`RouteModel`（此义） |
| **SavedRoute** | 用户保存文档 | `UserRoute`、表 `routes`（用户义） |
| **Session** | Agent 对话上下文 | 与 auth session 混用且不限定 |
| **Claim** | 匿名文档 → 登录用户 | `Migrate`（平台迁移义） |
| **RouteShare** / **WalkCheckin** | 分享 / 打卡 | 模糊 `share` 无所有者 |

---

## 2. 契约 / HTTP 目标（`packages/contract`）

| 今日 | 目标 |
|---|---|
| `Point`（原 `PilgrimagePoint`，#891 已落地） | **`Point`** |
| `Itinerary`（原 `Route`，#891 已落地） | **`Itinerary`** |
| `bangumi_id`（原 `work_id`，#891 已落地） | **`bangumi_id`**（仍为数字字符串时用 regex 约束，名改正） |
| `pointsByBangumiId`（#891 已落地） | **`pointsByBangumiId`** |
| `POST /catalog/itinerary`（#891 已落地） | **`POST /catalog/itinerary`** |
| `POST /catalog/spots` | **`POST /catalog/point`**（或 `/catalog/points/get`；实现选定一，文档锁定） |
| `SavedRoute` / `/v1/users/saved-routes`（#890 已落地） | **`SavedRoute` / `/v1/users/saved-routes`** |
| `saved_route_id`（#890 已落地） | **`saved_route_id`** |
| `AnimeSampleItinerary` / `sample_itineraries`（#891 已落地） | **`AnimeSampleItinerary` / `sample_itineraries`** |
| 与 contract 同词（Point / Itinerary / …，#892 已落地） | 与 contract **同词**（Point / Itinerary / …） |

**兼容：** 无。Web、MSW、eval fixture、Agent `CatalogClient` **同波或紧后 PR 改完**。

---

## 3. 数据面：表归属与改名

### 3.1 Catalog 写权威

| 今日 | 目标 | 说明 |
|---|---|---|
| `bangumi` | **保留** | 已佳 |
| `points` | **保留** | 已佳；`bangumi_id` 列已对 |
| `aliases` | **`work_id` → `bangumi_id`** | 列改名 |
| `series_edges` | 若有 `work_id` → **`bangumi_id`** | 同 |
| `cluster_version` | **`work_id` → `bangumi_id`** | 同 |
| `itinerary_snapshots`（原 `route_snapshots`，#891 已落地） | **`itinerary_snapshots`**；键列 `bangumi_id` | 缓存/发布快照，非 SavedRoute |
| `leg_cache` | 评估保留或改 `transit_leg_cache` | 实现时定，避免 `route` 歧义 |
| `ingest_jobs` / `raw_*` / `media_assets` | **保留**（平台表） | 非粉丝语言 |
| `locations`（gazetteer） | **保留** | 非 Point |

### 3.2 Users 写权威

| 今日 | 目标 |
|---|---|
| `saved_routes`（原 `routes`，#890 已落地） | **`saved_routes`**（见 Users §2.5） |
| （无） | **`route_shares`**、`walk_checkins` |
| `user_memory` | 休眠预留形状见 Users 设计 |

### 3.3 Agent 写权威

| 今日 | 目标 | 说明 |
|---|---|---|
| `conversations` | **保留** | 佳 |
| `conversation_messages` | **保留** | 佳 |
| `sessions` | **保留**或与 conversation 收敛 | 实现审计：是否双轨；目标 **一个 Session 权威存储** |
| `agent_memory*` | **保留**（会话/agent 内） | 非跨会话 UserMemory |
| `anon_daily_message_count` / `daily_usage` | **保留** | 配额/计量 |
| `feedback` / `request_log` / `api_keys` | 评估是否仍要；要则归 Agent 或 Edge | 另卡 |

### 3.4 禁止

- Users / Agent **新表**再叫 `routes`。
- Catalog **新列**再叫 `work_id`。
- 跨 BC `REFERENCES points(id)` 从用户表发出。

---

## 4. 分包装改清单

### 4.1 Contract（先或与第一消费方同 PR）

- models + catalog contract + users/share/checkin 全量改名
- OpenAPI / 生成物若有则重生

### 4.2 Catalog

- oRPC path + handler 名 `planItinerary`
- SQL/`schema.ts`：`work_id`→`bangumi_id`；`route_snapshots`→`itinerary_snapshots`
- `lib/route.ts` → domain `itinerary`（可同 PR 或 P1）
- CONTEXT / AGENTS 去「wire legacy」措辞

### 4.3 Agent

- 实体/工具/客户端：`Route`→`Itinerary`，`PilgrimagePoint`→`Point`
- `CatalogClient` 跟新 path
- **删除或冻结** 直连主数据写（PointsRepo upsert）— 无包袱则 **删** 优先于标债
- Session/Conversation 表纪律不变（写权威）

### 4.4 Users

- 已定 §2.5 greenfield（`saved_routes` 等）

### 4.5 Web

- 类型从 contract 导入；MSW path；UI 文案可不改日文/中文产品词

### 4.6 Edge

- 路由表 path 字符串；**无**领域模型改名（Gateway）
- outbound allowlist 随 catalog path 更新

### 4.7 Maintenance

- 只碰 agent 匿名 retention 表名；确认不扫 `saved_routes`

### 4.8 Migrations

- 单一 Atlas 史：可 **破坏性** rename/drop（无用户）
- 建议顺序：contract 类型 PR 可与 DB rename 同列车；禁止半截 `work_id` 混列长期存在

---

## 5. 与既有 CA 设计的关系

| 包 | 设计文 | Greenfield 增量 |
|---|---|---|
| Catalog | ACCEPTED CA | P6 升格为 **必做**；与分层 PR 可合并「无兼容」 |
| Agent | ACCEPTED CA | A4 升格为 **全量语言**；A3 直连写 **优先删除** |
| Users | ACCEPTED core | §2.5 greenfield；§0.4 真结构重构 |
| Edge / Web / Maintenance | 未单开 Full CA | 本总表 + Gateway/UI 规则足够 |

---

## 6. 分期建议（仓级）

| 波次 | 内容 |
|---|---|
| **G0** | 文档：CA + greenfield + **重构范围（真结构，非只 rename）** |
| **G1** | **已有代码** 上：语言/契约/表 rename **+** 必要的调用点搬家，全仓编译/测绿 |
| **G2** | **已有代码** 上：Catalog/Agent/Users **CA 竖切** — 移文件、抽 use case/port、化简、SOLID/1-10-50（可多 PR） |
| **G3** | 产品 ticket 各自实现未写能力（Share/Check-in…）— **不** 并进 G1/G2 |

**G0 无代码。G1–G2 = 重构列车。G3 = 产品列车。**

---

## 7. 变更日志

| 日期 | 变更 |
|---|---|
| 2026-08-06 | 初稿：全仓 greenfield 语言 + 表/契约总表 |
| 2026-08-06 | §0 原则 6–7：重构 = 搬家/化简/SOLID，不只 rename；未写能力归 ticket |
