# Animichi monorepo 目标形态（活文档）

- Status: DRAFT — 讨论中，逐段锁定
- Date: 2026-08-06
- Working copy: `~/work/animichi`（Documents 原仓 agent 侧曾 TCC 不可读）
- Method: 结构/架构讨论优先；路径搬迁与实施后置。Matt wayfinder / improve-codebase-architecture / domain-modeling 结论并入本文。

**怎么用这份文档**

1. 已锁定的段落标 `LOCKED`，改它们要显式翻案。
2. 进行中的段落标 `OPEN`，讨论结果直接往文档里追加/改写。
3. 实施时另开 PR；本文是 **目标态 + 决策记录**，不是 git mv 脚本。

---

## 0. 原则（LOCKED）

| # | 原则 |
|---|---|
| P1 | **第一层 = 部署与平台**，不是 Bounded Context 名录 |
| P2 | **DDD 主要落在包内部**（domain / application / adapters），靠 `CONTEXT-MAP` + `packages/contract` 画 context map |
| P3 | **根只做编排**：无业务 runtime 依赖；可部署单元自持配置 |
| P4 | **一张 Neon 数据面 → 一份 Atlas 迁移史**（服务内 Drizzle schema 仅打字） |
| P5 | **单测在包内**；**跨包真环境测在 `tests/`**；**CI 只在 `.github/`** |
| P6 | Supabase 是 **过渡**，cutover 完成后删除；在此之前可挪位置但不假装已下线 |

**不是目标的：** 把 `apps/` 与 `workers/` 揉成一个「按领域命名」的根目录。

---

## 1. 第一层目录与根文件（LOCKED）

### 1.1 目标树

```text
.
├── apps/
│   ├── agent/                 # Python FastAPI 容器
│   └── web/                   # TanStack Start，唯一浏览器面
├── workers/
│   ├── edge/                  # 网关 + auth + container 编排
│   ├── catalog/               # Bangumi / Point / Itinerary 数据与规划
│   ├── users/                 # SavedRoute 等用户文档
│   └── jobs/                  # 定时 retention jobs（原 maintenance；无 HTTP）
├── packages/
│   └── contract/              # 发布语言（oRPC/zod 等）
├── migrations/
│   ├── neon/                  # 原 db/migrations — Atlas
│   ├── supabase/              # 原根 supabase/ — 过渡
│   └── AGENTS.md
├── infra/
├── tests/
│   └── e2e/                   # 原 e2e/
├── scripts/
├── docs/
├── .github/
├── package.json               # private 编排 ONLY
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── Makefile
├── AGENTS.md · CLAUDE.md
├── CONTEXT-MAP.md
├── README.md (+ i18n)
└── 必要点文件
```

### 1.2 根上明确移除（目标态）

| 现状 | 去向 |
|---|---|
| 根上 edge 运行时 deps | `workers/edge/package.json` |
| 根 `wrangler.toml` | `workers/edge/` |
| 根 `Dockerfile` | `apps/agent/` |
| 根 `db/` | `migrations/neon/` |
| 根 `supabase/` | `migrations/supabase/` |
| 根 `e2e/` | `tests/e2e/` |
| `fixtures/` / 仅 agent 的 `docker/` | 沉入 `apps/agent/`（实施时核实） |

### 1.3 决策明细

| 议题 | 决定 |
|---|---|
| apps + workers | 保持双顶栏 |
| packages | 保留 `packages/contract`，不改顶层名为 contract |
| migrations | `neon/` + `supabase/` 并列 |
| **jobs**（原 maintenance） | 定时 retention Worker；包名 **`workers/jobs`**，不用 scheduler |
| infra | 顶层保留 |
| 系统测 | `tests/e2e/` |
| CI | 仅 `.github/` |

### 1.4 jobs（原 maintenance）

Cron 清理 agent 域匿名 Session / 配额行。包名 **`workers/jobs`**（比 maintenance 好懂；不用 scheduler 以免和编排混淆）。
非 catalog/users 职责；非 lib（需可部署 cron 单元）。结构：[jobs-worker-structure-design](./2026-08-06-jobs-worker-structure-design.md)。

### 1.5 Supabase

**未 cutover 完**：可挪到 `migrations/supabase/`，不能删。删除条件：edge 只信 Neon、api_keys 迁出、E2E 脱钩。

### 1.6 工具

