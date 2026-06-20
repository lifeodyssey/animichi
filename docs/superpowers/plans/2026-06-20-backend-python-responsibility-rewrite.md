# 后端 Python 原地重写实施计划 · 新职责架构(不切 TS)

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development 或 superpowers:executing-plans 逐任务执行。步骤用 `- [ ]` 跟踪。
> **altitude 说明:** 栈不变(FastAPI/asyncpg/PydanticAI),无 spike 前置,本计划到任务级(file:line + DDL + 接口签名 + AC→测试)。具体 handler 改写代码由执行期 TDD 驱动(需读当时源码),计划不预写整段实现以免与真实源码漂移。

**Goal:** 在 Python 里把后端重写成 ADR 决策一的新职责架构:agent/API 只读服务表,一切写入经摄入管线;加版本绑定 / singleflight / LLM 闸。

**Architecture:** Catalog 从 agent 拆出为独立 Python 摄入管线(Ingest→Enrich→Publish);agent 工具退化为服务表只读消费者;app DB 角色 SELECT-only;版本指针保证旧路线不漂移。

**Tech Stack:** Python · FastAPI · asyncpg(留)· PydanticAI(留)· PostGIS · Supabase migrations · pytest · Logfire。

## Global Constraints

- 两条纪律:agent/API 永远只读服务表;一切写入必经管线(无"顺手 insert")— ADR §2 决策一
- 不换语言/运行时:FastAPI/asyncpg/PydanticAI/内存 cache 全部保留;**决策二 TS on Workers 本次不动**
- parity gate:重写后 617 eval JSON 跑分不达重写前 baseline 不合并 — ADR §3
- 版本绑定:cluster_version + route_snapshots,重聚类后旧路线/しおり/分享页不漂移
- singleflight:ingest_jobs(work_id) 唯一约束;负缓存防分享爆火击穿 Anitabi
- LLM 闸:per-session token 预算 + 工具调用上限 + 超限降级普通搜索
- 预收录 10-20 作品,不押实时首次收录;新鲜度靠 per-work TTL + SWR
- 测试:pytest(--asyncio-mode=auto),后端覆盖率 ≥80%(只升不降);§3 热点逐条对应测试
- 文件:单一职责,拆开 public_api(479)/session_facade(463) 的混合关注点

---

## Wave 0 · baseline 固化(重写前的安全网)

- [ ] 跑全量 eval 记录重写前 baseline 分数(IntentMatch/ResponseLocale 等),写入 plan 旁注作 parity 阈值
- [ ] 跑 `make test` 记录绿基线;`make typecheck` / `make lint` 绿
- **Gate:** baseline 落档,后续每波 eval 不得低于此线

## Wave 1 · 数据表 + singleflight + 版本指针(地基)

**Files:**
- Create: `supabase/migrations/<ts>_responsibility_arch.sql`
- Modify: `backend/infrastructure/supabase/` 查询层(只读约束)

**DDL(本计划可精确给出):**
- `ingest_jobs(work_id text, status text, started_at, finished_at, error text, UNIQUE(work_id))` — singleflight + 负缓存
- `cluster_version(id serial pk, work_id, version int, created_at, is_current bool)` — 版本指针
- `route_snapshots(id, work_id, cluster_version int, payload jsonb, created_at)` — 路线绑版本
- raw zone:`bangumi_raw(work_id, payload jsonb, fetched_at)` / `points_raw(...)`
- app DB 角色 `GRANT SELECT` only(写入由管线用 service 角色)

**验收项:**
- AC1 `ingest_jobs(work_id)` 唯一约束:并发两次同 work_id 仅一条 running — integration
- AC2 版本指针切换原子:切 is_current 后旧 route_snapshot 查询结果不变 — integration
- AC3 app 角色对服务表写入被拒(SELECT-only 结构性保证)— integration
- AC4 负缓存:不存在 work_id 摄入失败写 ingest_jobs.error,二次请求读缓存不打 Anitabi — integration

## Wave 2 · Catalog 拆出 = 摄入管线(本次核心)

