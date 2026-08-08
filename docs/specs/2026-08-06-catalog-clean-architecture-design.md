# Catalog 教科书式 DDD + Clean Architecture 设计

- Status: **ACCEPTED** (owner 2026-08-06) — 目标形态与迁移原则已锁定；**实现另开 PR，本文不代替代码**
- Date: 2026-08-06
- Package: `workers/catalog`
- Language: ADR-0002 · `CONTEXT-MAP.md` · `workers/catalog/CONTEXT.md`
- Parent: `docs/superpowers/specs/2026-08-06-monorepo-target-layout.md`
- Owner acceptance: C1–C6 全部接受（四圈 CA、目标树、ingest=application、P1→P6 分期）
- Greenfield: 见 `2026-08-06-greenfield-language-and-data-plane.md`（**语言/契约/表一次最佳，无兼容层**）
- Refactor train: **已有代码** 真·结构重构（移文件/抽 use case/化简/SOLID），**不止 rename**；未写产品能力归既有 ticket

---

## 0. 目标

把 Catalog 从「能力管道 + 部分纯 kernel + handler 内事务脚本」收成**可教学的**：

1. **DDD**：清晰有界上下文、统一语言、领域不变量在 domain、用例在 application
2. **Clean Architecture**：依赖只指向内圈；框架（Hono/oRPC/Drizzle/Neon/fetch）只在最外圈
3. **可测**：domain 与 application 可在无 workerd、无真实 Neon 下单测
4. **Greenfield 语言**：Point / Bangumi / Itinerary；无 `PilgrimagePoint` / `Route` / `work_id`

**非目标（本文不直接改代码）：**

- 立刻单 PR 完成全部 `git mv` + 全仓契约（实现见 §10 + greenfield G1）
- 保留长期 wire 别名（**已否决**）

---

## 1. 现状诊断（设计基线）

### 1.1 今日目录

```text
workers/catalog/src/
  index.ts          # Hono 入口、DB 池、cron、媒体
  router.ts         # oRPC implement(catalogContract)
  api/*             # 读 API：用例 + SQL 混写
  lib/*             # 混杂：纯 kernel（route/clustering/geo）+ 绑框架工具
  db/               # Neon 客户端
  ingest|enrich|publish|media/  # 数据平台流水线
  types.ts          # contract 的 import type 镜像
```

### 1.2 已有的「正确碎片」

| 碎片 | 评价 |
|---|---|
| 包边界：Agent 只读客户端 | BC 清楚 |
| `packages/contract` + `import type` | 发布语言 / 防腐入口 |
| `lib/route.ts` + clustering **纯函数** | 已是 domain service 候选 |
| `CatalogContext` 注入 db/fetch/waitUntil | 有 port 意识 |
| `api/route` 先 fetch 再 kernel | 接近 application 编排 |

### 1.3 与教科书的差距

| 期望 | 现状 |
|---|---|
| `domain/` 无 I/O | 无此目录；规则散在 SQL 与 api |
| application 不直接写 SQL | 多数 `api/*` 直接 drizzle |
| 依赖单向内指 | handler 同时依赖 Hono 世界、SQL、ingest |
| 统一语言 | 代码仍 `Route` / `PilgrimagePoint` / `work_id` |

**结论：** 有 CA 的 kernel 与契约纪律，**尚未**教科书分层。

---

## 2. 领域模型（Catalog BC）

### 2.1 统一语言（LOCKED）

| 词 | 含义 |
|---|---|
| **Point** | 可拜访圣地取景点 |
| **Bangumi** | 一部动画作品/标题 |
| **Itinerary** | 算出的有序行程 |
| **Cluster** | 共址点合并为一站 |
| **Origin / Pacing** | 规划起点与疏密 |
| **Alias** | 查询串 → Bangumi 的归一化键 |

**不拥有：** SavedRoute、Session、登录身份、Edge 限流。

### 2.2 核心不变量

1. Point 必属一个 Bangumi。
2. Itinerary 由 Point 选择生成；空选择无有效行程。
3. 规划可对共址 Point 做 Cluster，且有上限。
4. Search 可返回 **partial** 预览行；调用方不得当最终全集。
5. Catalog 不持久化用户 SavedRoute。

### 2.3 上下文关系

```text
Agent ──read──▶ Catalog ──SQL──▶ Neon
Web/Edge ──/v1/catalog*──▶ Catalog
Users ──仅 point_ids 引用──▶（不写 Catalog 表）
Ingest upstream (Anitabi 等) ◀── Catalog outbound
```