Supabase CLI 需 `--workdir migrations/supabase`；Atlas `file://migrations/neon`；workspace 成员 `tests/e2e`。

---

## 2. 测试分层（LOCKED 方向）

| 层 | 位置 |
|---|---|
| 包内单测/集成 | 各包内 |
| 跨包真环境 | `tests/e2e/`（可扩展 smoke） |
| CI 编排 | `.github/` only |

---

## 3. Monorepo / DDD 立场（LOCKED）

第一层 = 部署与平台；DDD = 包内模型 + CONTEXT 地图。
Arch review 候选见会话记录（Edge package-ize 等）——实施顺序另议。

---

## 4. 领域语言与包内 domain model

### 4.0 跨上下文词汇（LOCKED — 2026-08-06）

权威：`CONTEXT-MAP.md` + 各包 `CONTEXT.md`。

| 规范词 | 含义 | Avoid |
|---|---|---|
| **Point** | 可拜访的圣地取景点 | PilgrimagePoint（旧名）、契约里的 Spot |
| **Bangumi** | 一部动画作品/标题 | Work、用 Anime 指一部片 |
| **Itinerary** | catalog **算出**的有序行程 | 单独 Route |
| **SavedRoute** | 用户**保存**的路线（point_ids + 元数据） | 单独 Route |
| **Session** | 用户与 agent 的对话上下文 | 未限定的 auth session |

**保存语义（LOCKED）：** SavedRoute = point_ids + 元数据；打开可再算 Itinerary。
**代码债：** 契约里或仍见 `Route` / `PilgrimagePoint` / `UserRoute`——先锁语言，改名另 PR。

### 4.1 分层词（LOCKED 方向）

Domain / Application / Adapters / Infrastructure；依赖 adapters → application → domain。

### 4.2 怎么做 DDD（LOCKED — 逐包）

**对：一个包一个包做。** 不是全仓同一天铺空 `domain/`。

| 阶段 | 做什么 | 状态 |
|---|---|---|
| **A. 跨包语言** | CONTEXT-MAP + 共享词 | **已做** |
| **B. 逐包深入** | 一次只做一个 deployable：所有权、不变量、用例、ports、目标内部树 | **进行中** |

**每个包的固定议程：**

1. 拥有 / 不拥有哪些概念
2. 核心不变量与边界场景
3. 入站用例（application）
4. 出站 port
5. 目标内部目录
6. 与 contract 的映射
7. 测试 seam

**推荐顺序：** catalog → agent → users → edge → web → jobs
（contract 不单独「实现 DDD」，只随前几包收紧发布语言。）

**明确不做：** 无场景地给每个包 mkdir 空 domain。

### 4.3 分级默认（可在逐包时推翻）

- **Full**：catalog、agent
- **Gateway**：edge
- **Thin**：users、**jobs**
- **UI**：web features

全局 D1/D3 不再空转：以 **catalog 第一包** 实装选择为准再回写。

### 4.4 逐包进度

| 包 | 状态 |
|---|---|
| catalog | **ACCEPTED** + greenfield 语言/表目标 — [CA](./2026-08-06-catalog-clean-architecture-design.md) · [总表](./2026-08-06-greenfield-language-and-data-plane.md) |
| agent | **ACCEPTED** + greenfield — [CA](./2026-08-06-agent-clean-architecture-design.md) · [总表](./2026-08-06-greenfield-language-and-data-plane.md) |
| users | **ACCEPTED (core BC)** — [CA](./2026-08-06-users-clean-architecture-design.md)（§0.3 大量 OPEN 产品面）· [总表](./2026-08-06-greenfield-language-and-data-plane.md) |
| edge | **ACCEPTED** — [Gateway 结构](./2026-08-06-edge-gateway-structure-design.md) |
| web | **ACCEPTED** — [UI 结构](./2026-08-06-web-ui-structure-design.md)（routes≈pages + features） |
| jobs（原 maintenance） | **ACCEPTED 命名+结构** — [jobs-worker-structure](./2026-08-06-jobs-worker-structure-design.md)；代码仍在 `workers/maintenance` 直至 J1 |

### 4.5 Catalog 摘要

- **拥有 / 语言 / 用例：** `workers/catalog/CONTEXT.md`
- **CA 设计：** `2026-08-06-catalog-clean-architecture-design.md`（ACCEPTED + greenfield）
- **待实现：** 分层目录；G1 去掉 `route` / `PilgrimagePoint` / `work_id`

