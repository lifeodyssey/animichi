# Users 教科书式 DDD + Clean Architecture 设计（Thin 分级）

- Status: **ACCEPTED (core BC)** — owner 收口 2026-08-06；**不含实现**
- Scope note: 下文 **§0.2 LOCKED** vs **§0.3 OPEN** — 核心边界已锁；产品面大量能力仍待单独设计，**不得假装整包已设计完**
- Date: 2026-08-06
- Package: `workers/users`（TS Cloudflare Worker · Hono · oRPC · Neon）
- Language: ADR-0002 · greenfield 总表 · `workers/users/CONTEXT.md`
- Parent: `docs/superpowers/specs/2026-08-06-monorepo-target-layout.md`
- Siblings: [Catalog ACCEPTED](./2026-08-06-catalog-clean-architecture-design.md) · [Agent ACCEPTED](./2026-08-06-agent-clean-architecture-design.md) · [Greenfield 总表](./2026-08-06-greenfield-language-and-data-plane.md)
- Tier: **Thin**（monorepo §4.3 LOCKED 默认）— 不硬套 Full 四层空壳
- Accepted: U1–U7（核心）；§0.3 仍为后续设计队列

---

## 0. 目标

把 Users 从「已能跑的 SavedRoute CRUD + JWT 门」收成**可教学且与分级一致**的：

1. **DDD**：SavedRoute / Claim / Share / Check-in 语言清晰；**不**拥有 Point 几何与 Itinerary 算法  
2. **Clean Architecture（Thin 版）**：所有权与生命周期规则可抽测；SQL / jose / Hono 在外圈  
3. **信任模型可叙述**：Bearer JWT 自验签、跨用户 403、分享 resolve 匿名只读 — 与 AGENTS 一致  

**非目标（本文仍不直接改生产代码；实现按 §9 分期 PR）：**

- 立刻 mkdir 空 domain 深树  
- 本文阶段不部署 Share/Check-in runtime（表与契约目标已在 §2.5 定好）  

**Greenfield 前提（owner 2026-08-06）：** 无历史用户 / 无生产包袱 → **语言、契约、表名一次到位最佳形态**，不保留 `UserRoute` / `routes` 作为长期别名。

### 0.1 与 Full 包（catalog / agent）的差别（LOCKED 默认）

| | Full（catalog / agent） | **Thin（users）** |
|---|---|---|
| 领域厚度 | 规划 kernel、会话策略、多 port | **所有权 + 生命周期 + 幂等** 为主 |
| 目录 | 目标有完整 domain/application/adapters | **可先逻辑分层**；物理目录可浅 |
| 强制 | 禁止 handler 内堆业务 | 禁止「所有 SQL + 规则糊在一个文件」无限膨胀；**允许**小包单文件用例 |
| 空 domain/ | 有场景再 mkdir | **无场景不 mkdir**（monorepo 明确不做） |

**一句话：** Users 要的是 **清晰边界与不变量**，不是 catalog 规模的目录树。

### 0.2 本次收口 — LOCKED（可据此实现 G1 / 分层）

| # | 锁定内容 |
|---|---|
| L1 | **Thin CA**：浅 domain + 用例/port；不硬套 Full 深树（§0.1 / §3） |
| L2 | **语言 greenfield**：SavedRoute / SavedRouteStatus / Claim / RouteShare / WalkCheckin；禁 `UserRoute`/`routes` 用户义（§2.1） |
| L3 | **表目标**：`saved_routes`、`route_shares`、`walk_checkins`；无跨 BC FK（§2.5） |
| L4 | **不变量**：JWT 门、所有权 403/404、Claim 规则、status/`saved_at`、Share hash+快照、Check-in 幂等、G4（§2.3） |
| L5 | **Conversation / 会话内 memory → Agent 写权威**；`listSessions` = 只读投影；跨会话 UserMemory 醒后 → Users（§2.1.1） |
| L6 | **Share / Check-in 属于 Users BC**（契约已有）；runtime 分期 U5/U6，表可 G1 先建 |
| L7 | **Catalog 关系**：只持 `point_ids` 引用；Itinerary 不在本包算；Share 创建时固化 `public_snapshot` |

