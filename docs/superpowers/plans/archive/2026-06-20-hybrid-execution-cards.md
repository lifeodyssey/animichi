# 混合架构执行蓝图 · 卡/波次图(并行 sub-agent 执行)

> 来源:并行设计 workflow(2026-06-20)。架构:**Catalog 服务(CF Workers/TS)+ Agent 服务(Python)**,契约 oRPC,DB-per-service。
> 执行:每张卡 = 一个 executor sub-agent;同波内并行,跨波串行(merge→rebase)。每卡 reviewer,每波 tester。

## 仓库结构(monorepo,单 Supabase Postgres,DB-per-service)
```
seichijunrei/
├── catalog/            NEW  TS Catalog 服务(CF Workers,Hono+oRPC+Drizzle+Hyperdrive)
│   └── src/{router,pipelines,lib,types}/  search/spots/routes/bundle · ingest/enrich/publish/media · clustering/geo/alias/series/leg-cache/db/r2
├── backend/            EXISTING  Python Agent(PydanticAI),现为 Catalog 客户端
│   └── clients/catalog_client.py  NEW oRPC 客户端
├── packages/contract/  NEW  oRPC schema → TS 类型 + OpenAPI(单一真理源)
├── supabase/migrations/  Wave-1 catalog DDL 已在 + service-roles
└── worker/entry.js  wrangler.toml  .github/workflows/deploy.yml
```
**边界铁律**:Agent 只经 `catalog_client`→oRPC 取 catalog;Agent 拥 `sessions/conversation_messages/user_memory`,Catalog 拥 `bangumi/points/cluster_version/route_snapshots/aliases/series_edges/leg_cache/raw_*/media_assets/ingest_jobs`。

## 卡/波次图(TS=Catalog,Py=Agent,X=跨切;[]=测试类型)

**WAVE 0 — Scaffold + 契约(前置,并行)**
- W0-1 契约包(X):oRPC 4 方法 + 共享模型(PilgrimagePoint/TimedItinerary/Stop/TransitLeg)→ TS 类型+OpenAPI。deps:—
- W0-2 Catalog 骨架(TS):Hono+oRPC app + vitest-pool-workers + 4 RPC stub。deps:W0-1
- W0-3 Py catalog 客户端(Py):catalog_client.py(httpx/oRPC)+ 熔断/重试 + 契约类型。deps:W0-1
- W0-4 服务角色+仓库结构(X):service_roles.sql(catalog_svc/agent_svc grant)+ 建 catalog//packages/。deps:—
- W0-5 Auth 转发(X,**worker/entry.js 非前端**):jose JWKS→X-User-*,Agent 信任头。deps:—

**WAVE 1 — Spike + 数据层 + Agent 基础**
- **W1-SPK 栈 spike(TS,闸)**:验 Hyperdrive+PostGIS ST_DWithin / Drizzle s`` 组合 / vitest-pool-workers 池化 / satori 128MB → go/no-go。**闸住所有 W2/W3 TS**。
- W1-1 Drizzle 只读 schema(TS) / W1-2 聚类 port(union-find+haversine←route_optimizer/geo_utils)/ W1-3 geo helpers / W1-4 alias 归一(NFKC+4源)/ W1-5 series walker / W1-6 ingest(anitabi/bangumi→raw_*/ingest_jobs,singleflight+负缓存)。
- W1-A0 Agent 基础(Py,carryover:5 typed outputs + _DataCoercionMixin)/ W1-A1 guardrails(carryover)/ W1-A2 eval fixture(617 vs mock 客户端)。

**WAVE 2 — Kernels→Routes + 工具/持久化(spike-go 后)**
- W2-1 timed-itinerary port / W2-2 catalog.search / W2-3 spots / W2-4 nearby(ST_DWithin)/ W2-5 route(→TimedItinerary,leg_cache)。
- W2-A1 7 工具 handlers(→catalog_client)/ W2-A2 域模型(Session/Message/UserMemory)/ W2-A3 operational repos。

**WAVE 3 — API+publish+media+E2E**
- W3-1 publish+GC(原子 is_current+snapshots+Cron)/ W3-2 enrich queue(Queues fan-out)/ W3-3 media+satori OG(R2)。
- W3-A1 chat+SSE+sessions+/healthz+app factory(Py)。
- W3-X 路由+cron+E2E(worker/entry.js:/v1→Agent,/catalog/rpc→Catalog,/*→Next)+ 全链 E2E + tag-deploy。

## 关键路径 / 风险
最长链:W0-1→W0-2→**W1-SPK**→W1-2→W2-1→W2-5→W3-1→W3-X(Py 侧镜像 W0-3→W1-A0→W2-A1→W3-A1→W3-X)。
**spike-before-fanout**:Hyperdrive+PostGIS 延迟 / Drizzle 裸 sql 组合 / vitest-pool-workers 池化 / satori 128MB。次:Queues 并发顺序、双镜像冷启动。

## Carryover(不重建)
- SQL:`20260620230000_ingest_infrastructure.sql` + operational 迁移 → 复用;仅加 service_roles.sql。
- Python 原样:PydanticAI agent+prompts、_DataCoercionMixin、output_validator、guardrails、历史压缩。
- Py→TS port:route_optimizer.py(union-find 50m/最近邻/计时/15km series)、geo_utils.py(haversine)、route_area_splitter.py;clients/{bangumi,anitabi,retry,cache_mixin}.py 的重试/缓存逻辑。

## 并行 dispatch 序列
- **Wave 0**:并行 [W0-1, W0-4, W0-5];W0-1 落地后 [W0-2, W0-3]。merge→rebase。
- **Wave 1**:并行 [W1-A0, W1-A2](Py,无 spike 依赖)+ [W1-1, W1-SPK](TS)。W1-1 落地 fan-out [W1-2..6];W1-A0 落地加 [W1-A1]。**Wave-2 TS 卡 hold 到 W1-SPK go**。
- **Wave 2**:spike-go 后并行 TS [W2-1..4],W2-5 随 W2-1;Py [W2-A1, W2-A2] 后 [W2-A3]。
- **Wave 3**:并行 [W3-1, W3-2, W3-3]+[W3-A1];最后 W3-X + Tester E2E + tag-deploy。
