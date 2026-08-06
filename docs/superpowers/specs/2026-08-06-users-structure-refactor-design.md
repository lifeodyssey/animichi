# Users 结构重构设计（Thin CA — 已有代码 only）

- Status: **ACCEPTED**（owner 2026-08-06 — best-practice 默认；**不含实现**）
- Date: 2026-08-06
- Package: `workers/users`（~700 行；Hono · oRPC · jose · Neon raw SQL）
- Parent: [`2026-08-06-users-clean-architecture-design.md`](./2026-08-06-users-clean-architecture-design.md)（§0.2 LOCKED · §0.4 重构范围）
- Greenfield: [`2026-08-06-greenfield-language-and-data-plane.md`](./2026-08-06-greenfield-language-and-data-plane.md)（原则 6–7：真·结构，不止 rename）
- Tier: **Thin** — 浅 domain + use case + port；**禁止** Full catalog 深树

---

## 0. 范围锁（读此节再动手）

### 0.1 在本设计内

| 项 | 说明 |
|---|---|
| **已有 HTTP 面** | `listRoutes` · `saveRoute` · `deleteRoute` · `claimRoutes` · `listSessions` + JWT 门（`/v1/users/*`） |
| **真·结构** | 移动/拆分函数；抽出 ownership / claim / status 纯规则；`SavedRouteRepo` + `SessionSummaryReader` port；化简事务脚本；SOLID / 1-10-50 |
| **语言对齐（可同列车）** | `UserRoute`→`SavedRoute`；`session_id` 列语义→`claim_session_id`；`listSessions` 注释/类型为 **SessionSummary 只读投影**（Conversation 写权威在 Agent） |
| **测试** | 跟搬家改 import；域规则加无 DB 单测；fake repo 替 SQL 串匹配（逐步） |

### 0.2 明确不在本设计 / 本重构列车

| 项 | 去向 |
|---|---|
| Share runtime | **#235** — 本文件不展开 |
| Check-in runtime | **#243** — 本文件不展开 |
| しおり / R2 presign / 対比図 | **#249**（及相关 #212/#215）— 本文件不展开 |
| Edge path 表、Web MSW、contract 全仓 rename 的**跨包**编排 | greenfield G1 他包 PR；本设计只定 users 内部切法 |
| 空 `domain/application/adapters` 脚手架、ShareRepo/CheckinRepo 空壳 | 无场景不 mkdir；product ticket 开工时再建 |

**纪律（parent §0.4）：** 重构 PR = 今日仓库里已存在的 handler/SQL/规则。未写能力只挂 ticket comment，不在重构里实现。

---

## 1. Current inventory

### 1.1 物理树与体量（实测基线 2026-08-06）

```text
workers/users/
  package.json · wrangler.toml · vitest.config.ts · tsconfig.json
  AGENTS.md · CONTEXT.md · CLAUDE.md
  src/
    index.ts           ~117 行  Hono 入口 · DI · JWT 门 · OpenAPIHandler · db 池
    router.ts          ~37 行   implement(usersContract) → 调 api handlers
    api/
      routes.ts        ~237 行  ★ 上帝文件：映射 + SQL + 所有权 + 5 用例
    auth/
      jwt.ts           ~51 行   jose JWKS · verifyBearer
    db/
      client.ts        ~17 行   DbExecutor + makeDb
      schema.ts        ~41 行   Drizzle typing only（表名 routes + 遗留规划列）
    lib/
      errors.ts        ~38 行   ROUTE_NOT_FOUND / ROUTE_NOT_OWNED 镜像
  test/
    in-memory-routes-db.ts     fake DbExecutor（按 SQL 文本分派）
    neon-auth-fixture.ts       本地 Ed25519 JWT
    auth.worker.test.ts
    eddsa-shared-primitive.worker.test.ts
    routes-api.worker.test.ts  直调 list/save/delete/listSessions
    route-mutations.worker.test.ts  HTTP delete/claim + 403/404
    row-validation.worker.test.ts   坏行 / 空 title
    worker.worker.test.ts      契约 smoke
```

**合计 src ~540 行 + test ~700 行量级** — Thin 包，**不需要** catalog 式多层目录。

### 1.2 导出表面（现函数 → 角色）