### 0.3 明确尚未设计好 — OPEN（禁止当已定案实现）

下列来自 rebuild 产品环与既有契约/iter，**不在本次 ACCEPTED core 内**。需要时 **另开短设计卡** 再写进本文或子文。

| ID | 主题 | 为何仍 OPEN | 建议何时设计 |
|---|---|---|---|
| **O1** | **しおり（keepsake）持久化 / 生成元数据** | 产品 iter-4 重面；版式/完走态/对比図枚数；是否只存 R2 key + SavedRoute 引用未定 | Share 前或并 Share |
| **O2** | **R2 presign（#249）归属** | 契约曾挂 users 周边；edge/root 也出现过；路径、TTL、`sub` 前缀、谁验 JWT | しおり / 对比図上传前 |
| **O3** | **対比図 / image-merge 记录** | 挂在 cut 还是 check-in 还是独立表；与 Walk 机位关系 | iter-4 数据卡 |
| **O4** | **匿名产出 SavedRoute 的写路径** | 今日 claim 假设行已存在；**谁在匿名时 INSERT**（Agent？临时 Users 匿名？）未钉 | G1 SavedRoute 前必须钉 |
| **O5** | **Claim 与 conversation.user_id 编排** | SavedRoute claim 在 Users；conversation claim 在 Agent；Web 一次登录是否两调用 / 顺序 / 失败补偿 | Claim 产品化前 |
| **O6** | **SessionSummary API 最终挂谁** | 可挂 Users 投影或 Agent；影响 Edge 路由与 web client | 続きから / 历史页前 |
| **O7** | **UserMemory 字段模型** | SD-15 休眠；payload 形状、可见可编辑、GEM 语义 | 解冻 SD-15 时 |
| **O8** | **catalog_suggestions / UGC 飞轮** | 打卡纠偏信号进 suggestions；审核流；绝不自动写 catalog | 飞轮3 工程卡 |
| **O9** | **SavedRoute 与 Agent 产出同步** | chat 出行程后如何落 `saved_routes`（自动 draft？用户点保存？） | 与 O4 一起 |
| **O10** | **错误码与 OpenAPI 最终集** | `SAVED_ROUTE_*` 全量、share/checkin 已有；しおり/presign 未有 | 各能力设计时 |
| **O11** | **删除级联与 GDPR/注销** | 删用户时 saved_routes/shares/checkins 顺序；anon purge 边界 | 有真实用户前 |
| **O12** | **RLS 是否补策略** | 今应用层裁决；Neon RLS 是否纵深防御 | 安全卡可选 |

**纪律：** 实现 PR 只允许碰 **§0.2 LOCKED** + 已单独 ACCEPTED 的 O* 卡。遇到 O* 未决就停并开设计，不靠「先写着再说」。

### 0.4 重构范围（LOCKED — owner 2026-08-06）

**全仓同一原则**（见 greenfield §0 原则 6–7）：重构列车 = **已有代码的真·结构工作**，**不止 rename**。

| | 做什么 | 不做什么 |
|---|---|---|
| **本重构列车（Users 已有码）** | **移动** handler/SQL/规则文件；抽出 ownership/claim **纯函数** 与 SavedRouteRepo port；**化简** 事务脚本；JWT/adapter 边界清晰；greenfield 命名对齐；SOLID / 1-10-50 | 为演示堆 interface；把 Thin 硬升 Full 空树 |
| **未写代码** | 设计指引 **comment → 既有 ticket**；ticket 开工时再实现 | 在重构 PR 里实现 Share/Check-in/しおり/presign |
| **表** | rename/收紧 **现有** `routes`→`saved_routes`（代码已写） | 未开工 enabler **抢先建空表**（除非该 ticket 自己建） |

**O\* → 既有 ticket 挂载（设计指引写 issue comment，不新开 epic 除非缺票）：**

