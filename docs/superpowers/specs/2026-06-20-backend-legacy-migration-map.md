# 后端遗产迁移地图(Python → TS on Workers,按新业务要求重写)

> 状态:调研合成(2026-06-20),喂给 Walk 子集重写计划
> 准绳:`2026-06-13-architecture-adr.md`(ACCEPTED,C2-S:全 TS on Workers + Supabase 留任)
> 范围决策:TS 重写代码/spike 本次搁置;本 doc + 重写计划先行
> 来源:3 路 Explore agent 盘点 interfaces/application、agent core、infra/clients

## 0. 现状量化

- 非测试后端 ~13,751 LOC / 123 文件;测试 88 文件
- 重力中心:`public_api.py`(479)、`session_facade.py`(463)、`clients/base.py`(433)、
  `pilgrimage_tools.py`(424)、`pilgrimage_agent.py`(389)、`persistence.py`(388)
- ADR 定性:Python 仓渐冻,只平移 eval 数据 + prompt 语义 + 确定性算法,其余弃

## 1. KEEP / PORT — 要抽取的"灵魂"(低风险,确定性逻辑)

| 资产 | 位置 | 说明 | 风险 |
|---|---|---|---|
| union-find 聚类 | route_optimizer.py:34-114 | 路径压缩,<50m 归簇,确定性 | 低 |
| 贪心最近邻排序 | route_optimizer.py:120-180 | 从 origin/首簇起,平局按 cluster_id | 低 |
| 计时行程构建 | route_optimizer.py:222-315 | 80m/min,停留=max(3×拍照,8)min,节奏倍率 | 低 |
| 位置解析管线 | sql_agent.py:119-172 | 字典→LLM 模糊→Google geocode 候选回退 | 中(分支多) |
| PostGIS 查询模板 | sql_agent.py:214-297 | ST_DWithin/ST_Distance,参数化 | 低(DB 无关) |
| KNOWN_LOCATIONS | sql_agent.py | 25 日本城市/车站缓存 | 低 |
| 7 工具语义 + prompt + 守卫规则 | agents/(~3,260 行) | 平移蓝本 | 中 |
| 617 eval JSON | tests/eval/ | 直用,做 parity baseline | 低 |

## 2. DROP / REDEFINE — 按新业务要求改形态(非翻译,是架构变化)

| 旧行为 | 位置 | 新要求(ADR) |
|---|---|---|
| agent 请求期调 Anitabi/Bangumi | pilgrimage_tools.py | 移入数据平台 Ingest;agent 只读服务表 |
| "顺手 insert" 写库 | persistence.py | 一切写入必经管线;singleflight + 版本绑定 |
| 内存 ResponseCache(LRU/TTL) | services/cache.py | Workers KV / Cache API |
| asyncpg 连接池 | infrastructure/supabase | Hyperdrive 直连 5432 + Drizzle(只查询) |
| FastAPI / 容器 | interfaces/fastapi_service.py | Hono on Workers |
| 内存 session dict | infrastructure/session | KV / Supabase(显式持久化) |
| VercelAIAdapter(已 revert) | routes/chat.py | 原生 AI SDK v5 createUIMessageStream |
| pydantic-ai 模型路由 | clients/base.py:_parse_model | AI SDK v5 + @ai-sdk/deepseek |

## 3. REWRITE-RISK HOTSPOTS — 最易"悄悄丢掉"的行为(必须成为验收项)

### A. agent core(PydanticAI 三件套,无 AI SDK 直接对应物)
1. `output_validator`(pilgrimage_agent.py:351-389):SearchResponse 必须先执行 search、
   RouteResponse 必须先执行 plan_route,否则 ModelRetry —— **防 LLM 编造**。
2. `ModelRetry` 守卫(pilgrimage_tools.py:230-233, 309-312):拒绝非法工具参数。
   → AI SDK v5 用"校验失败作为 tool-error part 回喂"等价。
3. 历史语义压缩(pilgrimage_agent.py:131-239):>200 字符工具结果替换为
   `["search_bangumi: found 15 spots"]`,滑窗阈值 40,保留最近 8。格式脆弱(JSON 解析)。
4. clarify 强制(pilgrimage_agent.py:54-71;pilgrimage_tools.py:420-424):
   调过 clarify 后必须返回 clarify_response 并停止,不得续 search。
5. 系列/歧义启发式(resolve_anime.py:25-46):query ≥70% 标题长度才算强匹配
   (防 "fate" 命中 "fate/stay night")。

### B. interfaces / 请求编排
6. `greet_user` 早退(public_api.py:134-139):intent=greet_user 时在生成/持久化
   session 前返回,前端期待 session_id=None。
7. context delta 提取顺序(session_facade.py:289-342):按序走但 resolve_anime 成功后
   只在首个 break;改成走全部会合并冲突数据。
8. interaction 上限 20 + LLM 压缩(session_facade.py:22-24, 345-413):去掉则 session 不收缩。
9. message_history 反序列化(public_api.py:412-419):
   `ModelMessagesTypeAdapter` 重建,必须在 session load 后、agent 调用前。
10. 错误码→HTTP 状态映射(routes/_deps.py:163-182):新错误码不更新映射会默认 500。
11. provider 错误启发式(public_api.py:289-300):字符串搜 "502"/"rate limit"/"network",
    上游格式变会误判为 internal_error。
12. `PublicAPIResponse` 形状(schemas.py):前端契约,success/status/intent/data/ui/debug 等字段。

### C. infra
13. PostGIS ST_DWithin/ST_Distance:**ADR 已解(Supabase 留任,Hyperdrive + `sql` 模板)**——
    不搬,留在 PG。这是旧后端最难搬的一块,ADR 选择规避而非重写。
14. best-effort 持久化静默吞错(persistence.py):Workers 无静默吞错文化,需显式错误处理;
    且新要求是写入经管线 + singleflight,模型完全不同。
15. clients/base.py(433 行):retry + rate-limit(30/60s)+ cache + 错误映射 + auth 分层清晰,
    **非过度设计**,但横切逻辑重写最易丢细节(KV/Cache API 替换缓存语义)。

## 4. 给重写计划的结论

- 最大基础设施风险(PostGIS)已被 ADR 的 Supabase 留任决策提前拆除 → 重写聚焦应用层与 agent。
- 真正的工程在 §3.A(守卫/校验/压缩/clarify)——必须用 617 eval 的 parity gate 兜底验证。
- §3 全部 15 条进 plan 作为显式验收项,逐条对应测试(eval|unit|integration)。
- 路线:按 ADR §4 两周 Walk 子集先行(ingest worker → 4 API → 窄入口 agent → 前端 → しおり)。
