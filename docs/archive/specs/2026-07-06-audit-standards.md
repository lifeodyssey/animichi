# 规范审计报告(opus)——存活代码 CLAUDE.md 规范违反 + 已知债核对

> 只读审计,HEAD c14279d 时点。范围:apps/agent + workers/catalog + packages/contract + worker/;排除 frontend/、tests、typestubs。

## A. 统计

| 规则 | Python(apps/agent) | TS(catalog/contract/worker) |
|---|---|---|
| 文件 >300 行 | **9 个**(532→311) | 0 |
| 函数 >10 行 | **258/594(43%)** | 未测(文件均小) |
| 类 >50 行 | **23 个**(max 304) | n/a |
| dict[str,object] | **226 处 / 50 文件** | n/a |
| Any | **0** ✅ | any:**0** ✅ |
| assert 运行时校验 | **0** ✅ | n/a |
| 裸 str 做 ID | **111 参数,0 NewType** | n/a |
| 裸 except: | 0 ✅(except Exception: 6) | n/a |
| 未审批 suppression | 0 ✅ | 15(全部有正当理由的 no-non-null-assertion) |
| TODO/FIXME | 2 | 0 |

>300 行文件:session_facade.py(532)、public_api.py(496)、clients/base.py(433)、persistence.py(401)、pilgrimage_agent.py(389)、settings.py(341)、cache.py(338)、route_optimizer.py(315)、sql_agent.py(311)。
巨型函数:public_api.py::handle(104)、::_execute_pipeline(101)、route_optimizer.py::build_timed_itinerary(93)、handlers/_helpers.py::optimize_route(85)。
巨型类:BaseHTTPClient(304)、RuntimeAPI(293)、ResponseCache(292)、Settings(289)。

## B. 分级 backlog

### P0(迭代 0/1 前/早期修——信任边界 + 廉价删除)
1. **web_search 无界不可信文本直入 prompt**:web_tools.py:59-65 —— DuckDuckGo title/body/href 裸拼进模型,无定界/转义/长度帽。动作:定界块+字段截断+控制字符剥离。(= SD-19 P0,iter-1 S1.12 已排;此处给出精确坐标)
2. **注入检测 log-only 不拦**:public_api.py:151-158 —— detect_prompt_injection 记警告后照常放行。动作:定拦截路径或文档化接受风险。(= SD-19,S1.12 已排)
3. **guardrails.py 死代码**:check_input_length(L35)/check_coordinates_in_japan(L61)零非测试调用者。动作:接线或删,二选一。(= SD-17 ④,S1.6 已排)

### P1(迭代内 boy-scout)
- 巨型文件/函数/类(见上),最高杠杆:拆 public_api.py(handle/_execute_pipeline)、session_facade.py、BaseHTTPClient——编辑到时顺手拆
- 6× except Exception(route_area_splitter.py:127、services/retry.py:144、public_api.py:206,318、routes/_middleware.py:113、routes/runtime.py:91)——收窄到已知异常类型
- 2 个 stale TODO(persistence.py:124,232 会话压缩/历史 re-enable)——解决或转 issue

### P2(backlog / 专项债卡)
- **dict[str,object] 226 处/50 文件**:工具返回层(9 @tool handlers + catalog_adapter + tool_runtime + repositories)端到端无类型字典。最大结构性债;需专项 typed-payload pass(= S7.8 前置债,与 tool_state 拆分配对;归 Wave-3 agent→Worker 期专项卡,勿 boy-scout)
- **ID 无 NewType(111 处)**:bangumi_id/session_id/user_id/point_id 全裸 str → agents/models.py / domain 引入 NewType
- 15 处 no-non-null-assertion(route.ts 8 + clustering.ts 7):有注释、算法性;可用小 index-guard helper 消除,低优先
- **死 eval 数据集 276KB**:agent_eval_v2.json(226K)、plan_quality_v1.json(39K)、agent_eval_smoke.json、frontend_flows_v1.json——py/Makefile/.github **零引用**(按文件名显式加载,无 glob)。活跃:agent_eval_v3、runtime_journey_v1、translation_v1。确认后删(= SD-30 ⑦ 处置项,+多揪出 agent_eval_smoke)

## C. 已知债核对

| 债项 | 状态 | 位置/备注 |
|---|---|---|
| tool_state dict 混杂;9 工具返回 dict[str,object] | **属实** | runtime_deps.py:38(ponytail 注释已自标);pilgrimage_tools.py/web_tools.py 9 个 handler。归 S7.8/Wave-3 |
| RuntimeDeps/构造器债 | **属实** | runtime_deps.py(deps dataclass 内可变 tool_state+steps);代码内已文档化 |
| guardrails.py 死代码 | **属实** | L35/L61 零调用者 |
| detect_prompt_injection log-only | **属实** | public_api.py:153 |
| web_search 结果无界 | **属实** | web_tools.py:59-65 |
| eval 遗留数据集 | **属实** | 4 个无引用文件 276KB |
| route_optimizer 双路径(新旧 worktree) | **改性质** | 非新旧问题——是**活的双实现**:plan_route→TS catalog route.ts(260 行)via deps.catalog;但 selected-route 旁路(selected_route.py:40→_helpers.py::optimize_route→route_optimizer.py::build_timed_itinerary)仍走 **Python** 优化器。两套排序算法可分歧(与 SD-3① 跨库混读同族病) |

TS 契约侧健康:contract parity 是编译期 TS↔TS 守卫(contract-parity.worker.test.ts);Python 镜像(catalog_client.py)经 sentinel 默认值有意分叉——已文档化,非漂移。catalog 27 src 模块 20 测试文件。无 any,无真实漂移风险。

## D. Top 3 先修推荐

1. **web_search 定界 + 注入拦截决策**(P0 安全对):小、隔离、活过一切架构变化。任何迭代在 agent 上盖楼之前做。
2. **删死面一个 PR**:guardrails 死函数 + 276KB 旧 eval 数据集 + 2 stale TODO。零风险,缩小重建要理解的代码面。
3. **统一双路由实现**:路线逻辑按混合架构归 TS catalog,selected_route.py 也走 deps.catalog,退役 route_optimizer.py(315 行)。在更多 journey 功能落地前消灭这个分歧类。⚠️ 注意与 SD-28 的张力:iter-1 S1.5 的 ×1.3 系数、iter-2 S2.10 拓扑估算的落点都默认 Python 是路线逻辑的家——若采纳本条,落点应改 TS catalog 侧(待用户/评审裁决)。
   dict[str,object] + NewType 两个大 pass 排专项债卡(对齐 Wave-3),勿 boy-scout。