| OPEN | 既有 ticket（主） | 重构侧只做 |
|---|---|---|
| O1 しおり | #212 #215 #219 | 无 |
| O2 R2 presign | #249 | 无 |
| O3 対比図记录 | #249 / #215 系 | 无 |
| O4/O9 匿名/chat 落 SavedRoute | #289 #333 #432 | 仅当现码已有路径则整理命名 |
| O5 双 claim 编排 | #333 #386 | 现有 claim 端点可 greenfield 改名 |
| O6 SessionSummary 挂谁 | #526 #386 | 现有 `listSessions` 可改名/投影注释 |
| O7 UserMemory | SD-15 / 无硬票则 ticket 自建时引用本文 | 无 |
| O8 catalog_suggestions | 飞轮工程卡（未绑则 backlog） | 无 |
| Share runtime | **#235** | 无实现；指引见 comment |
| Check-in runtime | **#243** | 无实现；指引见 comment |
| 分层/会话不变量 | **#432** #666 | **本重构可做的主战场（已有代码）** |

---

## 1. 现状诊断（设计基线）

### 1.1 今日目录（~700 行量级）

```text
workers/users/src/
  index.ts          # Hono 入口、DI、JWT 门、oRPC OpenAPIHandler
  router.ts         # implement(usersContract) + UsersContext
  api/routes.ts     # list/save/delete/claim + listSessions（SQL + 映射）
  auth/jwt.ts       # jose 远程 JWKS 验签
  db/schema.ts      # Drizzle 仅 typing（routes 表）
  db/client.ts      # DbExecutor（raw sql）
  lib/errors.ts     # ROUTE_NOT_* 镜像
```

### 1.2 已有正确碎片

| 碎片 | 评价 |
|---|---|
| BC：用户域数据服务，binding-only `/v1/users/*` | G4 / SD-2 对齐 |
| 契约 `packages/contract/src/users-contract.ts` | 发布语言入口 |
| JWT 自验签 + `sub` → `user_id` | 信任边界清晰（≠ Edge 预鉴权） |
| `assertOwner` → 404 / 403 分型 | 所有权在应用边界，不静默靠 RLS |
| claim：`session_id` 且 `user_id IS NULL` | Claim 语义已在 SQL 里 |
| 测试 seam：`createUsersApp({ getKey, makeDb })` | 可替 port 意识 |
| workerd 纪律：raw `sql`、数组 `sql.param`、timestamptz normalize | 运维债写进 AGENTS |

### 1.3 与目标态差距（greenfield 可一次清）

| 期望 | 现状（待迁） |
|---|---|
| 表 `saved_routes` + 契约 `SavedRoute` | 表 `routes` + 类型 `UserRoute`；混有旧规划列 |
| 无跨 BC 的 FK 到 `bangumi` | `routes.bangumi_id` 曾 REFERENCES catalog |
| Share / Check-in 表就绪 | 契约有、表与 Worker 无 |
| Conversation 写权威文档化 | 已 LOCK §2.1.1；列表投影仍可读 |
| 领域规则可单测 | 规则嵌在 SQL / `api/routes.ts` |

**结论：** 运行时 Thin 服务已能用；**命名与表形状按 §2.5 直接迁到最佳**，不做兼容层。

---

## 2. 领域模型（Users BC）

### 2.1 统一语言（LOCKED — greenfield，无遗留别名）

| 词 | 含义 |
|---|---|
| **SavedRoute** | 用户文档：title、`point_ids[]`、`SavedRouteStatus`、时间戳；可尚未 claim（`user_id` 空 + `claim_session_id`） |
| **SavedRouteStatus** | `draft` \| `saved` \| `completed` |
| **Claim** | 将仍匿名的 SavedRoute（`user_id IS NULL` 且 `claim_session_id` 匹配）归属到 JWT `sub` |
| **SessionSummary** | 历史列表用的对话摘要投影 — 非 auth session；非 Conversation 所有权 |
| **RouteShare** | 一条 SavedRoute 的公开分享记录（token、过期、吊销、公开快照） |
| **ShareToken** | 分享用高熵 token（库内只存 **hash**） |
| **WalkCheckin** | Walk 打卡；`client_id` 离线幂等键 |
| **point_ids** | Catalog **Point** 的 id 引用列表，非几何权威 |
| **UserMemory** | 跨会话 profile（SD-15 休眠；表形状预留见 §2.5.4） |