| 路径 | 符号 | 今日角色 | 目标层 |
|---|---|---|---|
| `src/index.ts` | `createUsersApp`, `Env`, `UsersAppDeps`, `closeDbPools` | 入站 composition root | **adapters/inbound**（可保持路径） |
| `src/index.ts` | `guardUsersV1`, `requireUser`, `requestService` | JWT + 配置守卫 | inbound（可留 index 或抽 `auth-middleware`） |
| `src/router.ts` | `usersRouter`, `UsersContext` | oRPC wiring | inbound |
| `src/auth/jwt.ts` | `verifyBearer`, `issuerFromJwksUrl` | Identity adapter | inbound identity |
| `src/api/routes.ts` | `listRoutes` | List SavedRoutes | **application** |
| `src/api/routes.ts` | `saveRoute` / create+update 私有链 | Save SavedRoute | **application** |
| `src/api/routes.ts` | `deleteRoute` | Delete SavedRoute | **application** |
| `src/api/routes.ts` | `claimRoutes` | Claim by session | **application** |
| `src/api/routes.ts` | `listSessions` | SessionSummary 投影（误像「拥有会话」） | **application**（只读） |
| `src/api/routes.ts` | `assertOwner`, `ownerFrom` | 所有权裁决（嵌 SQL） | **domain 规则 + repo 读** |
| `src/api/routes.ts` | `toUserRoute`, `toSession`, `iso`, `isStatus`… | 行映射 / 校验 | **adapters/outbound map** 或 domain parse |
| `src/api/routes.ts` | `*Sql` / `*Row` helpers | 出站 SQL | **SavedRouteRepo / SessionSummaryReader** |
| `src/db/client.ts` | `DbExecutor`, `makeDb` | 出站执行器 | outbound infra |
| `src/db/schema.ts` | `routes` table typing | 遗留形状 | 目标 `savedRoutes` typing（G1 语言） |
| `src/lib/errors.ts` | `routeNotFound`, `routeNotOwned` | oRPC 错误构造 | adapter error map（应用抛 domain 结果） |

### 1.3 数据与契约现状（与目标差）

| 层 | 今日 | Greenfield 目标（parent §2.5；可与结构 PR 同波或紧前） |
|---|---|---|
| 表 | `routes`；claim 键列名 **`session_id`** | `saved_routes`；**`claim_session_id`** |
| 契约模型 | `UserRoute`, `RouteStatus` | `SavedRoute`, `SavedRouteStatus` |
| 列表结果 | `ListRoutesResult.routes` | `ListSavedRoutesResult.saved_routes` |
| 会话列表 | `UserSession` / `listSessions` | **SessionSummary** 投影；写权威仍在 Agent `conversations` |
| 错误码 | `ROUTE_NOT_*` | 推荐 `SAVED_ROUTE_NOT_*`（实现时与 contract 一次对齐） |
| schema 遗留列 | `bangumi_id` FK 语义、`origin_location` geography、`total_*`、`route_data` | **不进** SavedRoute 权威模型；schema typing 收成目标列 |

### 1.4 已有正确碎片（保留，勿拆坏）

1. **BC 边界**：binding-only `/v1/users/*`；JWT 自验签；`sub` → `user_id`。  
2. **信任序**：无 JWT → 401；跨用户 → 403 `ROUTE_NOT_OWNED`；不存在 → 404（`assertOwner` 先查存在性）。  
3. **Claim SQL 语义**：`user_id IS NULL` + session 匹配才更新（正确；列名待 greenfield）。  
4. **status / saved_at**：insert 时 draft→NULL；update 时 draft 清 NULL，非 draft `COALESCE(saved_at, NOW())`。  
5. **可测 seam**：`createUsersApp({ getKey, makeDb })` + `DbExecutor`。  
6. **workerd 纪律**：raw `sql`、数组 `sql.param`、timestamptz `toISOString()`。  
7. **数组绑定**：`${sql.param(input.point_ids)}::text[]` — 搬家时必须原样保留。

### 1.5 核心问题（为何要结构重构，而不只 rename）

`src/api/routes.ts` 是 **单一事务脚本文件**，混有：

- 领域规则（所有权、claim 资格、status→saved_at）  
- 应用编排（create vs update 分支、删前 assert）  
- 出站 SQL 与行映射  
- 与 Agent 域表 `conversations` 的只读查询（未标明「投影、非拥有」）

结果：

- 规则无法无 DB 单测（只能走 fake SQL 文本匹配）。  
- 新增第三段能力时会再长一截 400 行脚本。  
- 命名仍是 `UserRoute` / `routes` / `session_id`，与 CONTEXT / parent LOCKED 语言冲突。  
- `UsersContext` 直接持 `DbExecutor`，用例无法依赖抽象 port。