---

## 3. Clean Architecture 圈层

```text
                    ┌─────────────────────────────┐
                    │  Frameworks & Drivers         │
                    │  Hono · oRPC · wrangler · R2  │
                    │  Neon HTTP · fetch · cron     │
                    └────────────▲────────────────┘
                                 │ implements
                    ┌────────────┴────────────────┐
                    │  Interface Adapters           │
                    │  inbound: router, api handlers│
                    │  outbound: db/*, upstream/*   │
                    │  DTO map ↔ contract types     │
                    └────────────▲────────────────┘
                                 │ calls
                    ┌────────────┴────────────────┐
                    │  Application (use cases)      │
                    │  SearchPoints, ResolveBangumi │
                    │  PlanItinerary, IngestBangumi │
                    │  ports: PointsRepo, …         │
                    └────────────▲────────────────┘
                                 │ uses
                    ┌────────────┴────────────────┐
                    │  Domain                       │
                    │  Point, Bangumi, Cluster      │
                    │  planItinerary pure rules     │
                    │  不变量；无 I/O               │
                    └─────────────────────────────┘
```

**依赖规则（硬）：**

- Domain **不得** import：hono、@orpc、drizzle、@neondatabase、cloudflare:、ingest 编排
- Application **不得** import：hono、drizzle 实现细节；只依赖 **port 接口** 与 domain
- Adapters 可以实现 port、调用 application、接触框架
- `types.ts` / contract：**仅适配器边界**做 wire 形状；domain 用自己的类型或从 port 返回的已映射结构

---

## 4. 目标目录树（教科书形态）

```text
workers/catalog/
  CONTEXT.md                 # 语言与所有权（已有，随设计加厚）
  AGENTS.md                  # 命令与陷阱（实现期更新路径）
  src/
    domain/
      README.md              # 本层规则（可选）
      model/
        point.ts             # Point 相关纯类型/工厂/守卫
        bangumi.ts
        cluster.ts           # Cluster 类型 + clusterByLocation
      itinerary/
        plan.ts              # 今 lib/route.ts 纯规划
        pacing.ts            # 若拆常量
      geo/
        haversine.ts         # 今 lib/geo.ts
      errors.ts              # 领域错误（非 ORPCError）
    application/
      ports.ts               # PointsRepo, BangumiRepo, UpstreamPreview, Clock, …
      search-points.ts
      resolve-bangumi.ts
      list-points-for-bangumi.ts
      get-point.ts           # spots
      nearby-points.ts
      geocode-place.ts
      plan-itinerary.ts      # 内存点集 → Itinerary + 装配策略
      anime-overview.ts
      ingest-bangumi.ts      # 编排 ingest（调用 outbound）
    adapters/
      inbound/
        http/
          app.ts             # 今 index 的 Hono 应用
          router.ts          # oRPC
          handlers/          # 薄：parse → app use case → map error
        cron/
          seed-and-ttl.ts
      outbound/
        neon/
          client.ts
          points-repo.ts
          …
        upstream/
          anitabi.ts
          bangumi-api.ts
        r2/
          media.ts
    # 过渡：流水线可先挂 application 下或 adapters 旁
    processes/
      ingest/                # 今 ingest/（实现期迁入 application 或 adapters）
      enrich/
      publish/
    config/
      cron.ts
  test/
    domain/                  # 纯单测（可不进 workerd）
    application/             # port fake
    adapters/                # worker / spike 测
```

**命名说明（Greenfield）：**

- 对外 oRPC：**`planItinerary`** / path **`/catalog/itinerary`**（不再保留 `route` 兼容名）。
- Wire 类型：**`Point`**、**`Itinerary`**；输入键 **`bangumi_id`** 而非 `work_id`。
- 文件：`lib/route.ts` → `domain/itinerary/plan.ts`。

### 4.1 数据面（Catalog 表目标）

| 表 | 目标 |
|---|---|
| `bangumi`, `points` | 保留；列语言已对齐 |
| `aliases`, `series_edges`, `cluster_version` | 列 **`work_id` → `bangumi_id`** |
| `route_snapshots` | **`itinerary_snapshots`** + `bangumi_id` |
| 用户域 `routes` | **不属 Catalog** → Users `saved_routes` |

细节总表：greenfield 文档 §3.1。

---

## 5. 端口（Application 出站接口）设计

以下为**接口职责**，非代码。