**禁止在新代码/新契约中使用：** `UserRoute`、`Route`（裸词）、`routes` 表名（用户域）。  
Catalog 的计算结果继续叫 **Itinerary**，与 SavedRoute 严格二分。

**不拥有：**

| 概念 | 拥有方 |
|---|---|
| Point 几何 / Bangumi 主数据 / Itinerary 算法 | Catalog |
| **Conversation / 消息 / 会话运行时 / 会话内 memory**（fact ledger、tool_state、`agent_memory*`、`conversation_messages`） | **Agent**（写权威） |
| JWT 签发 / magic-link UI | Neon Auth · apps/web |
| Edge 限流 / 路由 | Edge |
| 匿名 Session retention cron | Maintenance（对象仍是 agent 域数据） |

### 2.1.1 Conversation / Memory 归属（LOCKED — owner 2026-08-06）

| 概念 | 拥有方 | Users 角色 |
|---|---|---|
| Conversation + messages + Session 运行时 + 会话内 memory | **Agent** | **无写权威** |
| `listSessions` / 历史列表 API | API 可挂 Users | **只读投影**（读 agent 域表或只读视图）；不因列表在 Users 而转移所有权 |
| Claim SavedRoute（`saved_routes.user_id`） | **Users** | 写 |
| Claim / 迁移 conversation 的 `user_id` | **Agent 域规则**（今 session migration 等） | Users 至多编排调用，不双写消息 |
| 跨会话 `user_memory`（唤醒后） | **Users** | 读写；Agent 只读消费 |

**原则：** 同一张 Neon 表 ≠ 同一 BC。写方 = 语义权威；只读投影 ≠ 拥有。

### 2.2 拥有 / 不拥有（行为）

| 拥有 | 不拥有 |
|---|---|
| SavedRoute 持久化与所有权裁决 | 根据 point_ids 重算 Itinerary（调 Catalog 或由 Web 调） |
| Claim 归属语义 | 改写 Catalog 点位 |
| Share 签发 / 吊销 / 公开投影（目标） | 完整 GPS 出现在公开投影 |
| Check-in 写入与幂等（目标） | photo 上传/presign 实现细节可另卡，但 ref 归用户域 |
| 对 JWT `sub` 的行级 scoping | 匿名 Chat 配额（Agent 域） |
| SessionSummary 只读列表（可选 API 面） | Conversation 消息正文的写与 compaction |
| 跨会话 UserMemory（唤醒后） | 会话内 fact ledger / agent_memory 写 |

### 2.3 核心不变量（草案，确认后 LOCK）

1. **身份：** 除 **Share resolve** 外，Users 过程一律要求有效 Neon Auth JWT；`sub` = 行级 `user_id`。  
2. **所有权：** 对已归属用户的 SavedRoute，非 owner → **403 `ROUTE_NOT_OWNED`**；不存在 → **404 `ROUTE_NOT_FOUND`**（先存在性再所有权的现序可保留，但不得把跨用户静默当 404 掩盖审计需求时需文档化）。  
3. **引用而非复制：** SavedRoute 只存 `point_ids`（及元数据）；**不**复制 Point 坐标为权威源。  
4. **Claim：** 仅 `user_id IS NULL` 且 `claim_session_id` 匹配的 SavedRoute 可被 claim；已有 `user_id` 的行不可被他人 claim。  
5. **Status / saved_at：** `draft` → `saved_at` IS NULL；进入 `saved`/`completed` 时建立或保留 `saved_at`。  
6. **Share：** 库内只存 token **hash**；过期/吊销终态；resolve 返回 **创建时固化的 public_snapshot**（无全精度 GPS、无内部 user id — 契约）。  
7. **Check-in：** 同 `(user_id, client_id)` 同 payload 幂等；payload 变更 → 冲突；观测 GPS 截断 ~100 m。  
8. **G4：** 用户域能力进本服务；**禁止**再往 Agent 加用户数据端点。  
9. **Conversation 写权威在 Agent**（§2.1.1）；Users 不得写 messages / 会话内 memory。  
10. **SessionSummary 列表 = 只读投影**。  
11. **无跨 BC 外键：** `point_ids` / `primary_bangumi_id` 为 **TEXT 引用**，不 REFERENCES catalog 表。