---

## 2. File / function move-split table（from → to）

### 2.1 目标逻辑树（Thin — 物理可浅）

**推荐物理布局（够用即止；文件数 ≈ 今日 + 少量，不是 catalog 镜像）：**

```text
workers/users/src/
  domain/
    ownership.ts          # 纯：OwnerLookup → found | not_found | not_owned
    claim.ts              # 纯：行是否可 claim（user_id null + claim_session_id 匹配）
    saved-route-status.ts # 纯：status → saved_at 规则
  application/
    ports.ts              # SavedRouteRepo · SessionSummaryReader（interface only）
    list-saved-routes.ts
    save-saved-route.ts
    delete-saved-route.ts
    claim-saved-routes.ts
    list-session-summaries.ts
  adapters/
    outbound/
      saved-route-repo.ts     # SQL 实现 SavedRouteRepo
      session-summary-reader.ts
      row-map.ts              # toSavedRoute / toSessionSummary / iso / isStatus
      errors.ts               # 今 lib/errors（或保留 lib/ 路径）
    inbound/
      # 近端可继续：index.ts · router.ts · auth/jwt.ts 不强制搬目录
  db/
    client.ts · schema.ts     # 保留；schema 对齐 saved_routes
  # 删除或变空：api/routes.ts（拆光后删）
```

**允许的更浅变体（若 PR 想少 mkdir）：**

```text
src/
  domain/{ownership,claim,saved-route-status}.ts
  application/{ports,list-*,save-*,delete-*,claim-*,list-session-*}.ts
  db/{client,schema,saved-route-repo,session-summary-reader,row-map}.ts
  lib/errors.ts
  auth/jwt.ts · router.ts · index.ts
```

两种变体 **逻辑边界相同**；选一种写进实现 PR 的 description，不要两种半截。

### 2.2 函数级 from → to

| From（今日） | To（目标） | 动作 | 备注 |
|---|---|---|---|
| `api/routes.ts` `isRecord` | `adapters/.../row-map.ts` 或 `domain/parse.ts` | **move** | 共享 narrow |
| `api/routes.ts` `isStatus` | `domain/saved-route-status.ts` `isSavedRouteStatus` | **move + rename** | 纯类型守卫 |
| `api/routes.ts` `strings` | `row-map.ts` | **move** | point_ids 窄化 |
| `api/routes.ts` `iso` / `nullableIso` | `row-map.ts` | **move** | workerd timestamptz 边界 |
| `api/routes.ts` `requireRouteRow` / `toUserRoute` | `row-map.ts` `toSavedRoute` | **move + rename** | 输出契约 SavedRoute |
| `api/routes.ts` `requireSessionRow` / `toSession` | `row-map.ts` `toSessionSummary` | **move + rename** | 投影 DTO；注释写清非 Conversation 写 |
| `api/routes.ts` `sessionPage` / `MAX_LIST_OFFSET` | `application/list-session-summaries.ts` 或 domain `paginate` | **move** | 分页截断规则可纯测 |
| `api/routes.ts` `ownerFrom` | `domain/ownership.ts` `ownerIdFromRow` | **move** | 纯 |
| `api/routes.ts` `assertOwner` | **拆** | **split** | 见下节 |
| `api/routes.ts` insert/update/delete/claim `*Sql` + `*Row` | `SavedRouteRepo` 实现 | **move** | 唯一持 SQL 处 |
| `api/routes.ts` `sessionSql` + listSessions body | `SessionSummaryReader` + use case | **split** | 读 `conversations` 只在 reader |
| `api/routes.ts` `listRoutes` | `application/list-saved-routes.ts` | **move** | 依赖 `SavedRouteRepo.listByUser` |
| `api/routes.ts` `saveRoute` / `createRoute` / `updateRoute` | `application/save-saved-route.ts` | **move + simplify** | 见 §2.4 |
| `api/routes.ts` `deleteRoute` | `application/delete-saved-route.ts` | **move** | assert + delete |
| `api/routes.ts` `claimRoutes` / `claimRouteRows` | `application/claim-saved-routes.ts` + repo | **move** | 规则可在 domain 文档化；原子性仍在 SQL UPDATE |
| `api/routes.ts`（文件） | **删除** | 拆完后无 re-export 上帝桶 | 测试改 import |
| `lib/errors.ts` | `adapters/outbound/errors.ts` **或** 保留路径 | optional move | 应用层返回 domain 结果后由 handler/map 抛 ORPCError 更干净；**最小改动可先保留** |
| `db/schema.ts` `routes` | `savedRoutes` / 表 `saved_routes` | rename + **drop 遗留列 typing** | 与迁移同 PR 或紧邻 |
| `router.ts` handlers | 仍薄：调 application 函数 | **edit** | `UsersContext` 注入 port 实现，**不**直接暴露 `DbExecutor` 给用例（见 §2.3） |
| `index.ts` composition | `makeDb` → 构造 `createSavedRouteRepo(db)` 等 | **edit** | 仍是 DI 根；测试注入 fake ports **或** 继续 fake `DbExecutor` 进真实 repo |
| `test/in-memory-routes-db.ts` | 保留一段时间 **或** 升 `FakeSavedRouteRepo` | 渐进 | 见 §5 |
| 无 | `domain/*.test.ts` 或 `test/domain-*.worker.test.ts` | **new tests only** | 纯函数；无 SQL |

