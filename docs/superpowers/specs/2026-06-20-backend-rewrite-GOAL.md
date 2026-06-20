# GOAL · 后端全新重写:数据平台 + 薄 Agent(Python 原地,最严格方案)

> 这是一份自包含的总纲指令。执行者(含自治 loop / sub-agent)必须严格遵守。
> 工作目录:`/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/backend-survey`(分支 `backend-survey`)。

## 0. 使命

把聖地巡礼后端**全新重写**成"数据平台为核心 + Route 为家 + agent 为只读消费者"的形态,**Python 原地**(FastAPI/asyncpg/PydanticAI),**不切 TS**。**完整交付 Phase 1(Walk 子集),一个功能都不能落下**,用最严格的工程标准,e2e 真实验证,eval parity gate 兜底。本次**只动后端,不碰前端**。

## 1. 权威文档(冲突时优先级从高到低)

1. 系统设计:`/Users/lumimamini/.claude/plans/pure-percolating-wadler.md`(已与用户对齐,最高准绳)
2. ADR 决策一:`docs/superpowers/specs/2026-06-13-architecture-adr.md`(职责架构,栈无关)
3. 迁移地图:`docs/superpowers/specs/2026-06-20-backend-legacy-migration-map.md`
4. 领域细节:series-aware(`2026-04-27-*`)、route-planning(`2026-04-28-*`)、agent(`2026-04-08-*`)

> ADR 决策二(TS on Workers)= **OUT(搁置)**。任何 TS/Workers/Hono/Drizzle/Wrangler 内容都不实现。

## 2. 铁律(违反即重做,不可商量)

1. **读写两纪律**:
   - **catalog**(`bangumi/points/clusters/aliases/series_edges/leg_cache/raw_*/media_assets/ingest_jobs/cluster_version`)→ agent/API **只读**;写入**只经 pipeline 角色**。
   - **operational**(`sessions/conversation_messages/routes/route_snapshots/user_memory/request_log/feedback`)→ 请求内**同步写**(响应体依赖,不可推迟)。
2. **Agent 绝不碰上游**:Anitabi/Bangumi/Google 客户端只能存在于 `catalog/ingest/sources/` 与 `media/`;agent 包**禁止 import 任何上游 client**。
3. **版本绑定**:`cluster_version.is_current` 单事务原子切换;`route_snapshots` 锁旧路线永不漂移。
4. **Singleflight + 负缓存**:`ingest_jobs(work_id)` PK + `ON CONFLICT DO NOTHING`;失败写负缓存防击穿。
5. **LLM 预算闸**:per-session token 预算 + 工具调用上限 → 超限退 plain search,严防无限循环。
6. **全新重写 agent,但确定性内核 port 不重写**:union-find 50m 聚类、最近邻、计时行程(`route_optimizer.py:34-315`)、series-aware 15km 逻辑——移植,不从零写。
7. **单写者结构性保证**:Postgres 双角色 `app`(catalog SELECT-only + operational RW)/ `pipeline`(catalog 唯一写者)。
8. **SSoT**:Anitabi/Bangumi 为正本,Supabase 为服务副本;响应带 `synced_at`。
9. **DDD 分层**:bounded contexts = Catalog / Routing / Conversation。`domain/`(entities/value objects/aggregates/domain services)**纯 Python,无 SQL、无 I/O、无 pydantic-ai**;`application/` 依赖 repository 端口(Protocol);**所有 SQL 只活在 `infrastructure/` 的 repository 实现里**(typed + 集中 row→Pydantic 映射)。SQL 是被封装的领域复杂度,不是债。
10. **依赖决策(审计定案)**:保留 asyncpg 裸 SQL,**不引入 ORM**(PostGIS/pgvector/高级 SQL 任何 ORM 都强迫 drop-to-raw,SQLAlchemy/SQLModel 还付 greenlet 税);删 4 个幽灵/死依赖(`python-dotenv`/`google-genai`/`pydantic-ai-guardrails`/`opentelemetry-*`);HTTP 客户端合并到 **httpx**(删 aiohttp);CVE pin 移到 lock 文件。