### 2.4 上下文关系

```text
Web / Edge ── Bearer ──▶ Users ──SQL──▶ Neon
                │              │  saved_routes · route_shares · walk_checkins · user_memory?
                │              ├── point_ids 文本引用 ──▶ Catalog（无 FK）
                │              └── SessionSummary ──只读──▶ conversations（Agent 写）
Chat ──▶ Agent ──写──▶ conversations / messages / session runtime
Claim SavedRoute ──▶ Users 写 saved_routes.user_id
Claim conversation.user_id ──▶ Agent
Share resolve（匿名）──▶ Users（hash 查 token → public_snapshot）
```

**表纪律（LOCKED）：**  
- Users 写权威：`saved_routes`、`route_shares`、`walk_checkins`、（未来）`user_memory`  
- Agent 写权威：`conversations`、`conversation_messages`、会话内 memory 表  
- 禁止无协调双写同一语义列  

### 2.5 目标数据模型（Greenfield LOCKED）

**前提：** 无生产用户 → Atlas 迁移可 **DROP/RENAME 到位**，不做双写兼容窗。  
**权威迁移史：** `db/migrations`（目标路径 `migrations/neon/`）；Drizzle `schema.ts` 仅 typing。

#### 2.5.1 退役（用户域相关）

| 现状 | 处理 |
|---|---|
| 表 `routes` | **替换为** `saved_routes`（见下）；实现 PR 中 migrate + 改 Worker/测试 |
| 列 `bangumi_id` FK、`origin_location` geography、`total_distance`、`total_duration`、`route_data` | **不迁入**权威列；需要展示时打开再算 Itinerary 或 Share 用快照 |
| 契约 `UserRoute`、错误码文案里的含糊 “Route” | **改为** `SavedRoute` / `SAVED_ROUTE_*`（与 ADR-0002 一致） |
| HTTP path `/v1/users/routes` | **改为** `/v1/users/saved-routes`（及 claim 子路径） |

Catalog 的 `route_snapshots` / `catalog/route` API **不动**（那是 Itinerary，不是 SavedRoute）。

#### 2.5.2 `saved_routes`

```sql
-- 设计规格（实现时落入 timestamped Atlas 文件；以下为规范形状）
CREATE TABLE saved_routes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           TEXT,                    -- JWT sub；未 claim 时 NULL
  claim_session_id  TEXT,                    -- 匿名产出时的 agent session；claim 键
  title             TEXT NOT NULL DEFAULT '',
  point_ids         TEXT[] NOT NULL,         -- Catalog Point id 引用
  status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'saved', 'completed')),
  -- 可选规划提示（非几何权威；打开时可喂回 Catalog plan）
  origin_label      TEXT,
  origin_lat        DOUBLE PRECISION,
  origin_lng        DOUBLE PRECISION,
  pacing            TEXT CHECK (pacing IS NULL OR pacing IN ('chill', 'normal', 'packed')),
  primary_bangumi_id TEXT,                   -- 软引用，无 FK
  saved_at          TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT saved_routes_owner_or_claim CHECK (
    user_id IS NOT NULL OR claim_session_id IS NOT NULL
  ),
  CONSTRAINT saved_routes_origin_pair CHECK (
    (origin_lat IS NULL) = (origin_lng IS NULL)
  )
);

CREATE INDEX idx_saved_routes_user_updated
  ON saved_routes (user_id, updated_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX idx_saved_routes_claim_session
  ON saved_routes (claim_session_id)
  WHERE user_id IS NULL;

-- updated_at trigger：复用既有 update_updated_at()
```

**行语义：**

| 状态 | `user_id` | `claim_session_id` |
|---|---|---|
| 登录用户保存 | 有 | 可选（溯源） |
| 匿名会话产出、待 claim | NULL | **必有** |
| claim 后 | 写入 sub | 可保留溯源 |

#### 2.5.3 `route_shares`（Share 目标表）

