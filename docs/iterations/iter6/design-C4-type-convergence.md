# C4 v2 — apps/agent 反射 DI 收敛 + SessionEnvelope 类型化(#654,并入 #663 修复)

**结论:删掉 ports.py 的 7 个 getattr 访问器(不设任何 helper 层),按 bounded context 拆 9 个窄 Protocol(8 个 repo Protocol + `CatalogLookup` 窄聚合,与下表逐一对应);调用方函数签名直接收窄 Protocol,组合根(fastapi lifespan)持有具体 `SupabaseClient` 并解构注入。第一批 = #663 生产静默失效修复 + offline Docker 臂真实写入集成测试。**

## 现状(2026-08-03 全部实测,rg 于 apps/agent,非测试代码)
- `db: object` 28 处:interfaces/infrastructure 21 处(persistence×7、fastapi_service×4、public_api×3、usage_metering×2、session_facade/anon_quota/_deps/memory 各 1)+ ports.py 访问器 7 处。
- ports.py 现有 6 个 repo Protocol + 7 个反射访问器(`get_session/bangumi/routes/usage/anon_quota_repo` + `has_session/routes_repo`),全走 `getattr + iscoroutinefunction + cast`。现 `DatabasePort` 只聚合 bangumi+points(消费者:animichi_runner:161、runtime_deps:75、eval null_database)。
- **#663 死路径(确认)**:`persistence.py:158` `getattr(db,"insert_message")`、`public_api.py:698` `getattr(self._db,"insert_request_log")`。生产 db=裸 `SupabaseClient`(`_lifespan_build_runtime`),真实方法在 `db.messages.insert_message`(repositories/messages.py:16)与 `db.feedback.insert_request_log`(repositories/feedback.py:43),client.py 无顶层同名方法/`__getattr__` → 两个 getattr 恒 None → conversation_messages 与 request_log 生产**静默不写**。
- session 信封:`session_facade.py` 22 处 / `persistence.py` 11 处 `dict[str, object]`,魔法 key("interactions"/"route_history"/"session_state_v2")+ `_list()` 防御散落。
- 另一表面(本卡不动,记录):`routes/_deps.py:254 _require_supabase` 直接 isinstance 取具体 client,5 个 HTTP route 模块用 `db.messages/.feedback/.bangumi` —— 已是 typed 访问,无反射病;留待后续卡评估是否同样收窄。

## Protocol 清单(按 bounded context;方法签名 = 已实测的实现/调用形状)