| Port | 职责 |
|---|---|
| **PointsRepo** | 按 id 列表取 Point（保序）；按 bangumi 列表；nearby 查询 |
| **BangumiRepo** | 解析/读取 Bangumi 元数据 |
| **AliasIndex** | normalize + 精确命中 alias → bangumi id |
| **UpstreamCatalog** | Anitabi lite / full、必要时 Bangumi 搜索（ingest/search miss） |
| **IngestQueue / UnitOfWork** | 后台 full ingest（waitUntil 的抽象） |
| **GazetteerRepo** | geocode 候选 |
| **MediaStore** | R2 图（若仍属 catalog） |
| **Clock** | 测 TTL/cron 用 |

**原则：** 一个 use case 只依赖它需要的 port，避免上帝 `CatalogDb`。

---

## 6. 用例切分（Application）

| Use case | 输入（概念） | 输出（概念） | 主要 port |
|---|---|---|---|
| SearchPoints | query, Origin? | Point[] + partial? + synced_at | AliasIndex, PointsRepo, Upstream, Ingest |
| ResolveBangumi | query | 身份结果 | BangumiRepo / Upstream |
| ListPointsForBangumi | bangumi id | Point[] | PointsRepo, 可触发 ingest |
| GetPoint | bangumi_id + Origin? | Point + distance? | PointsRepo |
| NearbyPoints | lat,lng,radius | Point[] | PointsRepo |
| GeocodePlace | query, limit | candidates | GazetteerRepo |
| PlanItinerary | point ids, Origin?, Pacing? | Itinerary + ordered Points meta | PointsRepo + **domain itinerary** |
| AnimeOverview | bangumi 相关 | 公开聚合 | PointsRepo / 只读投影 |
| IngestBangumi | bangumi id | 任务结果 | Upstream + write side of repos |

**PlanItinerary 分层示例（逻辑，非实现）：**

1. Adapter：HTTP/oRPC → 校验 wire 输入
2. Application：PointsRepo.loadByIds → domain.cluster → domain.planTimedItinerary → 装配公开结果
3. Domain：clusterByLocation、buildTimedItinerary — **零 I/O**

Search 必须把「别名命中 / lite 预览 / 后台 ingest」收成 application 策略，而不是单文件事务脚本（设计要求；实现分期）。

---

## 7. 数据平台（Ingest → Enrich → Publish）

| 阶段 | 圈层 | 说明 |
|---|---|---|
| Ingest | application 编排 + outbound upstream/db | 拉外部、落原始/工作表 |
| Enrich | application / domain 规则 | 去重、聚类、城市回填 — **可测纯规则进 domain** |
| Publish | application + outbound | 发布为可读 Point/Alias 投影 |

这些是 **application 过程名**，不是粉丝域名词（见 CONTEXT）。

---

## 8. 测试策略（设计）

| 层 | 测什么 | 运行时 |
|---|---|---|
| domain | 聚类、行程、haversine、不变量 | Node 纯测，快 |
| application | 用例 + in-memory ports | Node |
| adapters inbound | oRPC 映射、错误码 | workerd pool（现有） |
| adapters outbound | SQL/geo 真或 spike | worker/spike 现有分工 |
| startup smoke | bundle 可启动 | 保留 |

**回归纪律：** 分层 PR 保持规划语义；**greenfield 改名可与 G1 同波破坏性落地**（无用户）。

---

## 9. 与现状映射（迁移地图）

| 今日 | 目标 |
|---|---|
| `lib/route.ts` | `domain/itinerary/plan.ts` |
| `lib/clustering.ts` | `domain/model/cluster.ts`（或 domain/clustering） |
| `lib/geo.ts` | `domain/geo/haversine.ts` |
| `api/route.ts` 纯编排部分 | `application/plan-itinerary.ts` |
| `api/route.ts` SQL | `adapters/outbound/neon/points-repo.ts` |
| `api/route.ts` oRPC 入口 | `adapters/inbound/http/handlers/plan-itinerary.ts` |
| `route` contract / path | **`itinerary`** |
| `PilgrimagePoint` / `work_id` | **`Point` / `bangumi_id`** |
| `route_snapshots` / 列 `work_id` | **`itinerary_snapshots` / `bangumi_id`** |
| `api/search.ts` 等 | 同上模式拆 application + outbound |
| `router.ts` / `index.ts` | `adapters/inbound/http/` |
| `db/*` | `adapters/outbound/neon/` |
| `ingest|enrich|publish` | `processes/*` 或 application 子包 |
| `lib/errors.ts` 的 ORPCError | 留在 inbound adapter；domain 用领域错误再 map |