```sql
CREATE TABLE route_shares (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  saved_route_id  UUID NOT NULL REFERENCES saved_routes(id) ON DELETE CASCADE,
  created_by      TEXT NOT NULL,             -- owner user_id
  token_hash      TEXT NOT NULL UNIQUE,      -- SHA-256(token) 等；永不存明文
  public_snapshot JSONB NOT NULL,            -- 创建时 PublicSharedItinerary 固化
  expires_at      TIMESTAMPTZ NOT NULL,      -- 签发时不可变
  revoked_at      TIMESTAMPTZ,
  view_count      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_route_shares_route ON route_shares (saved_route_id);
CREATE INDEX idx_route_shares_creator ON route_shares (created_by);
```

**resolve：** 入参 token → hash 查找 → 校验未过期且 `revoked_at IS NULL` → 返回 `public_snapshot`（不再实时拼内部 id）。  
**快照策略（LOCKED）：** 创建时固化公开投影，避免 Users 运行时强依赖 Catalog；点名/帧图在创建瞬间从 Catalog 读入快照。

#### 2.5.4 `walk_checkins`

```sql
CREATE TABLE walk_checkins (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL,
  saved_route_id  UUID NOT NULL REFERENCES saved_routes(id) ON DELETE CASCADE,
  point_id        TEXT NOT NULL,             -- Catalog Point 软引用
  client_id       UUID NOT NULL,             -- 离线幂等键
  latitude        DOUBLE PRECISION NOT NULL,
  longitude       DOUBLE PRECISION NOT NULL, -- 存储全精度；日志另截断
  checked_in_at   TIMESTAMPTZ NOT NULL,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  photo_ref       TEXT,
  CONSTRAINT walk_checkins_client_idempotent UNIQUE (user_id, client_id)
);

CREATE INDEX idx_walk_checkins_user_route
  ON walk_checkins (user_id, saved_route_id);
```

#### 2.5.5 `user_memory`（休眠预留；SD-15）

已有迁移曾 `DROP user_memory`。唤醒时 **新建**（不复活旧 JSON 形状 unless 产品需要）：

```sql
-- 仅规格预留；U 分期不默认建表，除非产品解冻 SD-15
CREATE TABLE user_memory (
  user_id     TEXT PRIMARY KEY,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,  -- 版本化 profile；字段治理另卡
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### 2.5.6 契约目标形状（与表对齐）

| 今日 | 目标 |
|---|---|
| `UserRoute` | `SavedRoute` |
| `RouteStatus` | `SavedRouteStatus` |
| `ROUTE_NOT_FOUND` / `ROUTE_NOT_OWNED` | `SAVED_ROUTE_NOT_FOUND` / `SAVED_ROUTE_NOT_OWNED`（或保留 code、改 message/类型名 — 实现时统一一种，推荐 **码与类型一并新名**） |
| `ListRoutesResult.routes` | `ListSavedRoutesResult.saved_routes` |
| paths `/v1/users/routes` | `/v1/users/saved-routes` |
| share 输入 `route_id` | `saved_route_id`（契约字段同步） |
| checkin `route_id` | `saved_route_id` |

**兼容：** 无。Web / 测试 / MSW 与实现 PR **同 PR 或紧后 PR** 改完。

---

## 3. Clean Architecture（Thin 圈层）

```text
Hono · oRPC · jose · neon-http · wrangler
        ▲
adapters: index（入站 HTTP/JWT）· db（出站 SQL）· errors map
        ▲
application: 用例（SaveSavedRoute, ClaimRoutes, …）
        ▲