| Protocol(ports.py) | 方法全集 | 消费者(非测试) |
|---|---|---|
| `BangumiRepo`(existing) | `find_bangumi_by_title(title)->str\|None` · `find_all_by_title(title)` · `upsert_bangumi_title(title,bangumi_id)` · `upsert_bangumi(bangumi_id,*,title,cover_url,points_count)` · `find_candidate_details_by_titles(titles)` · `filter_existing_ids(bangumi_ids)->list[str]` | agent tools(经 `CatalogLookup.bangumi`)、persistence.py:336 |
| `PointsRepo`(existing) | `search_points_by_location(lat,lon,radius_m,*,limit=50)` · `get_points_by_ids(point_ids)` · `upsert_points_batch(rows)` | agent tools(经 `CatalogLookup.points`) |
| `SessionRepo`(existing) | `create_owned_session` · `upsert_session` · `upsert_conversation` · `update_conversation_title` · `check_session_owner` | persistence.py:198/219/235、session_facade.py:300、public_api.py:230 |
| `RouteArchive`(rename RoutesRepo) | `save_route(session_id,anime_ids,point_ids,data,*,origin_station,origin_lat,origin_lon)->str` | persistence.py:302 |
| `UsageMeter`(rename UsageRepo) | `accumulate_usage(*,usage_date,scope,requests,input_tokens,output_tokens,cost_usd)` · `total_cost_usd(*,usage_date,scope)->float` | usage_metering.py:111/139 |
| `AnonQuotaCounter`(rename AnonQuotaRepo) | `increment_and_count(*,usage_date,anon_id)->int` | anon_quota.py:87 |
| **`ConversationLog`(新)** | `insert_message(session_id:str, role:str, content:str, response_data:dict[str,object]\|None=None) -> None`(逐参对齐 messages.py:16 真实签名——第 4 参名是 `response_data` 非 v1 的 `data`,JSON 载荷用仓内既有 `dict[str, object]` 形状) | persistence.persist_messages(#663 修复点) |
| **`RequestAudit`(新)** | `insert_request_log(*, session_id:str\|None, query_text:str, locale:str, plan_steps:list[str]\|None, intent:str\|None, status:str, latency_ms:int\|None) -> str`(逐参对齐 feedback.py:43) | public_api.RuntimeAPI(#663 修复点) |
| `CatalogLookup`(rename DatabasePort) | properties `bangumi: BangumiRepo` · `points: PointsRepo` | animichi_runner:161、runtime_deps:75、eval null_database |

无聚合大 Port、无访问器函数:组合根 `_lifespan_build_runtime` 持具体 `SupabaseClient`,按 `client.messages / client.feedback / client.session / ...`(8 个 @property,PEP 544 结构化满足各窄 Protocol)解构注入;`RuntimeAPI.__init__` 与 `handle_public_request` 的 `db: object` 拆为按需的窄参数(如 `sessions: SessionRepo`、`request_audit: RequestAudit | None`)。测试 double 只需实现所用的那个小 Protocol(现 SimpleNamespace/AsyncMock 天然适配,无需 runtime_checkable)。`memory.py`/`_deps.py` 的 `isinstance(SupabaseClient)`(需裸 pool/具体 client)保留在组合根一侧并注释。

## SessionEnvelope(pydantic,方向维持 v1,命名按语义)
- `SessionEnvelope`:`interactions: list[InteractionRecord]`(≤20)· `route_history: list[dict[str, object]]`(≤10)· `last_intent/last_status: str|None` · `last_message: str=""` · `summary: str|None` · `updated_at: datetime | None = None`(**可缺省**——缺失/非法时间戳只走归一化/置 None,**不得**触发整封 ValidationError 把有效的 interactions/route_history/session_state_v2 一起清空)· `session_state_v2: dict[str, object]|None`(**保 raw**——已有 `SessionState.model_validate` + `_parse_forward_compatible` 回滚安全,不双重校验)。
- `InteractionRecord`(语义命名,替代 v1 泛名 `Interaction`):`text/intent/status/success/created_at/context_delta/new_messages`。
- `model_config = ConfigDict(extra="allow")`:存量未知 key 必须 round-trip(对齐现 `normalized.update(state)` 语义)。边界:读入 `model_validate`(ValidationError → 空信封 + warning),写出 `model_dump(mode="json")`;`SessionRepo` 签名不动。

## 迁移批次(每批独立绿、独立 revert)
1. **B1 = #663 修复(第一批,owner 已决)**:ports.py 增 `ConversationLog`/`RequestAudit`;`persist_messages` 改收 `messages: ConversationLog | None`、RuntimeAPI 请求日志改收 `request_audit: RequestAudit | None`,调用点由组合根传 `client.messages` / `client.feedback`——getattr 删除。**生产组合根(`_lifespan_build_runtime`)恒传非 None**;`| None` 只允许测试/eval double 使用,生产缺 repo = 组装错误(启动即应暴露),不得再成为一条静默不写路径。测试:先加失败测试钉死 no-op(裸 SupabaseClient 下现行为不写),再修;**集成测试走现有 offline Docker 臂**(`make test-integration` 默认臂):经 fastapi app 走一轮请求后 SELECT `conversation_messages`/`request_log` 断言真实行。上线即开始真实写库(这就是修复本身)——PR 描述标注写入量预期。
2. **B2**:persistence / session_facade / usage_metering / anon_quota 函数签名收窄 Protocol;**删 ports.py 全部 7 个访问器**与这些文件的 `db: object`(去掉 iscoroutinefunction 运行时嗅探——"repo 缺失"由 `| None` 参数显式表达)。
3. **B3**:`RuntimeAPI.__init__` / `handle_public_request` / fastapi_service 四处 `db: object|None` 拆窄参数注入;删 public_api.py:619 `cast(DatabasePort,...)`;`DatabasePort→CatalogLookup` 改名(runner/runtime_deps/null_database 三点)。
4. **B4**:SessionEnvelope——先现网样本 JSON fixture + 双向 round-trip 测试(fixture 须含**缺失 `updated_at`** 与**非法 `updated_at`** 两例,断言其余字段完整存活),再切 `normalize_session_state` / `build_updated_session_state` / context block 构造。与 B1-3 无耦合,可并行。

## mypy strict 影响 / 测试策略 / 风险
- **净收紧**:删 cast(ports.py×5 + public_api×1)、getattr×9(7 访问器内 + 2 裸);`db: object` 28→0(组合根 isinstance 特例除外)。窄 Protocol 让 fake 拼错字段名当场报 mypy 错——收益非成本。加一条结构断言:`SupabaseClient` 各 property 赋值给对应 Protocol 变量(编译期契约,防实现漂移)——**必须放在 mypy 扫描路径内**(Makefile 的 typecheck 只扫 agents/interfaces/domain/infrastructure/clients/tests-eval,**不含 tests/unit**;放 tests/unit = mypy 永远看不到 = 形同虚设。建议做成 infrastructure/supabase 下的 `_protocol_conformance.py` 编译期模块)。
- 测试:B1 集成(Docker 臂真实写入)+ no-op 回归;B2/B3 纯签名重构,靠现有单测 + `make check` 前后各跑;B4 round-trip fixture。变异验证:B1 修复测试须在"还原 getattr"变异下变红。
- 风险:① B1 开始真实写入 conversation_messages/request_log——表结构已存在(repo SQL 即证据),量级=每请求 ≤3 行,可接受但 PR 单独可 revert;② `extra="allow"` 防旧数据,`updated_at` 脏行走容错分支;③ `RequestAudit.insert_request_log` 返回 `str` 而旧调用点忽略返回——Protocol 按实现声明 `->str`,调用点不变。

---
**v1→v2 变更说明**:① 删除 v1 方案 B 的"访问器/helper 接口隔离层"——接口隔离改由窄 Protocol 直接做函数参数类型实现,7 个 `get_*/has_*` 访问器在 B2 全删,聚合 `DatabasePort` 不再扩为 8-property 大 Port,改为组合根解构注入 + `CatalogLookup` 窄聚合。② Protocol 按 bounded context 细化命名(RouteArchive/UsageMeter/AnonQuotaCounter/ConversationLog/RequestAudit/CatalogLookup;Interaction→InteractionRecord),并逐一列出实测方法全集与消费者;修正 v1 的 `insert_message` 参数名错误(`data`→`response_data`)与 `db: object` 计数(27→28,含 ports.py 访问器)。③ #663 由"疑似 bug 先立案"升为**第一批迁移**:typed repo 调用点 + offline Docker 臂真实写入集成测试,行为修复不再拆单独 PR。
