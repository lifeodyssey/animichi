# 后端重写实施计划 · Walk 子集(Python → TS on Workers)

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development 或 superpowers:executing-plans 逐任务执行。步骤用 `- [ ]` 跟踪。
> **altitude 说明:** 本计划为**结构级路线图**(模块/文件结构 + 波次任务边界 + 验收项)。代码级逐步细化**待 Wave 0 spike 转正后**逐波次补——因为整套栈是 spike-gated(ADR §7),提前写依赖未验证 API 的完整代码会过时。用户已指示 TS 重写代码本身暂缓。

**Goal:** 按 ADR(C2-S)把后端 Walk 子集重写为 TS,直跑 CF Workers;agent/API 只读服务表,一切写入经数据管线。

**Architecture:** 三段数据平台(Ingest→Enrich→Publish)+ 4 只读 API(Hono+oRPC)+ 窄入口 agent(AI SDK v5,失败退普通搜索)。Supabase(PG+PostGIS+GoTrue)留任;Hyperdrive 直连;版本绑定保证旧路线永不漂移。

**Tech Stack:** Hono · oRPC · Drizzle(只查询)+ Hyperdrive · jose JWKS · AI SDK v5 + Zod + @ai-sdk/deepseek · Workflows/Queues/Cron · Evalite · @pydantic/logfire-cf-workers · pnpm workspaces。

## Global Constraints

- 两条纪律:agent/API 永远只读服务表;一切写入必经管线(无"顺手 insert")— ADR §2 决策一
- parity gate:TS agent 不达 Python eval baseline(617 JSON)不切流 — ADR §3
- 版本绑定:cluster_version + route_snapshots,重聚类后旧路线/しおり/分享页不漂移 — ADR §2.2
- singleflight:ingest_jobs(work_id) 唯一约束,分享爆火不击穿 Anitabi — ADR §2.3
- LLM 闸:per-session token 预算 + 工具调用上限 + 超限降级普通搜索 — ADR §2.4
- DB 访问:Drizzle 只查询;写入经 migrations;PostGIS 走 `sql` tagged template;Hyperdrive 连 5432 勿叠 Supavisor — ADR §7
- 测试:vitest-pool-workers;每个验收项标注 test 类型(unit|integration|eval)
- 文件:模块单一职责,避免巨型文件(旧后端 public_api 479 / session_facade 463 的教训)

---

## Wave 0 · Spike 风险验证(前置闸,当前用户已暂缓 — 转正条件)

> ADR §7 的 7 项;全过才转正后续波次的代码级细化。本波是"剩下的都做"被暂缓的那部分,列此为路线完整性。

- [ ] S1 repairToolCall 在 DeepSeek+Workers 是否触发 bug #8240
- [ ] S2 Workers SSE → useChat 工具步骤逐帧可见(R2 命门)
- [ ] S3 自定义 transport 带 Bearer token 过 jose 验签
- [ ] S4 10 轮对话 + prepareStep 压缩后工具链上下文不丢
- [ ] S5 deepseek-chat 七工具多步顺序稳定(防无限循环)
- [ ] S6 AI SDK 在 vitest-pool-workers 跑得动(node 兼容 flag)
- [ ] S7 logfire-cf-workers 捕获 experimental_telemetry spans
- **Gate:** 7 项全绿 → 解锁 Wave 1-3 代码级细化;任一红 → 回 ADR §6 重议该选型

---

## Wave 1 · 数据平台地基(Ingest 段 + 版本绑定 + singleflight)

**Files(monorepo `packages/`):**
- Create: `packages/db/schema/*`(Drizzle schema:bangumi/points/clusters/routes_snapshots/ingest_jobs/cluster_version)
- Create: `supabase/migrations/<ts>_walk_subset_core.sql`(DDL + PostGIS + ingest_jobs UNIQUE(work_id) + 版本指针)
- Create: `packages/ingest/`(Workflow:Anitabi/Bangumi 摄入,step.do 断点续跑)
- Port: `route_optimizer` 的 union-find 聚类(旧 route_optimizer.py:34-114)→ Enrich 段预计算
- Port: KNOWN_LOCATIONS / city backfill(旧 sql_agent.py)→ Enrich

**Deliverable:** 预收录 10-20 作品的数据从 raw(JSONB)→ 聚类预计算 → publish,版本指针可原子切换。

**验收项(→ test 类型):**
- AC1 ingest_jobs(work_id) 唯一约束:并发两次摄入同作品只跑一次(singleflight)— integration
- AC2 版本切换原子:切 cluster_version 后旧 route_snapshot 查询结果不变 — integration
- AC3 union-find 聚类结果与 Python 版逐点一致(<50m 归簇)— unit(对拍旧实现)
- AC4 摄入失败 step.do 可断点续跑,不重复写入 — integration
- AC5 负缓存:不存在的 work_id 摄入失败被缓存,不反复打 Anitabi — integration