domain（浅）: SavedRoute 不变量、Status 规则、Claim 资格、所有权结果类型
```

**依赖硬规则（Thin 版）：**

- 领域规则（状态机、claim 资格、所有权结果）**不** import Hono / jose / drizzle schema 类  
- 用例依赖 **port**（`SavedRouteRepo`、`SessionSummaryReader`、可选 `Clock`）  
- `auth/jwt` = 入站 identity adapter，不是 domain  
- **允许** 初期：domain 以纯函数模块存在（`domain/saved-route-rules.ts`），不必强制 class / 聚合根脚手架  

### 3.1 与现状命名对齐

| 教科书 | 今日可对应 |
|---|---|
| domain（浅） | 从 `api/routes.ts` 抽出的纯规则 + 行映射校验 |
| application | `listRoutes` / `saveRoute` / … 编排 |
| inbound | `index.ts` + `router.ts` + `auth/jwt.ts` |
| outbound | `db/*`、未来 share/checkin 仓储 |
| DTO | `@animichi/contract`（目标 `SavedRoute` 等） |

---

## 4. 目标职责树（设计；物理 mkdir 可选）

```text
workers/users/src/
  domain/                 # 可选物理目录；逻辑必须先有
    saved-route.ts        # 状态、saved_at、标题/点位数守卫（与契约对齐的内规则）
    ownership.ts          # found | not_found | not_owned
    claim.ts              # claim 资格语义（测的是规则，不是 SQL 串）
  application/
    list-saved-routes.ts
    save-saved-route.ts
    delete-saved-route.ts
    claim-routes.ts
    list-session-summaries.ts
    # 后续：create-share, revoke-share, resolve-share, submit-checkin, list-checkins
  adapters/
    inbound/              # 今日 index + router + auth
    outbound/             # 今日 db + errors
  # 近端可不改路径：继续 api/* 但文件内分「规则 / 仓储 / handler」三段注释边界
```

**近端推荐：** 在 **实现 Share/Check-in 之前** 完成规则抽取 + port，避免第三个 400 行事务脚本文件。  
**不强制** 与 catalog 同构的深树。

---

## 5. 端口（出站）

| Port | 职责 | 备注 |
|---|---|---|
| **SavedRouteRepo** | 对 `saved_routes` 列表/插入/更新/删除/claim | 替换今日 `routes` SQL |
| **SessionSummaryReader** | 分页读 Session 摘要 | 只读投影；写权威在 Agent |
| **ShareRepo** | `route_shares`：签发、吊销、按 token_hash 解析 | §2.5.3 |
| **CheckinRepo** | `walk_checkins` 幂等写与列表 | §2.5.4 |
| **Identity**（入站） | Bearer → `userId` | 今 `verifyBearer`；非出站 port |

**禁止的 port：** `PointsRepo` 写、Catalog 主数据写、Agent tool 循环。

**Catalog 关系：** Share **创建时** 读 Catalog 填入 `public_snapshot`；之后 resolve **不**依赖 Catalog 实时性。SavedRoute 打开重算 Itinerary → Web/Agent 调 Catalog，Users 不内嵌规划 kernel。

---

## 6. 主要用例

### 6.1 已实现（应对齐命名）

| Use case | 今日函数 | 说明 |
|---|---|---|
| ListSavedRoutes | `listRoutes` | owner 范围 |
| SaveSavedRoute | `saveRoute` | create / update + 所有权 |
| DeleteSavedRoute | `deleteRoute` | 所有权后删 |
| ClaimRoutes | `claimRoutes` | 匿名 session → 用户 |
| ListSessionSummaries | `listSessions` | 分页摘要（**只读投影**，非 Conversation 拥有） |

### 6.2 契约已有、Worker 未实现（设计纳入边界）

| Use case | 契约 | 说明 |
|---|---|---|
| CreateShare / RevokeShare / ResolveShare | `share-contract` | resolve **匿名**；create/revoke Bearer |
| SubmitCheckin / ListCheckins | `checkin-contract` | 全程 Bearer；幂等 `client_id` |

实施顺序建议：SavedRoute 分层收紧 → Share → Check-in（与产品 iter 对齐即可，不绑死）。

---

## 7. 与 Catalog / Agent / Edge / Web

| 邻居 | 关系 |
|---|---|
| **Catalog** | 供应商（Point 详情 / Itinerary 重算）；Users 只持 id 引用 |
| **Agent** | Conversation / 会话内 memory **写权威**；Users 只读列表投影 + Claim SavedRoute；**不**在 Agent 新增用户文档 CRUD（G4）；**不**在 Users 写消息 |
| **Edge** | 透传 `Authorization`；**不**替代 Users 验签 |
| **Web** | 经 `/v1/users/*`；Share 页可匿名 resolve |
| **Contract** | `users-contract` + share + checkin 为发布面 |
| **Maintenance** | 不清理用户已归属文档（除非另有产品规则）；匿名 agent 域 retention 不归 Users |

---

## 8. 测试策略（设计）

| 层 | 内容 |
|---|---|
| domain | ownership 结果、status/`saved_at`、claim 资格、check-in 幂等键冲突 — **无 DB** |
| application | fake repos + 用例 |
| adapters | 现有 `vitest-pool-workers`（JWT 本地 JWKS、fake `DbExecutor`） |
| 契约 | share/checkin 实现时锁形 + 错误码与 registry 一致 |

保留：≤200 行/测试文件、可注入 `getKey` / `makeDb`。

---

## 9. 分阶段（仅计划）

| 阶段 | 内容 |
|---|---|
| **U0** | 本文 core DESIGN → owner ACCEPTED | **DONE 2026-08-06** |
| **U1** | AGENTS/CONTEXT 与 §0.2 对齐 | 文档 |
| **U2** | Greenfield 数据面 + 契约（`saved_routes` 等）+ Worker/测试改名 | **须先决 O4/O9**（匿名谁写 SavedRoute）再动刀，或 G1 只做已登录路径 |
| **U3** | ownership / status / claim 纯规则 + 单测 | 代码 |
| **U4** | SavedRouteRepo port | 代码 |
| **U5** | Share runtime | 宜先有 O1 边界（しおり vs share） |
| **U6** | Check-in runtime | 契约较齐；O8 另卡 |
| **U7** | UserMemory | 仅 O7 解冻后 |

每阶段独立 PR 优先。**实现不得吞掉 §0.3 OPEN。**

---

## 10. Owner 确认（Users 核心）— **ACCEPTED 2026-08-06**

| # | 议题 | 决议 |
|---|---|---|
| **U1** | Thin 分级：浅 domain + 用例/port | **ACCEPTED** — §0.1 / §3 |
| **U2** | Greenfield 语言 + 表 + 契约（§2.1 / §2.5） | **ACCEPTED** |
| **U3** | 不变量 §2.3 | **ACCEPTED** |
| **U4** | Share / Check-in 进 BC；runtime 分期 U5/U6 | **ACCEPTED**（表形状锁；行为细节可随实现卡补 AC） |
| **U5** | Conversation/Memory 归属 §2.1.1 | **ACCEPTED** |
| **U6** | 分期 §9 | **ACCEPTED** |
| **U7** | Status → **ACCEPTED (core BC)** | **ACCEPTED**；§0.3 OPEN 不阻塞 core |

**未接受为定案：** §0.3 全部 O1–O12（仍是设计队列）。

---

## 11. 相关文档

| 文档 | 角色 |
|---|---|
| `workers/users/CONTEXT.md` · `AGENTS.md` | 语言；JWT 信任模型 |
| ADR-0002 | SavedRoute 发布语言 |
| rebuild **G4 / SD-2** | 用户域 → workers/users；禁止 agent 新数据端点 |
| `packages/contract` users / share / checkin | 发布面 |
| Catalog / Agent CA（ACCEPTED） | 邻居边界 |
| monorepo-target-layout | Thin 分级与逐包进度 |

---

## 12. 变更日志

| 日期 | 变更 |
|---|---|
| 2026-08-06 | 初稿 DESIGN ONLY；Thin 分级；对齐 X12/G4 与既有契约面 |
| 2026-08-06 | LOCK §2.1.1 Conversation/Memory 归属；U5 提前 ACCEPTED |
| 2026-08-06 | Greenfield：§2.5 目标表 `saved_routes`/`route_shares`/`walk_checkins`；契约去 `UserRoute`；无兼容层 |
| 2026-08-06 | 并入仓级总表 `2026-08-06-greenfield-language-and-data-plane.md`（全包同原则） |
| 2026-08-06 | **Core BC ACCEPTED**（U1–U7）；§0.2 LOCKED / §0.3 OPEN  backlog（O1–O12） |
| 2026-08-06 | §0.4 重构只动已有代码；O* 指引 comment 挂 #235 #243 #249 #333 #526 #432 #289 |
| 2026-08-06 | §0.4 明确：真·结构重构（搬家/化简/SOLID），不止 rename；全仓同原则 |