## 3. 质量标准(最严格)

- **TDD 强制**:每个功能先写失败测试 → 跑到失败 → 最小实现 → 绿 → 重构。写 Python 前调用 `/backend-tdd`。
- **1-10-50**:函数 ≤10 行,类 ≤50 行,文件 ≤300 行;缩进 ≤2 层(早返回/抽取)。
- **类型安全**:无 `Any`(用 `object`+`isinstance`);无 `dict[str, object]`(用 dataclass/Pydantic);ID/状态用 NewType/Literal/Enum;不用 `assert` 做运行时校验(用 `if not x: raise`)。
- **零 suppression**:未经用户批准,不得加 `noqa`/`type: ignore`/`pragma: no cover`/`skip`/`continue-on-error` 等。规则报错就改代码。
- **覆盖率只升不降**:backend ≥80%(`pytest.ini` floor);新增代码抬高 floor 到新实测值。
- **每次改动前后 `make check`**(lint + typecheck + test)全绿。
- 不留 `TODO`/占位/死代码;不加注释除非确有必要。

## 4. 测试与验证(必须全绿,这是"做完"的硬条件)

- **三层**:unit(mock)+ integration(testcontainer Postgres/PostGIS)+ e2e。
- **e2e 必须通过**:用**充足的本地(testcontainer + 真/mock 上游)或线上 API(真 Anitabi/Bangumi/DeepSeek)**测试覆盖,不允许"理论上能跑"。
- **eval parity gate**:**新 agent** 的 eval 各指标相对**在档 DeepSeek baseline** 跌幅 **≤10%** 才算过。
  - 参照 baseline(DeepSeek,已在档):IntentMatch 0.538 / DataCompleteness 0.476 / ResponseLocale 0.597 / ToolExecution 0.998 / StepEfficiency 0.922。
  - **不重跑旧 agent/替身模型的 baseline**(用户定:eval set 随重写平移,旧 baseline 是一次性丢弃品)。parity gate 在 Wave 4(新 agent + 平移 eval)就位时对着在档参照建;harness 已修可跑(评测新 agent 用)。
- **e2e 关键路径(全部自动化断言)**:
  1. cron/CLI 预收录一作品 → `GET /v1/search` 命中 → `POST /v1/routes` 出 `timed_itinerary` → `GET /v1/routes/{id}/bundle` 离线包。
  2. `POST /v1/chat`(SSE)查**未收录**作品 → L1<1s 前菜 → L2≤8s 同步摄入 → SSE 原地升级卡片。
  3. **断言 agent run 期对上游 client 零调用 + 对 catalog 零写**(mock spy)。
  4. 版本切换:重聚类后旧 `route_snapshot` 查询结果不变。
  5. singleflight:并发两次同 `work_id` 仅一条 running;负缓存不反复打 Anitabi。
  6. 保留行为:output_validator(search-before-SearchResponse / route-before-RouteResponse)、ModelRetry、历史语义压缩、clarify 强制、greet 早退(session_id=None)、错误码→HTTP 映射。

## 5. 每个功能的流程(无一例外)

1. 按 §6 顺序选下一个未完成 feature/wave。
2. `/backend-tdd` → 写失败测试 → 跑到失败。
3. 最小实现到绿。
4. `make check` 全绿(lint+typecheck+test,覆盖率不降)。
5. **trigger reviewer sub-agent**(`subagent_type=reviewer`):审 diff 的正确性/安全/SOLID/Clean Code/TDD 合规/**读写纪律遵守**/类型安全/1-10-50。
6. 处理 review 意见至通过(P1 必修;无 suppression 绕过)。
7. commit(小而频繁,语义化 message,结尾带 Co-Authored-By)。
8. 回 1,直到 Phase 1 **全部**完成。

> 每个 wave 收尾追加:reviewer sub-agent 复审整波 + tester sub-agent 对**运行中的 app** 验关键路径。

