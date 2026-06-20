# 后端 Python 原地重写实施计划 · 新职责架构(不切 TS)

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development 或 superpowers:executing-plans 逐任务执行。步骤用 `- [ ]` 跟踪。
> **altitude:** 栈不变(FastAPI/asyncpg/PydanticAI),无 spike 前置,任务级(file:line + DDL + AC→测试)。handler 改写代码由执行期 TDD 驱动。
> **已硬化:** 经 13-agent 地面核验 workflow(2026-06-20,8 假设 7 被证伪),下文已并入现实修正。

**Goal:** 在 Python 里把后端重写成 ADR 决策一职责架构:**目录数据(catalog)只读 + 经摄入管线**;运营/会话写入合法留在请求内;加版本绑定 / singleflight / LLM 闸。

**Architecture:** Catalog(bangumi/points)从 agent 拆出为独立 Python 摄入管线(Ingest→Enrich→Publish);agent 工具退化为**目录表只读消费者**;运营表(sessions/conversations/messages/routes/user_memory)保持请求内写入(响应体依赖它们)。版本指针保证旧路线不漂移。

**Tech Stack:** Python · FastAPI · asyncpg · PydanticAI · PostGIS · Supabase migrations · pytest · Logfire。

## Global Constraints

- **纪律(已修正边界):** agent/API 对**目录表(catalog:bangumi、points)只读**,目录写入必经摄入管线;**运营表**(sessions/conversations/conversation_messages/routes/user_memory/request_log/feedback)请求内写入合法保留——`persist_result` 写后,响应体从该状态构建(public_api.py:163-167),不可推迟
- 不换语言/运行时;决策二 TS on Workers 本次不动
- parity gate:AC15 = 重写后 617 eval 各指标不低于 Wave 0 baseline >10%
- 版本绑定:cluster_version + route_snapshots;singleflight:ingest_jobs(work_id) 唯一 + 负缓存;LLM 闸:per-session token 预算 + 工具上限 + 降级
- 预收录 10-20 作品 + **eval miss/sparse 案例(~235)预摄入**,否则 DataCompleteness(0.476)回归
- 测试:pytest(--asyncio-mode=auto),覆盖率 ≥80% 只升不降

## 现实核验结论(承重,执行时勿违背)

- **写穿无条件**:`execute_sql_with_fallback` 先 `write_through_bangumi_points` 再查 DB(sql.py:44-57);改只读 = 删 sql.py:44-48
- `resolve_anime` 无条件调 Bangumi `search_subject`(resolve_anime.py:145),写 upsert 仅在 API 命中且 DB 无(resolve_anime.py:176,201)
- `persist_result` 请求内同步写 5 张运营表(persistence.py:100-118)
- 单 superuser DSN,无角色分离(settings.py:127-129;client.py:41-67),anon/service key 定义未用
- 新表不存在;最新 migration `20260510180000_add_points_city.sql`
- ⚠ `seed_data.py:137` 调不存在的 `db.upsert_bangumi()`(真:`db.bangumi.upsert_bangumi`)——seed 脚本 stale,摄入地基别依赖它,先验证
- ⚠ `enrichment.py:209-213` `asyncio.gather` 捆 3 写(ensure_bangumi_record + persist_points + update_points_count),摄入须保原子组

---

## Wave 0 · baseline 固化(已验证 runbook)

- [ ] `cp .env.example .env` 填 `DEEPSEEK_API_KEY`(必需;SUPABASE_DB_URL 可选,testcontainer 自启,需 Docker)
- [ ] `make test-eval`(617 agent + 62 translation 案例,-m integration --no-cov)→ 落档 baseline
- [ ] `make test-cov`(80% floor:68 unit + 6 integration)
- **Baseline(要超过):** IntentMatch 0.538 · MessageQuality 1.0 · ToolExecution 0.998 · DataCompleteness 0.476 · StepEfficiency 0.922 · ResponseLocale 0.597(555/617≈90%,0 错)
- ⚠ translation baseline 结果文件是 1.4K 占位,需重跑取真值
- **Gate:** 上述落档;后续每波 eval 任一指标不得跌 >10%

## Wave 1 · 数据表 + singleflight + 版本指针(GO,纯加表)

**Files:** Create `supabase/migrations/20260620120000_ingest_infrastructure.sql`

**DDL(已核验无命名冲突):**
```sql
CREATE TABLE ingest_jobs (
  work_id TEXT PRIMARY KEY, status TEXT NOT NULL, error TEXT, error_code TEXT,
  started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ);              -- PK=singleflight+负缓存
CREATE TABLE cluster_version (
  id SERIAL PRIMARY KEY, work_id TEXT NOT NULL REFERENCES ingest_jobs(work_id) ON DELETE CASCADE,
  version INT NOT NULL, is_current BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX idx_cluster_version_current ON cluster_version(work_id, is_current);
CREATE TABLE route_snapshots (
  id SERIAL PRIMARY KEY, work_id TEXT NOT NULL REFERENCES ingest_jobs(work_id) ON DELETE CASCADE,
  cluster_version INT NOT NULL, payload JSONB NOT NULL,          -- payload=完整 route 对象
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
```