### 2.3 `assertOwner` 拆分（关键结构点）

今日（嵌在 routes.ts）：

```text
assertOwner(db, userId, routeId)
  → SQL SELECT user_id
  → rows empty → routeNotFound
  → owner !== userId → routeNotOwned
```

目标：

| 片段 | 位置 | 形态 |
|---|---|---|
| `type Ownership = { kind: "found"; ownerId: string \| null } \| { kind: "not_found" }` | domain | 数据 |
| `decideOwnership(lookup, actorUserId): "ok" \| "not_found" \| "not_owned"` | `domain/ownership.ts` | **纯函数** |
| `SavedRouteRepo.findOwner(id): Promise<string \| null \| undefined>`（undefined = missing） | port | 出站 |
| use case: `const o = decideOwnership(...); if o !== "ok" throw mapError(o)` | application | 编排 |
| `mapError` → `routeNotFound` / `routeNotOwned` | errors adapter | 边界 |

**简化：** update/delete 的「先 assert 再写」可收敛为 **一次** repo 方法（`updateIfOwned` 返回 affected），但 **403 vs 404 语义必须保留**（parent 不变量 2）。推荐：

1. `findOwner` → domain decide → 非 ok 则错；  
2. 再 `update`/`delete` 带 `user_id` 条件；  
3. 若 2 返回 0 行 → 仍 `not_owned`（竞态）。  

不要为了少一次 round-trip 把 404 静默成 403 或反之。

### 2.4 `saveRoute` 化简

今日链：`saveRoute` → `createRoute`/`updateRoute` → `insertRoute`/`updateRouteRow` + 内联 CASE SQL。

目标：

| 步骤 | 谁 |
|---|---|
| 若 `input.id` 缺失 → create | application |
| 若有 id → ownership 裁决 | application + domain |
| `savedAtForStatus(status, previousSavedAt)` | **domain 纯函数**（draft→null；else previous ?? now） |
| `repo.insert` / `repo.update` | port；SQL 可继续用 CASE 或把 timestamp 从纯函数注入（**优先纯函数 + 参数化 NOW()** 以便测） |

**Clock port（可选）：** 仅当要把 `NOW()` 从 SQL 挪到 TS 时引入 `() => Date`；否则 **不** 为演示加 Clock — Thin 允许 SQL `NOW()`，domain 单测用固定 `previousSavedAt` 测规则表即可。

### 2.5 Port 形状（最小，禁止堆 interface）

```ts
// application/ports.ts — 示意，非实现

/** Users 写权威：saved_routes */
export interface SavedRouteRepo {
  listByUser(userId: string): Promise<unknown[]>; // 或已 map 的 SavedRoute[]
  findOwner(id: string): Promise<string | null | undefined>;
  insert(userId: string, input: SaveSavedRouteInput): Promise<unknown>;
  updateOwned(userId: string, input: SaveSavedRouteInput & { id: string }): Promise<unknown[]>;
  deleteOwned(userId: string, id: string): Promise<unknown[]>;
  /** Atomic claim: user_id IS NULL AND claim_session_id = ? */
  claimBySession(userId: string, claimSessionId: string): Promise<number>;
}

/** Agent 写权威表的只读投影 — 不是 Conversation 仓储 */
export interface SessionSummaryReader {
  pageByUser(
    userId: string,
    input: { limit: number; offset: number },
  ): Promise<unknown[]>;
}
```

**禁止的 port：** PointsRepo、Catalog 写、ShareRepo/CheckinRepo（无 runtime）、Agent message 写。

