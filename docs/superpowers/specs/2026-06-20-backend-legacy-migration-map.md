# 后端重写地图(Python 原地重写到新职责架构 · TS 载体暂缓)

> 状态:调研合成(2026-06-20),喂给 Python 原地重写计划
> 准绳:`2026-06-13-architecture-adr.md` **决策一(职责架构,栈无关)** 应用;
> **决策二(C2-S 全 TS on Workers)暂缓**——用户明确"暂时不切换到 TS"
> 范围:保留 FastAPI/asyncpg/PydanticAI,在 Python 里把后端重写成新职责架构
> 来源:3 路 Explore agent 盘点 interfaces/application、agent core、infra/clients

## 0. 现状量化

- 非测试后端 ~13,751 LOC / 123 文件;测试 88 文件
- 重力中心:`public_api.py`(479)、`session_facade.py`(463)、`clients/base.py`(433)、
  `pilgrimage_tools.py`(424)、`pilgrimage_agent.py`(389)、`persistence.py`(388)
- 本次定性:**不换语言/运行时**,换数据流形状(读写分离 + 摄入管线 + 版本/并发/成本护栏)

## 1. KEEP — 不动的(语言/运行时/已验证资产)

| 资产 | 说明 |
|---|---|
| FastAPI / asyncpg / PydanticAI | 栈不变,无 spike 前置 |
| clients/base.py(433) | retry+rate-limit(30/60s)+cache+错误映射 分层清晰,非过度设计,**留用**(被摄入管线复用) |
| services/cache.py + retry.py | 内存 LRU/TTL + 指数退避,留用 |
| route_optimizer union-find 聚类(:34-114)| 复用,移到 Enrich 段预计算 |
| route_optimizer 贪心最近邻(:120-180)+ 计时行程(:222-315)| 留在路线 API |
| sql_agent 位置解析 + KNOWN_LOCATIONS | 留用 |
| 7 工具语义 + prompt + 守卫规则 | 留用,只改"数据来源"(改读服务表) |
| 617 eval JSON + Logfire 观测 | 留用,作重写 parity baseline |

## 2. CHANGE — 按 ADR 决策一在 Python 内重构(非换栈)

| 旧行为 | 位置 | 新职责架构(Python 内) |
|---|---|---|
| agent 请求期调 Anitabi/Bangumi + 顺手写库 | pilgrimage_tools.py:170-280;resolve_anime.py | **Catalog 拆出**:新建 Python 摄入管线;工具改为**只读服务表**,删请求期 API 回退+写穿 |
| best-effort 散落写库 | persistence.py | 写入收敛到管线;app DB 角色 SELECT-only 结构性保证(single-writer) |
| 无摄入并发控制 | — | **singleflight**:`ingest_jobs(work_id)` 唯一约束 + 负缓存 |
| 无原子发布 | — | **版本绑定**:`cluster_version` + `route_snapshots`,版本指针切换 |
| 无成本闸 | pilgrimage_runner.py | **LLM 闸**:per-session token 预算 + 工具调用上限 + 超限降级普通搜索 |
| 编排臃肿/静默吞错 | public_api.py(479)、session_facade.py(463) | 按职责拆分;丢数据的静默吞错改为显式处理 |
| raw 数据无隔离 | — | Ingest 段 raw 先 JSONB;Enrich 段质检隔离区/系列图谱/别名/城市回填/署名 |

## 3. REWRITE-RISK HOTSPOTS — 最易"悄悄丢掉"的行为(必须成为验收项)

> 即便留在 Python,重构编排/拆 agent 时这些行为最易回归。

### A. agent core(重构工具数据来源时勿伤)
1. `output_validator`(pilgrimage_agent.py:351-389):SearchResponse 必先执行 search、
   RouteResponse 必先执行 plan_route,否则 ModelRetry——防 LLM 编造。**保留**。
2. `ModelRetry` 守卫(pilgrimage_tools.py:230-233, 309-312):拒非法工具参数。**保留**。
3. 历史语义压缩(pilgrimage_agent.py:131-239):>200 字符摘要,滑窗 40,保留最近 8。**保留**。
4. clarify 强制(pilgrimage_agent.py:54-71;tools:420-424):调过 clarify 后必返回
   clarify_response 并停止。**保留**。
5. 系列/歧义启发式(resolve_anime.py:25-46):query ≥70% 标题长度才算强匹配。**保留**。

### B. interfaces / 请求编排(拆分时勿伤)
6. `greet_user` 早退(public_api.py:134-139):session_id=None,不持久化。
7. context delta 提取顺序(session_facade.py:289-342):resolve_anime 成功后首个 break。
8. interaction 上限 20 + LLM 压缩(session_facade.py:345-413)。
9. message_history 反序列化(public_api.py:412-419):session load 后、agent 调用前。
10. 错误码→HTTP 状态映射(routes/_deps.py:163-182)。
11. provider 错误启发式(public_api.py:289-300)。
12. `PublicAPIResponse` 形状(schemas.py):前端契约。

### C. 拆 Catalog 时的新风险
13. 工具改只读后,**服务表未预收录的作品**会查空 → 需明确降级/提示(ADR:预收录 10-20 作品,不押实时首收)。
14. 摄入管线与请求路径解耦后,**数据新鲜度**靠 per-work TTL 增量 + SWR +「最新を確認」,不在请求期同步拉。

## 4. 给重写计划的结论

- 不换栈 → 无 spike 前置,计划可直达代码级(TDD)。
- 最大单项动作 = **Catalog 从 agent 拆出**(读写分离),其余护栏(版本/singleflight/LLM 闸)围绕它。
- §3 全部 14 条进 plan 作显式验收项,逐条对应测试(eval|unit|integration),617 eval 做 parity baseline。
- 决策二(TS on Workers)保留在 ADR,作为后续独立决策点,本次不动。
