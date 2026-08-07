# RENAME-EXPAND-CONTRACT — #852 SK-G1 SPIKE（doc-only）

**Status:** SPIKE — 本 PR 只落文档，**无** Atlas 迁移、**无** runtime 改名、**无** git 操作。
**Parent:** [#829](https://github.com/lifeodyssey/animichi/issues/829) · **Ticket:** [#852](https://github.com/lifeodyssey/animichi/issues/852)（W4，GOAL §3）
**Language / data-plane target:** `docs/superpowers/specs/2026-08-06-greenfield-language-and-data-plane.md`（§2 契约 / §3 数据面 / §4 分包装改）
**ADR:** `docs/adr/0002-published-language-point-bangumi-itinerary.md`
**Table ownership:** `db/AGENTS.md`（D21，`routes` → users 写权威，目标名 `saved_routes`）
**实施入口:** `RENAME-INVENTORY.txt`（#852 执行 PR 以此为 grep 起点）

---

## 1. Rename matrix

### 1.1 `routes` → `saved_routes`（users 写权威）

| # | 面 | 今日 | 目标 | 位置（RENAME-INVENTORY 锚点） |
|---|---|---|---|---|
| R1 | 表 | `routes` | `saved_routes` | `db/migrations/20260623000001_init.sql:75` 定义；`20260713000001_user_routes.sql` 演进（user_id/title/status/saved_at/updated_at/trigger） |
| R2 | 关联表 | `route_anime.route_id` FK → `routes(id)` | FK → `saved_routes(id)` | `20260718000001_route_anime.sql:3` |
| R3 | Drizzle schema | `routes` pgTable | `savedRoutes` | `workers/users/src/db/schema.ts:24` |
| R4 | users handlers | `listRoutes` / `saveRoute` / `deleteRoute` / `claimRoutes`；SQL `FROM routes`、`INSERT INTO routes` | `listSavedRoutes` 等；SQL 改 `saved_routes` | `workers/users/src/api/routes.ts`（`:102` `:126`） |
| R5 | users oRPC 绑定 | `os.listRoutes` 等 + `usersRouter` | 同名改 | `workers/users/src/router.ts` |
| R6 | 错误面 | `RouteNotFoundData` / `RouteNotOwnedData` / `ROUTE_NOT_FOUND` / `ROUTE_NOT_OWNED` / `RouteErrorData { route_id }` | `SavedRouteNotFound`…；`saved_route_id` | `packages/contract/src/users-contract.ts`；`workers/users/src/lib/errors.ts` |
| R7 | 契约类型 | `UserRoute` / `RouteStatus` / `SaveRouteInput` / `DeleteRouteInput` / `ClaimRoutesInput` / `ListRoutesResult { routes: […] }` | `SavedRoute` 系 | `packages/contract/src/users-contract.ts:59–106` |
| R8 | HTTP path | `/v1/users/routes`、`/v1/users/routes/claim`、`DELETE /v1/users/routes/{id}` | `/v1/users/saved-routes`… | users worker oRPC handler（`OpenAPIHandler` mount）；测试 `workers/users/test/route-mutations.worker.test.ts:32` |
| R9 | agent 读面 | `GET /routes`（conversations.py）→ `db.routes.get_user_routes()` | `GET /saved-routes` → users 新契约 | `apps/agent/src/animichi/interfaces/routes/conversations.py:85–93` |
| R10 | agent 遗留仓库 | `infrastructure/supabase/repositories/routes.py` | **删或冻结**（greenfield §4.3：直连写优先删除；不 rename 进新世界） | `apps/agent/src/animichi/infrastructure/supabase/repositories/routes.py` |
| R11 | jobs SQL | purge 里 `NOT EXISTS (SELECT 1 FROM routes r WHERE r.session_id = c.session_id)` | 表名随迁 `saved_routes`；**禁止**把 `saved_routes` 当 purge 目标（greenfield §4.7） | `workers/maintenance/src/purge.ts:21` |
| R12 | 测试夹具 | `in-memory-routes-db` / wire / mutations / row-validation 用例 | 新名 | `workers/users/test/*`；`apps/agent/src/animichi/tests/**/test_*route*` |

### 1.2 残余 `work_id` → `bangumi_id`（catalog 写权威）

| # | 面 | 今日 | 目标 | 位置 |
|---|---|---|---|---|
| W1 | 列（5 表） | `aliases.work_id`、`series_edges.from_work_id/to_work_id`、`cluster_version.work_id`、`route_snapshots.work_id`、`ingest_jobs.work_id` | `bangumi_id` 系 | `db/migrations/20260623000001_init.sql:107–153` |
| W2 | raw 表 | `raw_anitabi.work_id`、`raw_bangumi.work_id`（join key） | `bangumi_id` | `workers/catalog/src/ingest/cron-queries.ts:74–77`；`raw-store.ts:43` |
| W3 | 表名 | `route_snapshots` | `itinerary_snapshots`（键列 `bangumi_id`） | greenfield §3.1；`workers/catalog/src/publish/snapshots.ts` |
| W4 | Drizzle schema | `workId` 列映射 | `bangumiId` | `workers/catalog/src/db/schema.ts:73–92` |
| W5 | catalog 代码 | resolve/search/enrich/series/versioning/gc/jobs/raw-store 的 `work_id` 读写与 `Work` 措辞 | `bangumi_id` | `workers/catalog/src/api/resolve.ts`、`search.ts:218`、`enrich.ts:159`、`publish/*`、`ingest/*`、`lib/series.ts` |
| W6 | 契约 | `PointsByWorkIdInput { work_id }` + `pointsByWorkId` | `PointsByBangumiIdInput` + `pointsByBangumiId`（数字串 regex 保留） | `packages/contract/src/contract.ts:43–44` |
| W7 | openapi 生成物 | 残余 `work_id` 节点 | 重生全 `bangumi_id` | `packages/contract/openapi.json:402,408` 等 |

### 1.3 已是 `bangumi_id` 的存量面（**不碰**，只读确认）

| 面 | 位置 | 说明 |
|---|---|---|
| `points.bangumi_id` | `20260623000001_init.sql:77` + `:298` 索引 | 已佳（greenfield §3.1 保留） |
| `routes.bangumi_id` → `route_anime` | `20260718000001_route_anime.sql`（列已 drop，`idx_routes_bangumi` 已 drop） | **已完成迁移**，禁止复活旧列 |
| contract `bangumi_id` 类型 | `models.ts:39,95,105`；`chat-data-parts.ts:18` | 已佳 |
| openapi `anime-overview/{bangumi_id}` | `openapi.json:1500` 等 | 已佳 |
| agent codemode | `apps/agent/src/animichi/spikes/codemode/agent.py:45` | 已佳 |

---

## 2. Package touch list（#852 实施波次的执行顺序建议）

| 包 | 改什么 | 说明 |
|---|---|---|
| `packages/contract` | §1.1 R6–R7、§1.2 W6、`share-contract.ts:195` / `checkin-contract.ts:97` 的 `route_id` → `saved_route_id`、`errors.ts`；重生 `openapi.json` | 契约先或与第一消费方同 PR（greenfield §4.1）。`Route`（规划结果）→ `Itinerary` 属同波语言，见 §5 边界 |
| `workers/users` | §1.1 R3–R5、R8、R12 | 竖切 #835 之后改，避免双改同一批文件 |
| `workers/catalog` | §1.2 W2–W5、R12（catalog 测试夹具） | 竖切 #838 之后改；`lib/route.ts` → domain `itinerary` 可同 PR 或 P1（greenfield §4.2） |
| `apps/agent` | §1.1 R9–R10；`CatalogClient` 跟新 path（pointsByBangumiId） | 遗留 routes 仓库删/冻结优先；`RuntimeModel`→Itinerary 同波 |
| `db/migrations` | §1.1 R1–R2、§1.2 W1、W3 → **单个 Atlas 迁移**；跑 `atlas migrate hash` | 破坏性 rename/drop 合法（无用户）；GRANT 随表名走（#831 之后） |
| jobs SQL（`workers/maintenance`） | §1.1 R11 | purge 防漏：确认不扫 `saved_routes` |
| 相邻（本 PR 之外的协调面） | edge `/v1/users/*` 通配已是 passthrough（`workers/edge/app.ts:170`），只需 outbound allowlist 随 catalog path 更新；web 从 contract import，MSW path 紧跟 | greenfield §4.5–4.6；**不**在本 spike 承诺的文件清单内 |

---

## 3. Expand / migrate / contract 三阶段 + dual-read 说明

> greenfield 原则 1：**无双写/别名窗、无兼容层**。下列「阶段」是**同一列车的编排顺序**，不是时间窗；任何一阶段都不得以「新旧名并存」的已发布状态收尾（§4.8「禁止半截 `work_id` 混列长期存在」）。

| 阶段 | 内容 | dual-read 说明 |
|---|---|---|
| **E — Expand（契约先行）** | `packages/contract` 类型/错误/path 全量新名（SavedRoute、pointsByBangumiId…）+ openapi 重生；**同一 PR 内** 即把 users/catalog/agent 的 import 与调用点改完 | 无运行期双名。类型层面不保留 `UserRoute` 别名导出 — 新版 web 从 contract import 的代码与 worker 同波落地；若某消费方来不及同波，**先不 merge**，而不是留别名。 |
| **M — Migrate（调用点与 jobs）** | users SQL/路由、catalog SQL/代码、agent 读面与 `CatalogClient`、`maintenance/purge.ts` 全部指向新名；删除/冻结 agent 遗留 routes 仓库 | 唯一合法的「双态」是 **DB 迁移 apply 后的部署窗口**：迁移先行（deploy 顺序见 `db/AGENTS.md`）、worker 随后，同波代码只认新名 → 任何读路径都不会在迁移后访问旧名。 |
| **C — Contract（DB 收缩）** | 单个破坏性 Atlas 迁移：`routes`→`saved_routes`（含 trigger、`idx_routes_user`、route_anime FK）、`work_id` 五表列改名、`route_snapshots`→`itinerary_snapshots`；`atlas migrate hash`；GRANT 对象随新表名 | 无 DB 级 dual-read（视图/触发器双名）— greenfield 明令禁止，且会制造半旧半新状态。迁移文件内可一文件内完成「加新列→搬数据→删旧列」，但**无数据搬迁**（纯 rename，`ALTER TABLE RENAME` 原子）。 |

**Dual-read 检查清单（M 阶段收尾必查）：**
- [ ] `grep -rn "FROM routes\|INSERT INTO routes\|UPDATE routes" apps/agent workers` 清零（RENAME-INVENTORY 为 grep 起点）
- [ ] `grep -rn "work_id" packages/contract/src workers/catalog/src apps/agent/src` 清零
- [ ] openapi.json 无 `work_id`、无 `UserRoute`、无裸 `routes` path
- [ ] maintenance purge 只碰 agent 匿名 retention 表，`saved_routes` 不在 DELETE/SELECT 目标
- [ ] 部署序：migration apply → worker rollout（`reusable-deploy-component.yml` 门禁）

---

## 4. 依赖与协调

| 依赖 | 类型 | 说明 |
|---|---|---|
| #831（DB-2 ROLE+GRANT 迁移） | **宜在前** | GRANT 对象名随表改名；先落地角色，rename 迁移直接以新名授权，避免二次 GRANT |
| #835（Users 竖切） | **宜在前** | users `api/routes.ts` 是 W1 竖切主战场；rename 在其后改，文件少冲突 |
| #838（Catalog 竖切） | **宜在前** | catalog `work_id` 面大（publish/ingest/api 全触达）；竖切先搬家、rename 后改名 |
| #845（Atlas squash epic） | **协调** | GOAL §6：W4 与 W6 **二选一先行，避免双改迁移史**。若 #845 baseline 先落，本 rename 迁移必须坐在新 baseline 之上且保留其形状；若 rename 先落，baseline 时须如实保留 `saved_routes`/`bangumi_id` 状态 |
| #832（staging DSN） | 弱依赖 | staging apply 门禁走到才可验证 |
| #831/#835/#838 均未合 | — | 允许，但需接受三处文件重改成本；建议按 GOAL 波序 **W1→W2→W4** 自然到位 |

---

## 5. 边界（本 spike / 本 PR 内处理范围）

- 本 doc 只锁定 §1 矩阵与 §3 阶段编排；**#852 实施 PR 是单独执行**（GOAL W4）。
- `Route`（规划结果）→ `Itinerary`、`PilgrimagePoint` → `Point`、`sample_routes` → `sample_itineraries`、share/checkin 契约：同属 greenfield 总表，但**不是**本 spike 的 rename 矩阵主体 — 实施时随契约 PR 同波（§4.1）或紧随，不另开半截。
- `user_memory`、`sessions` 收敛、`leg_cache` 命名：greenfield 标记「实现时定」，**不在本 spike**。

## 6. 非目标（明确不做）

- [ ] **本 PR 不做任何 live 表 rename / DDL / 代码改名** — SPIKE 只产文档
- [ ] 无双写 / 别名窗 / 视图兼容层 / 数据搬迁（无历史用户，纯 `RENAME`）
- [ ] 不建新产品能力（Share / Check-in / しおり）— 只允许 `TODO(refactor-skeleton)` 指针
- [ ] 不动 `supabase/migrations/`（auth-only 遗留）与 Supabase auth 代码
- [ ] 不重写 migration 历史、不 force-push git 历史（那是 W8 / #858）
- [ ] 不降低 coverage / typecheck / 1-10-50 / `--deny-warnings`
- [ ] edge / web 的 domain 层无 rename（Gateway/UI 层只跟 path 与 allowlist）

## 7. 变更日志

| 日期 | 变更 |
|---|---|
| 2026-08-07 | SPIKE 初稿：#852 rename 矩阵（routes→saved_routes · work_id→bangumi_id）+ 分包装改 + EMC 三阶段 + 依赖/非目标 |