**DbExecutor：** 留在 adapter 构造函数内；**application 不 import** `drizzle-orm` / `sql`。

### 2.6 `UsersContext` 演化

| 阶段 | Context 内容 |
|---|---|
| 今日 | `{ db: DbExecutor; userId: string }` |
| 结构重构后 | `{ userId: string; savedRoutes: SavedRouteRepo; sessions: SessionSummaryReader }` |
| index 装配 | `db = makeDb(...)` → `savedRoutes = createSqlSavedRouteRepo(db)` 等 |

测试：

- **单元（application）：** 手写 fake repo（内存 Map）— 不解析 SQL。  
- **适配器：** 可保留 `fakeDb` SQL 分派测 repo 实现。  
- **HTTP：** `createUsersApp` 仍可 `makeDb` 注入；或新增 `makeRepos` 覆盖（可选，勿过度）。

### 2.7 语言对照（结构 PR 内命名）

| 旧（代码/SQL） | 新 |
|---|---|
| `UserRoute` / `toUserRoute` | `SavedRoute` / `toSavedRoute` |
| `listRoutes` / `saveRoute` / … | 用例文件名 `list-saved-routes` 等；**HTTP/oRPC 过程名**随 contract G1 |
| `session_id` 在 **routes 行**（claim 键） | **`claim_session_id`** |
| `listSessions` / `UserSession` | `listSessionSummaries` / **SessionSummary**（契约可分波） |
| `conversations` 查询 | 保留表名（Agent 权威）；代码注释：`// SessionSummary projection — Agent owns writes` |

---

## 3. SOLID smells with paths

| 原则 | 症状 | 路径 | 重构动作 |
|---|---|---|---|
| **S** Single Responsibility | 一个文件同时：行校验、所有权、CRUD SQL、会话分页、claim | `src/api/routes.ts`（整文件） | 拆 domain / application / repo（§2） |
| **S** | `index.ts` 配置、鉴权、oRPC handle、db 池 | `src/index.ts` | **可接受 Thin 根**；仅当再涨时抽 `guardUsersV1` → `inbound/users-v1-guard.ts`，**非必须** |
| **O** Open/Closed | 新用例只能往 `routes.ts` 加 export | `api/routes.ts` + `router.ts` | 新文件 + router 一行 wiring |
| **L** Liskov | `DbExecutor` 被当万能仓储；fake 靠 SQL 字符串 LSP 脆弱 | `test/in-memory-routes-db.ts` 对 `src/api/routes.ts` | port + fake 实现同一 interface |
| **I** Interface Segregation | 用例拿完整 `DbExecutor`（可执行任意 SQL） | `router.ts` `UsersContext.db`；所有 handler 签名 | 收成 `SavedRouteRepo` / `SessionSummaryReader` |
| **D** Dependency Inversion | application 直接依赖 drizzle `sql` 与表名 | `api/routes.ts` import `drizzle-orm` | 用例只依赖 port；SQL 仅 adapter |
| **D** | 错误类型在应用中心直接 `new ORPCError` | `assertOwner` → `lib/errors.ts` | domain 返回结果码；边界 map（可分期） |
| God function | `saveRoute` 创建/更新/所有权/时间戳一体 | `saveRoute` / `updateRoute` ~L183–200 | 编排薄 + `savedAtForStatus` 纯 |
| 重复 | update 与 delete 各写 assert + 0 行再判 | `updateRoute`, `deleteRoute` | 共用 `requireOwned` 应用 helper |
| 泄漏 BC | Users 文件内写「拥有会话」语义的命名/缺注释 | `listSessions` L116–121 | 改名/注释 SessionSummary；**不**迁写权威 |
| 遗留模型 | schema 含规划几何与 `route_data` | `src/db/schema.ts` L24–40 | 收成 SavedRoute 列；删 typing 死列 |
| 测试双关 | `FakeRouteRow` 兼 routes 与 conversations 行 | `test/in-memory-routes-db.ts` | 拆 `FakeSavedRouteRow` / 会话 seed，或 fake port |
| 命名债 | `session_id` 作 claim 键 vs 会话 `session_id` | SQL claim L222–225；schema L26 | greenfield `claim_session_id` |

**非 smell（勿过度修）：**

- `auth/jwt.ts` 短且单一 — 保持。  
- `DbExecutor` 作为 workerd 出站最小面 — 保留在 adapter。  
- oRPC `implement` 薄 handler — 正确；不要再包一层「UseCase class」。

---