### 4.6 结构 best practice（LOCKED 默认）

| 规则 | 选择 |
|---|---|
| 统一程度 | **分级**（Full / Gateway / Thin / UI），非全员硬套四层 |
| edge | **无**巡礼 `domain/`；用 identity/gateway/proxy/container |
| ingest 流水线 | **application** |
| domain vs contract | 边界 DTO 可用 contract；包内 domain map 进出 |

---

## 5. 文档变更日志

| 日期 | 变更 |
|---|---|
| 2026-08-06 | 初稿：第一层树 LOCKED |
| 2026-08-06 | domain-modeling：Point / Bangumi / Itinerary / SavedRoute / Session；CONTEXT* 落盘 |
| 2026-08-06 | LOCKED：DDD **逐包**；序 catalog → agent → … |
| 2026-08-06 | ADR-0002 发布语言；catalog 包议程完成；结构 best practice LOCKED |
| 2026-08-06 | Catalog 教科书 CA/DDD **仅设计**文：`2026-08-06-catalog-clean-architecture-design.md` |
| 2026-08-06 | Catalog 设计 **ACCEPTED**；Agent 设计稿 `2026-08-06-agent-clean-architecture-design.md`（待确认） |
| 2026-08-06 | Agent 设计 **ACCEPTED**（A1–A5；§0.1 catalog 只读 / Session 可写） |
| 2026-08-06 | Users 设计稿 `2026-08-06-users-clean-architecture-design.md`（Thin；待确认） |
| 2026-08-06 | **全仓 greenfield** 总表 `2026-08-06-greenfield-language-and-data-plane.md`；ADR-0002 取消 wire 滞后默认 |
| 2026-08-06 | Users **core BC ACCEPTED**；OPEN backlog O1–O12 显式列出 |
| 2026-08-06 | 全仓：重构列车 = 真结构（SOLID/搬家/化简）+ greenfield，不止 rename |
| 2026-08-06 | 三包 structure-refactor 设计 **ACCEPTED**（best practice）；edge/web 未设计 |
| 2026-08-06 | Edge Gateway + Web UI 结构设计稿（无 domain model；一次到位） |
| 2026-08-06 | Edge/Web 结构 **ACCEPTED**；Maintenance Thin 设计稿 |
| 2026-08-06 | **maintenance → workers/jobs**（包名+jobs/ 目录）；scheduler 不作包名 |
| 2026-08-06 | Neon DBA 能力图（缺口 D0–D21；#685 对齐） |
| 2026-08-06 | Neon DBA 图 **ACCEPTED**；CI pipeline 布局明确另议 |
| 2026-08-06 | CI/部署架构方向文：每包线对、实现乱、目标形状（DIRECTION ACCEPTED） |
| 2026-08-06 | CI/CD 重构计划 ACCEPTED design only（C1–C6；Sonar 澄清） |
| 2026-08-06 | Pulumi/infra 设计 **ACCEPTED design only**（边界对；结构/ESC 后置） |
| 2026-08-06 | 骨架重构 GOAL：`docs/iterations/refactor-skeleton-2026-08/GOAL.md` |

---

## 6. 下一步

1. **可部署包结构设计已齐**；索引：[structure-refactor-index](./2026-08-06-structure-refactor-index.md)。
2. **Neon DBA 能力图 ACCEPTED**（best practice）：[neon-dba-capability-map](./2026-08-06-neon-dba-capability-map.md) — 优先 **N1 角色矩阵 + staging DSN**（#685）。
3. **CI/部署**：**方向 + 重构计划均 design ACCEPTED** — [architecture](./2026-08-06-ci-deploy-architecture.md) · [refactor plan C1–C6](./2026-08-06-ci-cd-refactor-plan.md)；**YAML 未改**。
4. **Pulumi/infra**：[pulumi-infra-review](./2026-08-06-pulumi-infra-review.md) **ACCEPTED design only**（P1 拆 index 等后置）。
5. **重构 GOAL（只骨架）：** [docs/iterations/refactor-skeleton-2026-08/GOAL.md](../../iterations/refactor-skeleton-2026-08/GOAL.md) — 无新功能；未做 `TODO(refactor-skeleton)`；Matt `/to-issues`→`/implement`（+/tdd）→`/code-review`。
6. **实现列车**（按 GOAL 出票）：包结构 · jobs rename · DBA 文档骨架 · CI 设计已定实现后置 · 产品 ticket 另线。