**Files:**
- Create: `backend/catalog/ingest.py`(Ingest:Anitabi/Bangumi 拉取 → raw JSONB)
- Create: `backend/catalog/enrich.py`(Enrich:聚类预计算/别名/城市回填/署名;**复用** route_optimizer union-find :34-114)
- Create: `backend/catalog/publish.py`(Publish:写服务表 + 建 cluster_version)
- Create: `backend/catalog/cli.py`(预收录 10-20 作品的批量摄入入口)
- Modify: `backend/agents/handlers/resolve_anime.py` — **删请求期 Bangumi API 回退 + 写穿**,改只读服务表
- Modify: `backend/agents/pilgrimage_tools.py:170-280`(search_bangumi/resolve_anime)— 改只读
- Modify: `backend/clients/anitabi.py` / bangumi — 调用方从 agent 移到 catalog(client 本身留用)

**Interfaces:**
- Produces: `ingest_work(work_id) -> IngestResult`;`enrich_work(work_id)`;`publish_work(work_id) -> cluster_version`
- Consumes(agent 侧):仅 `backend/infrastructure/supabase` 只读查询

**验收项:**
- AC5 摄入管线:CLI 摄入一个作品 → 服务表出现点 + cluster_version — integration
- AC6 **agent 工具不再有任何写操作 / 外部 API 调用**(断言 mock 的 Anitabi/Bangumi client 在 agent run 期零调用)— unit
- AC7 search_bangumi 只读服务表返回点,与重写前同输入同输出对拍 — integration
- AC8 未预收录作品:工具查空 → 返回明确降级(提示/退普通搜索),不报错 — eval
- AC9 Enrich 聚类结果与旧 route_optimizer 逐点一致 — unit(对拍)

## Wave 3 · LLM 闸 + 编排清理

**Files:**
- Modify: `backend/agents/pilgrimage_runner.py` — 加 per-session token 预算 + 工具调用上限 + 降级
- Modify: `backend/interfaces/public_api.py`(479)— 拆 `RuntimeAPI.handle()`(105 行)按职责分方法/模块
- Modify: `backend/interfaces/session_facade.py`(463)— 拆 context 构建 / 状态更新 / 压缩
- Modify: `backend/interfaces/persistence.py` — 丢数据的静默吞错改显式处理

**验收项:**
- AC10 LLM 闸:超 per-session token 预算或工具调用上限 → 降级普通搜索,不无限循环 — integration
- AC11 编排拆分后:greet_user 早退(session_id=None 不持久化)行为不变 — unit
- AC12 clarify 强制不变:调过 clarify 后必返回 clarify_response 并停止 — eval
- AC13 message_history 反序列化时序不变(load 后 / agent 前)— unit
- AC14 错误码→HTTP 映射全覆盖(400/401/429/504/500)— unit
- **AC15 parity gate:617 eval 跑分 ≥ Wave 0 baseline** — eval

## 跨波次 · 保留项验证

- output_validator / ModelRetry 守卫 / 历史语义压缩 / 系列启发式(§3.A 1-5):重写后回归测试全绿
- Logfire 观测:重写后 span 仍捕获 LLM token,dashboard 连续
- 内存 cache/retry:留用,不改

---

## Self-Review(对 ADR 决策一 + 迁移地图覆盖)

- ADR 决策一 两条纪律(只读 + 写经管线):Wave 1 AC3 + Wave 2 AC6 ✓
- Catalog 拆出:Wave 2 ✓ / 三段管线:Wave 2 ingest/enrich/publish ✓
- 版本绑定:AC2 ✓ / singleflight + 负缓存:AC1, AC4 ✓ / LLM 闸:AC10 ✓
- 预收录不押实时首收:AC8 ✓ / app SELECT-only:AC3 ✓
- 迁移地图 §3 热点 14 条:§3.A→AC11-13+跨波次、§3.B→AC11-14、§3.C→AC8 ✓
- parity baseline:Wave 0 + AC15 ✓
- 决策二(TS on Workers):**明确不在本计划**,保留在 ADR 作后续 ✓
- 缺口:具体 handler 改写整段代码 = 执行期 TDD 驱动(需读当时源码),计划不预写 — 见 altitude 说明