## 4. Patterns for Thin package + what NOT to use

### 4.1 采用（Thin CA 工具箱）

| 模式 | 在本包的用法 |
|---|---|
| **纯函数 domain** | ownership / claim 资格文档化 / status→saved_at；**无 class 聚合根** |
| **Use case 函数** | `export async function saveSavedRoute(ports, userId, input)` — 模块级函数即可 |
| **Port interface** | 仅 2 个出站（SavedRouteRepo、SessionSummaryReader） |
| **Composition root** | `createUsersApp` 装配 repo；测试替换 `makeDb` 或 ports |
| **Result / 判别联合** | `OwnershipDecision` 代替抛异常驱动控制流（边界再转 ORPCError） |
| **Row mapper 在 adapter** | `toSavedRoute` 不进 domain 核心规则 |
| **1-10-50** | 拆文件后单函数 ≤10 行目标；超则再提纯，禁止为凑数再抽象 |
| **注释边界** | 若暂缓物理 `domain/` 目录，文件顶部分段 `// --- domain ---` **不可**代替长期拆分 — 本列车要真搬家 |

### 4.2 明确不采用（Full / 演示 OOP 禁区）

| 禁止 | 原因 |
|---|---|
| catalog 式深树：`domain/model/aggregates/...`、`application/services/...`、多层 `index.ts` barrel | 包体 ~700 行；空树违反 monorepo Thin 与 parent §0.1 |
| `SavedRoute` **class** + 私有字段 + 工厂仪式 | 无复杂不变式需要封装；zod/契约已是边界 |
| Repository **基类** / Unit of Work / Generic `CrudRepo<T>` | 仅一张主表 + 一个投影读 |
| Domain Event 总线、MediatR、CQRS 读写模型分离 | 无订阅方 |
| 为 Share/Check-in **预建** `ShareRepo` 空实现 | product #235/#243 开工再建 |
| DI 容器（tsyringe 等） | 手动构造足够 |
| `Either`/`fp-ts` 全盘 | 可选简单 union；不引入新运行时依赖 |
| 把 JWT 验签放进 domain | identity 是 inbound adapter |
| 在 Users 内「封装」Conversation 写 API | 违反 LOCKED §2.1.1 |
| 双写 `routes` + `saved_routes` 兼容层 | greenfield 无用户；一次迁到位 |

### 4.3 依赖方向（硬规则）

```text
index / router / auth/jwt
        ↓
application/*  (use cases)
        ↓
domain/*       (pure)
        ↑
adapters/outbound/*  implements ports（application 定义 port）
```

- `domain/*` **不得** import：`hono`、`jose`、`drizzle-orm`、`@orpc/*`、`./db/*`。  
- `application/*` **不得** import：`sql` 模板、表名字符串（经 port）。  
- 允许 `application` import `type` 自 `@animichi/contract`。  
- `adapters` 可 import domain 纯函数做映射辅助。

### 4.4 与 Full 包（catalog）对照

| | Catalog（Full） | Users（本列车） |
|---|---|---|
| 领域厚度 | 规划 kernel、多聚合 | 所有权 + 生命周期 + claim 幂等 SQL |
| 目录 | 完整 domain/application/adapters 合理 | **浅**；5 用例 + 2 port |
| 测试 | 大量 domain 单测 | domain 薄测 + 现有 worker 测保留 |
| 成功标准 | 规则可单测、handler 无 SQL | **同左**，但文件总数不必膨胀 |

---

## 5. PR slices（existing code only）

原则：**每 PR 可独立绿**（`pnpm test` / typecheck / lint in `workers/users`）；优先可审 diff；**不**夹带 Share/Check-in。

### Slice U-S0 — 文档对齐（可选，可已做）

- CONTEXT / AGENTS 已指向 parent CA：确认「SessionSummary 只读」「claim_session_id」用语。  
- **无生产代码。**

### Slice U-S1 — 纯规则抽出 + 无 DB 测试

**动：**

| 新增 | 内容 |
|---|---|
| `domain/ownership.ts` | `decideOwnership` |
| `domain/saved-route-status.ts` | `isSavedRouteStatus`, `savedAtForStatus` |
| `domain/claim.ts` | `isClaimable({ userId, claimSessionId }, sessionKey)` 文档化规则（与 SQL WHERE 同语义） |
| `test/domain-rules.worker.test.ts` 或 vitest 普通测 | 表驱动：404/403/ok；draft/saved_at |

