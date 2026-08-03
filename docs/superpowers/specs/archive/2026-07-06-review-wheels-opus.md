# 轮子审查报告(第一轮 · opus)——重复造轮子 + 跨 worktree 漂移

> 只读审查,HEAD c14279d 时点。第二轮(fable)对照本文输出 confirm/dispute/new。
> ⚠️ Coordinator 裁决备注:A2 与 SD-1 冲突已裁——schema.ts 是 SD-1 迁移链(atlas-provider-drizzle)的期望态真相,**不可删**;仅运行时查询路径可去 drizzle。本报告 A2 按此修正解读。

已装依赖基准:
- Python(apps/agent/pyproject.toml):pydantic-ai≥1.99、pydantic≥2.12、httpx≥0.28、aiohttp≥3.14、asyncpg、reverse-geocoder、ddgs、structlog、logfire。未装 tenacity / cachetools(直接)/ sse-starlette。
- TS(workers/catalog):@neondatabase/serverless、drizzle-orm、hono、@orpc/server、@orpc/openapi;契约侧 @orpc/contract、@orpc/zod、zod。
- PostGIS 已在用(workers/catalog/src/lib/geo-query.ts:ST_DWithin/ST_Distance(geography))。

## A. 轮子清单

### Quick-win
| # | 现状 | 库方案 | 删行 | 风险 | 判定 |
|---|---|---|---|---|---|
| A1 | apps/agent/agent/services/retry.py 的 retry_async 装饰器+RetryConfig 等 ~150 行,**生产零引用**(仅 services/__init__ 导出+测试;clients/base.py:170 只用同文件 RateLimiter) | 直接删死代码(将来真需要再用 tenacity) | ~150 | 无 | quick-win |
| A2 | workers/catalog drizzle-orm:13 文件 import 但**只用 sql 模板标签**,查询构建器零使用(nearby.ts:46 注释自陈 workerd 下挂死);geo-query.ts 已直接用 neon() 标签 | 运行时查询全面 neon() 标签化 | ~110(查询侧) | 中 | quick-win/story 边界;**schema.ts+atlas 链保留(SD-1)** |

### Story 级
| # | 现状 | 库方案 | 删行 | 风险 | 判定 |
|---|---|---|---|---|---|
| A3 | 地理聚类双侧手写 union-find:Python route_optimizer.py:34-114(~80 行 O(n²))+ TS clustering.ts(整文件 151 行);TS 侧 api/route.ts:72-73 先 SELECT 再 JS 内聚类——数据本就来自 PostGIS | ST_ClusterDBSCAN(location, eps:=50, minpoints:=1) 在 SELECT 内直接分组;center=AVG,clusterId=MIN(id) GROUP BY | TS~150+Py~80 | 中(DBSCAN eps/minpoints=1 语义=50m 传递闭包,与 union-find 等价;需 clustering.worker.test.ts 回归浮点 parity [unverified]) | story(TS go-forward 侧优先) |
| A4 | apps/agent/agent/interfaces/routes/runtime.py:53-130 手写 SSE(asyncio.Queue+手拼 event:/data: 分帧 ~90 行);同 repo chat.py:18,164 已用 pydantic-ai 原生 VercelAIAdapter.dispatch_request | runtime.py 走同一 VercelAIAdapter,或至少 sse-starlette EventSourceResponse | ~60-90 | 中(两端点契约不同,需确认前端消费方) | story(SD-9 已定退役此路径,与决策一致) |
| A5 | apps/agent/agent/services/cache.py 338 行(TTL+LRU+清理循环+stats+装饰器) | cachetools.TTLCache/LRUCache 或 aiocache | ~150 | 中(现实现 async+单飞友好;cachetools 非 async;收益不足 3× 门槛) | 偏不换 |

### 不换有理
| 项 | 证据 | 理由 |
|---|---|---|
| 流式主路径 | chat.py 用 VercelAIAdapter | 已用框架 ✅ |
| 会话压缩滑窗 | pilgrimage_agent.py:241,286 ProcessHistory(_sliding_window) | 域逻辑插在 pydantic-ai 原生 history-processor 钩子上,正确扩展点 ✅ |
| haversine | geo_utils.py:13-22 / geo.ts:19-33(各 ~10 行) | 内存中 NN 排序用;换 ST_Distance 反引 DB 往返 |
| 贪心 NN 排序 | route_optimizer.py:120-180 / route.ts:107-122 | 无轻量现成库;TSP solver 过度工程 |
| CatalogClient(Python) | clients/catalog_client.py | oRPC 无 Python 客户端,跨语言只能手写 httpx |
| seichijunrei_client.py | 166 行 httpx 薄封装 | 面向外部的公共 SDK,打 public runtime API |
| reverse-geocoder / ddgs | geo_names.py、web_tools.py:43 | 正确用库 ✅ |

## B. 跨 worktree 漂移(backend/ 旧 ↔ apps/agent/agent/ 新)

| 文件 | 漂移 | 权威 | 处置 |
|---|---|---|---|
| services/retry.py | 188 行(worktree 抽函数+noqa S311) | worktree | 旧侧遗留 |
| clients/base.py | Enum→StrEnum | worktree | 旧侧遗留 |
| agents/route_optimizer.py / services/cache.py / agents/geo_utils.py / clients/retry.py | 仅 import 改名 | worktree | 纯迁移副本 |
| clients/catalog_client.py | 仅 worktree | worktree | 新增 |
| clients/python/seichijunrei_client.py | 域名 .dev(main repo)↔ .org(worktree) | **⚠️ 实测 .org 301→.dev,生产真值=.dev;worktree 为错误漂移**(Coordinator 已核,R1 修) | 改回 .dev |

结论:漂移方向全部一致(worktree 新),主 repo backend/ = 迁移遗留整体待删;**无"只改旧侧"的危险反向漂移**。

## C. Top 3(删除行数 × 低风险)

1. A1 删 retry.py 死代码(~150 行,零风险)
2. A3 聚类改 ST_ClusterDBSCAN(~230 行,中风险,TS 侧先)
3. A2 运行时查询去 drizzle(~110 行,中风险;schema.ts 保留=SD-1)

## D. 已装未用/低引用盘点

| 依赖/能力 | 状态 | 建议 |
|---|---|---|
| drizzle-orm 查询构建器 | workerd 下挂死,仅 sql 标签在用 | 见 A2(schema 保留) |
| retry.py 装饰器机制 | 生产零引用 | 删(A1) |
| @orpc/zod(契约侧) | Worker router 用 type<T>() passthrough 绕开 zod(router.ts:27,减 bundle) | 合理,但 router 输入类型靠手工 lockstep=漂移风险,非死代码 |
| pg + @types/pg(devDeps) | 运行时用 @neondatabase/serverless | 确认仅 vitest 用否则清 |
| 契约类型三重定义 | zod(contract)+TS 镜像(types.ts)+pydantic 手工(catalog_client.py:46-86);contract 已 emit openapi.json | Python 侧可 datamodel-code-generator codegen 消手工;story 级低优先 |