## 6. 执行波次(Phase 1 全集,全部做完)

- **Wave 0 · baseline 参照(✅ 完成)**:eval harness 6 层 bug 已修可跑(commits `5c5eb60`/`f318cc0`,`make check` 绿,单测覆盖率 84.23% line-rate)。parity 参照 = **在档 DeepSeek baseline**(§4 数值)。**不重跑替身模型 baseline**(用户定,丢弃品);新 agent 的 parity gate 在 Wave 4 对着参照建。Gate 解除。
- **Wave 1 · 数据表 + 双角色**:migration 拆 catalog/operational;建 `ingest_jobs`(work_id PK)/`cluster_version`/`route_snapshots`/`aliases`/`series_edges`/`leg_cache`/`raw_anitabi`/`raw_bangumi`/`media_assets`;GRANT `app` SELECT-only on catalog,`pipeline` writer。
- **Wave 2 · catalog 管线 + worker**:`catalog/ingest`(jobs singleflight / raw_store / sources:anitabi·bangumi·aliases)+ `enrich`(cluster=port union-find / city_backfill / alias_pipeline 4 源 NFKC / quality / series=port 15km)+ `publish`(versioning 原子切换 / snapshots / catalog_repo 只读)+ `worker/loop`(Postgres-queue `FOR UPDATE SKIP LOCKED` + `LISTEN/NOTIFY` + `stage` 幂等续跑)+ `worker/cron`(APScheduler:周 dump / 6h 增量 / 预收录 top10-20 + ~235 eval-miss / R2 LRU 清扫)。
- **Wave 3 · 4 API**:`api/routes/{search,spots,routes,bundle}` — FastAPI,只读 catalog via `catalog_repo`,PostGIS `ST_DWithin`,错误码→HTTP 映射,响应带 `synced_at`。
- **Wave 4 · 全新薄 agent**:`agent/{runtime,tools(7只读),outputs(typed union),guards,history,budget,deps}` + `api/routes/chat_sse`(SSE,plain-search fallback);port series-aware + route planning 内核到 `planning/`。过 parity gate。
- **Wave 5 · L1/L2/L3 按需摄入**:`catalog/ingest/tiers`;chat 触发现场摄入;≤8s 预算 + 并发竞态(输家订阅)+ SSE 原地升级;L3 入队后台 + 完成事件。
- **Wave 6 · media**:Lazy R2(aioboto3)+ `/img/:pointId` 边缘可缓存 + static map PNG + WebP 转码 + tombstone fallback。
- **Wave 7 · 收口**:e2e 全路径自动化 + eval parity gate 绿 + 全量回归 + 删除旧 agent 路径所有上游调用。

## 7. 完成定义(缺一不可)

- [ ] Phase 1 全部 wave 完成,无 TODO/占位/死代码。
- [ ] unit + integration + e2e 全绿;覆盖率 ≥ floor 且已抬高。
- [ ] eval parity gate 绿(各指标 ≤10% drop)。
- [ ] 每个 feature 经 reviewer sub-agent 通过;每 wave 经 tester sub-agent 验证。
- [ ] `make check` 全绿。
- [ ] §4 全部 e2e 断言通过(读写纪律 / 版本绑定 / singleflight / LLM 闸 / agent 零上游调用)。
- [ ] 复用项已 port(route_optimizer / entities / series);旧 agent 上游调用已删净。

## 8. 汇报

每个 wave 完成报:**做了什么 / 测试结果(具体数字)/ review 结论 / 下一步**。失败如实报 + 贴输出,不掩饰、不跳过。

## 9. 环境约束提醒

- 在 worktree `backend-survey` 工作;跑后端前 `cd` 到 worktree(uv 从 cwd 解析 backend/)。
- docker:colima 已 READY(eval/integration 的 testcontainer 用)。
- `.env`(仓库根)`DEEPSEEK_API_KEY` 需填(eval + 线上 e2e 用 deepseek-v4-pro)。
- 只动后端,不碰前端;不引入任何 TS/Workers。