**暂不动：** SQL 仍可在 `api/routes.ts`；`assertOwner` 可先 **调用** `decideOwnership` 再抛错（半对接）。

**验收：** 新测全绿；既有 worker 测绿；`routes.ts` 行数下降。

### Slice U-S2 — SavedRouteRepo port + SQL 搬家

**动：**

- `application/ports.ts` + `adapters/.../saved-route-repo.ts`（或 `db/saved-route-repo.ts`）。  
- 迁移 list/insert/update/delete/claim/findOwner SQL。  
- `listRoutes` / `saveRoute` / `deleteRoute` / `claimRoutes` 改为调 repo（可仍住 `api/routes.ts` 短暂，或已拆 application 文件）。  
- `row-map.ts`：`toSavedRoute`（名可先 `toUserRoute` 若 contract 未改）。  
- 更新 `in-memory-routes-db` **或** 测 repo 的 SQL fake。

**验收：** 行为不变（403/404/claim 计数/saved_at）；无 contract 强制改名亦可本 slice 只做结构。

### Slice U-S3 — SessionSummaryReader + 投影语义

**动：**

- 抽出 `listSessions` SQL → `SessionSummaryReader`。  
- 应用函数命名/注释：**SessionSummary projection；Agent owns Conversation writes**。  
- `UsersContext` 去掉裸 `db`（若 U-S2 已换 SavedRoute，本 slice 换掉剩余 db）。  
- router / index 装配两 port。

**验收：** 分页 `next_offset` 与 `MAX_LIST_OFFSET` 行为不变；row-validation 会话测绿。

### Slice U-S4 — 拆 application 文件 + 删 `api/routes.ts`

**动：**

- 五文件 use case；router 改 import。  
- 删除 `api/routes.ts`；必要时删空 `api/`。  
- 测试 import 路径全量更新。  
- 跑 1-10-50 目视：过长函数再抽。

**验收：** 包内无「上帝 routes 文件」；目录符合 §2.1 选定变体。

### Slice U-S5 — Greenfield 语言 / 表（可与 U-S2 合并，勿无结构只 rename）

**动（仍限 users 包 + 其测试 + 约定的 contract/migration 邻 PR）：**

- 表 `routes`→`saved_routes`；列 claim 键→`claim_session_id`。  
- schema.ts 收列。  
- 类型/函数名 SavedRoute；错误码与 contract 对齐。  
- fake SQL 文本 `insert into saved_routes` 等。

**跨包 path**（`/v1/users/saved-routes`）若 contract 同改：edge/web 跟车 — **不算本结构文档展开**，但 PR 描述须链 greenfield G1。

**验收：** users 测绿；无双写。

### Slice 顺序建议

```text
U-S1（纯规则） → U-S2（SavedRouteRepo） → U-S3（SessionSummary） → U-S4（删上帝文件）
                 ↘ U-S5 语言/表 可与 U-S2 或 U-S4 合并，但禁止「只改名不搬家」
```

主战场 ticket 引用：parent §0.4 → **#432** · **#666**（分层/会话不变量）。

### 每 slice 不做

- Share / Check-in / しおり / presign 实现。  
- 新建空表 `route_shares` / `walk_checkins`（除非独立 product PR）。  
- Edge/Web 大范围 UI。  
- 覆盖率用 `skip` / `eslint-disable` 糊弄。

---

## 6. Non-goals

### 6.1 包外系统（本设计不规定实现）

| 系统 | 为何 out |
|---|---|
| **workers/edge** | 仅透传 `Authorization` 与 path；path 字符串跟 G1 contract，无 Users domain |
| **apps/web** | 客户端改 import/path；非 users 结构 |
| **apps/agent** | Conversation 写权威已 LOCKED；本重构 **不** 把消息写入 Users，也 **不** 在 Agent 加 SavedRoute CRUD（G4） |
| **workers/catalog** | 无 FK、无 Itinerary 内嵌 |
| **workers/maintenance** | 不扫 `saved_routes` 的 retention 策略另议（O11） |
| **packages/contract 全仓** | 仅 users 相关符号在 U-S5 邻接；catalog `Itinerary` 改名属 catalog 列车 |

### 6.2 产品 enabler（设计指引 → ticket，本列车零实现）