**验收项:**
- AC1 `ingest_jobs(work_id)` PK:并发两次同 work_id 仅一条 running — integration
- AC2 版本指针切换原子:切 is_current 后旧 route_snapshot 查询不变 — integration
- **AC3(已修正)** SELECT-only 仅对**目录表(bangumi、points)**;运营表保持可写。结构性 enforcement 为未来态(testcontainer 用 superuser)→ 本 AC 用专门 app_role fixture 测,或降级为文档约定 — integration/doc
- AC4 负缓存:不存在 work_id 摄入失败写 ingest_jobs.error,二次读缓存不打 Anitabi — integration
- 注:Wave 1 不碰 agent 逻辑,eval baseline 不受影响 → 可独立先跑

## Wave 2 · Catalog 拆出 + 工具只读(核心,有阻塞前置)

**Files:**
- Create `backend/catalog/{ingest,enrich,publish,cli}.py`(enrich 复用 route_optimizer union-find :34-114;保 enrichment.py:209-213 原子组)
- Modify `backend/agents/handlers/resolve_anime.py:145` → DB-first,移除请求期 API
- Modify `backend/agents/.../sql.py:44-48`(删 write-through);`resolve_anime.py:174-176,200-201`(删 upsert);`tools.py:125-144`(gate)
- Modify retriever 缓存键加 version(retriever.py:119,防并发竞态)

**阻塞前置(必须先做):**
- **P1 预摄入**:用 Wave 1 的 singleflight 把"已收录作品" + **eval miss/sparse 的 bangumi(从 agent_eval_v3.json 提 ID,~235 例)** 预灌进 DB,否则 search_bangumi 查空、DataCompleteness 跌
- **P2 决策**:resolve_anime 的 title/cover 解析保持同步(保 resolve→search parity)vs 全预摄入——二选一写进 plan

**验收项:**
- AC5 CLI 摄入一个作品 → 目录表出现点 + cluster_version — integration
- AC6 agent run 期**对 Anitabi/Bangumi client 零调用 + 对目录表零写**(mock 断言)— unit
- AC7 search_bangumi 只读目录表,已摄入作品与重写前同输入同输出对拍 — integration
- AC8 未摄入作品:查空 → 明确降级(提示/退普通搜索)不报错 — eval
- AC9 enrich 聚类与旧 route_optimizer 逐点一致 — unit
- **AC-DC 决策**:miss/sparse 预摄入后 DataCompleteness ≥0.476;若选不预摄入则显式放宽该 floor 并文档化 trade-off — eval

## Wave 3 · LLM 闸 + 编排清理

**Files:** Modify `pilgrimage_runner.py`(LLM 闸)、`public_api.py`(拆 handle() 105 行)、`session_facade.py`(463)、`persistence.py`(显式错误处理)

**验收项:**
- AC10 LLM 闸:超 token 预算/工具上限 → 降级,不无限循环;**澄清:透明 API fallback 是否计入工具配额** — integration
- AC11 greet_user 早退(session_id=None,persist 前 return,public_api.py:134-139)不变 — unit
- AC12 clarify 强制不变 — eval / AC13 message_history 反序列化时序不变 — unit
- AC14 错误码→HTTP 映射全覆盖 — unit
- **AC15 parity:617 eval 各指标 ≥ Wave 0 baseline(跌幅 ≤10%)** — eval

## 跨波次 · 保留项回归

output_validator / ModelRetry 守卫 / 历史语义压缩(>200/滑窗40/留8)/ 系列启发式(≥70%)/ Logfire span / 内存 cache+retry — 重写后回归全绿。

---

## 阻塞风险登记(7 项高置信证伪 → 对应缓解)

1. **运营表 SELECT-only = 应用崩**(persist_result 写 5 表 + 响应从状态建)→ AC3 改 catalog-only
2. **resolve→search parity 在延迟写下崩**(search 查空)→ P1 预摄入 + P2 resolve 同步
3. **DataCompleteness 回归**(~235 miss/sparse 靠 write-through)→ P1 预摄入 或 显式放宽 floor
4. **并发同 bangumi 竞态**(retriever.py:119 实例级缓存不去重)→ ingest_jobs 唯一 + version 入缓存键

## Self-Review

ADR 决策一只读纪律(catalog-only)+ Catalog 拆出 + 三段管线 + 版本绑定 + singleflight + LLM 闸 + 预收录 + parity:Wave 0-3 + 风险登记全覆盖 ✓;决策二不在本计划 ✓