## Wave 2 · 4 只读 API(search / spots / routes / bundle)

**Files:**
- Create: `packages/api/`(Hono app + oRPC 契约 + jose JWKS 中间件)
- Create: `packages/api/routes/{search,spots,routes,bundle}.ts`
- Create: `packages/db/queries/*`(Drizzle 只查询;PostGIS ST_DWithin/ST_Distance 走 `sql` 模板)
- Port: 路线计时行程(旧 route_optimizer.py:222-315:80m/min,停留=max(3×拍照,8))
- Port: 错误码→HTTP 状态映射(旧 routes/_deps.py:163-182)

**Deliverable:** 4 个只读 API 上线,只读服务表,jose 本地验签(JWKS 缓存 10 分钟,勿用 getUser())。

**验收项:**
- AC6 search:NFKC + pg_trgm 模糊匹配,返回作品候选 — integration
- AC7 spots:bangumi_id → 点列表,纯读服务表(断言无写操作)— integration
- AC8 routes:点集 → 计时路线,与 Python route_optimizer 输出对拍一致 — unit + integration
- AC9 bundle:しおり 所需聚合(route_snapshot + 点 + OG)一次拿全,绑定版本 — integration
- AC10 jose 验签:无效/过期 token 拒绝;有效 token 放行;JWKS 缓存命中 — unit
- AC11 错误码映射:每个 ErrorCode → 正确 HTTP(400/401/429/504/500)— unit
- AC12 PostGIS 半径检索结果与 Python 版一致(同坐标同半径同结果)— integration

## Wave 3 · 窄入口 agent(AI SDK v5 + 自建守卫)

**Files:**
- Create: `packages/agent/`(AI SDK v5 + Zod 工具 + execute 内守卫)
- Create: `packages/agent/tools/*`(7 工具语义平移;agent 只读服务表,不调外部 API)
- Create: `packages/agent/guards.ts`(ModelRetry 等价:校验失败作 tool-error part 回喂)
- Create: `packages/agent/history.ts`(语义压缩:>200 字符摘要、滑窗 40、保留最近 8)
- Port: prompt + 守卫规则(旧 agents/ ~3,260 行,平移蓝本)
- Port: sql_agent 位置解析(字典→LLM 模糊→Google geocode)

**Deliverable:** 窄入口 agent 跑通,失败退普通搜索;过 eval parity gate。

**验收项(§3 热点逐条成为 gate):**
- AC13 output_validator 等价:未先跑 search 就返回 SearchResponse 被拒并重试 — eval + unit
- AC14 同上:未先跑 plan_route 就返回 RouteResponse 被拒 — eval + unit
- AC15 clarify 强制:调过 clarify 后必须返回 clarify_response 并停止,不续 search — eval
- AC16 ModelRetry 等价:非法工具参数被守卫拒绝并回喂重试 — unit
- AC17 历史语义压缩:10 轮后旧工具结果被摘要,最近 8 条不压,上下文不丢 — unit(对应 spike S4)
- AC18 系列/歧义启发式:query <70% 标题长度触发 clarify(防 "fate" 命中续作)— eval
- AC19 greet_user 早退:intent=greet_user 返回 session_id=null,不持久化 — unit
- AC20 LLM 闸:超 per-session token 预算 / 工具上限 → 降级普通搜索 — integration
- AC21 **parity gate:617 eval JSON 跑分 ≥ Python baseline(threshold 断言)— eval(Evalite + GH Actions)**

## 跨波次 · 横切

- 可观测:`@pydantic/logfire-cf-workers` + experimental_telemetry,迁移期与 Python Logfire 同 dashboard 双栈对照
- 缓存:Workers KV / Cache API 替换旧内存 ResponseCache(TTL 语义保留)
- eval 跑分器:Evalite(617 JSON 直读,baseline 写成 `threshold: { average: 0.54 }`)
- 前端 / しおり 客户端生成 / Walk mode UI = **独立计划**,不在本后端计划内(用户焦点为后端)

---

## Self-Review(对 ADR 覆盖)

- ADR §2 决策一(三段管线 + 只读纪律):Wave 1 + AC7 ✓
- ADR §2.2 版本绑定:AC2 ✓ / §2.3 singleflight:AC1, AC5 ✓ / §2.4 LLM 闸:AC20 ✓
- ADR §3 eval-first parity gate:AC21 ✓
- ADR §4 两周 Walk 子集次序(ingest→4 API→窄入口 agent):Wave 1→2→3 ✓
- ADR §5 复用清单(聚类/KNOWN_LOCATIONS/sql_agent/prompt/617 eval):各波 Port 项 ✓
- ADR §7 栈选型 + spike:Global Constraints + Wave 0 ✓
- NOT in scope(前端 Start 迁移 / all-in CF / Sandbox / 多 agent):未纳入 ✓
- **缺口:** 代码级步骤(完整代码 + 命令 + 期望输出)待 spike 转正后逐波次补 — 已在 altitude 说明声明