| 能力 | Ticket | 本文件 |
|---|---|---|
| RouteShare runtime | **#235** | 一行：实现时遵守 parent §2.5.3 + Thin port，**不**预建 |
| WalkCheckin runtime | **#243** | 一行：实现时遵守 §2.5.4 幂等，**不**预建 |
| しおり / presign / 対比図 | **#249** | 一行：归属 OPEN O1/O2；**不**在 users 结构 PR 做 |
| 匿名谁 INSERT SavedRoute | O4 / #289 #333 | 现码 claim 假设行已在；结构只整理 claim 读改路径 |
| 双 claim 编排（route + conversation） | O5 / #333 #386 | 只整理现有 claim **端点** 边界 |
| SessionSummary 最终挂谁 | O6 / #526 | 现 `listSessions` 可投影注释/改名；**不**迁服务 |
| UserMemory | O7 / SD-15 | 无 |
| GDPR 级联 / RLS | O11 / O12 | 无 |

### 6.3 结构上的非目标

- 为「将来 Share」先铺 `application/create-share.ts` 空文件。  
- 统一全仓同一目录深度。  
- 把 `listSessions` 从 Users **删掉**（产品未定 O6；现面保留为只读投影）。  
- 性能项目（Hyperdrive 调优、缓存）— 非结构债。  
- 替换 oRPC/Hono/Neon 栈。

---

## 7. 测试策略（结构重构配套）

| 层 | 今日 | 重构后 |
|---|---|---|
| domain | 几乎无 | ownership / saved_at / claimable / sessionPage 边界 — **无 DB** |
| application | 经 SQL fake 间接 | fake ports 直接（U-S2+） |
| adapter SQL | `in-memory-routes-db` | 可保留测 repo；或缩小为关键 SQL 快照 |
| HTTP / JWT | `route-mutations` · `auth` · `worker` | **保留**；只改装配 |
| 行校验 | `row-validation` | 跟 `row-map` / use case import |

纪律（仓级）：≤200 行/测试文件；≤5 mocks/测；不靠真实时钟断言。

---

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 只 rename 交差 | Reviewer 对照 §2 表：须见 **新文件 + routes.ts 删除/瘦身** |
| 拆太细导致 20 个 5 行文件 | 上限：domain ≤3 文件、application ≤5、repo ≤2；禁止空 barrel |
| fake SQL 与真实 SQL 漂移 | U-S2 后优先 fake port；adapter 测关键查询文本 |
| claim 列改名漏测 | U-S5 显式测 `claim_session_id`；mutation 测 claimed_count |
| Context 同时持 db 与 port 半迁 | U-S3 结束前允许过渡；U-S4 禁止 `UsersContext.db` |
| 误把 Conversation 写入 Users | 代码审：无 `INSERT/UPDATE conversations`；仅 SELECT |

---

## 9. 完成定义（Definition of Done — 结构列车）

当且仅当：

1. **`src/api/routes.ts` 已删除**（或 ≤50 行 re-export 过渡且下一 PR 必删 — 推荐直接删）。  
2. Domain 纯规则可单测且 **不** import drizzle/hono/jose。  
3. Application 用例只依赖 **SavedRouteRepo + SessionSummaryReader**（+ userId）。  
4. SQL 仅出现在 outbound adapter。  
5. Claim 语义与 status/saved_at 行为与重构前一致（测锁定）。  
6. SessionSummary 路径有「Agent 写权威 / Users 只读投影」注释或类型名。  
7. **无** Share/Check-in/しおり/presign 新 runtime。  
8. `pnpm test` + typecheck + lint 在 `workers/users` 绿。  

**非 DoD：** 目录「看起来像 textbook」；interface 数量最大化。

---

## 10. 与 parent 文档映射

| Parent | 本结构文 |
|---|---|
| §0.2 L1 Thin CA | §4 模式；§2 浅树 |
| §0.2 L5 Conversation / listSessions | §2.5 SessionSummaryReader；§6.2 O6 |
| §0.4 真结构非只 rename | 全文；§5 U-S*；§9 DoD |
| §3 圈层 | §2.1–2.3 |
| §5 ports | §2.5（仅已实现两 port） |
| §6.1 五用例 | §2.2 表 |
| §9 U3/U4 | ≈ U-S1 / U-S2–S4 |
| Greenfield 原则 6–7 | §0 · §5 U-S5 · §6 |

---

## 11. 变更日志

| 日期 | 变更 |
|---|---|
| 2026-08-06 | 初稿：workers/users 已有码结构重构设计；inventory / move 表 / SOLID / Thin 模式 / PR slices / non-goals；Share·Check-in·presign 仅挂 #235 #243 #249 |
| 2026-08-06 | Owner **ACCEPTED**（best-practice 默认） |