**迁移策略（Greenfield）：**

- **无**长期 `PilgrimagePoint` 别名 export。
- 可选短期 `lib/foo.ts` re-export **仅**为拆 PR 方便，合并前删掉。
- 禁止 domain import api。

---

## 10. 分阶段实施顺序（仅计划，不执行）

| 阶段 | 内容 | 完成判据 |
|---|---|---|
| **P0 设计** | 本文 + CONTEXT + greenfield 总表 | ACCEPTED |
| **P1 语言+数据面** | contract Itinerary/Point；DB `work_id`/`route_snapshots` 改名；path `/catalog/itinerary` | 全仓编译 + catalog 测绿（可并入仓级 G1） |
| **P2 Itinerary 竖切** | domain 规划 + application PlanItinerary + handler 变薄 | itinerary/clustering 测绿 |
| **P3 Search 竖切** | SearchPoints use case + ports | search 测绿 |
| **P4 读模型其余** | nearby/geocode/point/overview 同构 | 读路径无新增「api 内业务规则」 |
| **P5 流水线归位** | ingest/enrich/publish → application/processes | cron/ingest 测绿 |
| **P6 目录收敛** | 去掉过时 lib、inbound 最终化 | AGENTS 路径更新 |

每阶段 **一个可审查 PR** 优先；**P1 允许跨包大 PR**（greenfield）。

### 10.1 重构列车里 Catalog **做什么 / 不做什么**

| 做（已有 `workers/catalog` 码） | 不做（留给 ticket） |
|---|---|
| 按 §4 树 **移动** `api/*` / `lib/*` → domain/application/adapters | 新建尚未存在的公共 API 产品面 |
| 抽 **PlanItinerary / Search** 等 **已有路径** 的 use case + port | OSRM/铁道拓扑层2（#292 等）首次实现 |
| 化简 handler 事务脚本；纯 kernel 进 domain；去掉错误抽象 | 质量门/SEO 新管线（#285 等）若未写则不借 P 阶段偷渡 |
| greenfield 改名与路径 | ingest 内部入口形态若已有票（#540/#555）则按票改，不另开宇宙 |

**抽象：** 依赖倒置用 **窄 port**；禁止 God `CatalogDb`；1-10-50 与 SOLID 约束已有文件拆分。

---

## 11. 风险与非目标

| 风险 | 缓解 |
|---|---|
| 大挪目录 CI 路径钉死 | 先 re-export；CI pin 改目录 seam（monorepo 文档） |
| workerd + 路径别名 | 与现有 vitest 配置一致，避免花式 paths 直至证明需要 |
| 过度设计 Thin 路径 | GetPoint 等保持 Thin application，不造空 domain 实体 |
| 与 Agent Python 镜像类型漂移 | contract 仍为 SoT；domain 映射在边界测 parity |

---

## 12. 验收（设计完成 / 实现完成）

**设计完成（本文）：**

- [x] 圈层、依赖规则、目标树、端口、用例、迁移地图、分期
- [x] Owner 标记本文 Status → **ACCEPTED** (2026-08-06)
- [x] Greenfield 语言/表目标并入（2026-08-06）


**实现完成（未来）：**

- [ ] domain 无框架 import（可用 lint/边界测试约束）
- [ ] PlanItinerary / Search 主路径符合分层
- [ ] 测试分层存在且主测绿
- [ ] AGENTS.md 描述与树一致

---

## 13. 相关文档

| 文档 | 角色 |
|---|---|
| `workers/catalog/CONTEXT.md` | 语言与所有权 |
| `docs/adr/0002-published-language-…md` | 跨服务词 |
| `docs/superpowers/specs/2026-08-06-monorepo-target-layout.md` | 仓级目标与逐包进度 |
| `workers/catalog/AGENTS.md` | 现行命令与陷阱（实现后改） |

---

## 14. 变更日志

| 日期 | 变更 |
|---|---|
| 2026-08-06 | 初稿：教科书 DDD+CA 目标、圈层、目录、端口、用例、分期；**明确 DESIGN ONLY** |
| 2026-08-06 | Owner 全盘接受 C1–C6 → Status **ACCEPTED** |
| 2026-08-06 | §10.1：重构 = 已有码搬家/抽用例/化简/SOLID，不止 rename；未写能力归 ticket |
