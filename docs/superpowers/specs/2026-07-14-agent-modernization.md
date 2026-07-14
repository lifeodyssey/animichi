# Spec · Agent 现代化(Wave 0–3)v2

> 2026-07-14。对齐 pydantic 官方推荐(官方 skill `ai:building-pydantic-ai-agents` v1.1.1 +
> `pydantic-ai-harness:pydantic-ai-harness` v0.1.0 + https://ai.pydantic.dev 文档)。
> 用户授权:自主推进到 Wave 3;Codex(gpt-5.6-sol,medium)写全部代码;合并入 `feat/frontend-rebuild`;
> **永不 tag/deploy**。前置:改名 PR #339 已合并,本 spec 以 animichi_* 标识符书写。
> v2 = 双评审(sonnet approve-with-changes F1-F8 + codex xhigh NEEDS-CHANGES P1×10)全量折入。

## 0. 现状基线(实测,2026-07-14;v2 修正)

- 提交态 `pydantic-ai==1.107.0`(W0 工作树已升 2.9.1 待验收);**`pydantic_ai.capabilities`/`Hooks`/`Agent.from_file` 在 1.107 已存在**;harness 包要求 `pydantic-ai-slim>=2.1.0`
- **Agent 构造盘点(穷举)**:模块级 5 个——animichi_agent(**已带 `name="animichi"`**,PR #339)、route_planner_agent(route_area_splitter.py)、translation_agent、eval_feedback_miner、eval_scorer(后 4 个未命名);**另有 `base.py:180-196` 工厂路径创建的未命名生产 agent**(session_facade.py:447+ 在用;sql_agent.py 为死代码消费方)——W1 命名 AC 必须覆盖工厂路径
- animichi_agent:`ToolOutput` ×5 联合输出(**无 `str` 漏洞** ✓)、`output_validator`(携 `type: ignore[arg-type]` @animichi_agent.py:369,W0 探针 2.x 下可否删)、`ModelRetry` 守卫
- **9 个工具注册:animichi_tools.py ×7 / web_tools.py ×2**(catalog_tools.py 是无装饰器 helper 层);import 顺序耦合(animichi_tools.py:10 注释自认,animichi_runner.py:14-19 副作用 import 为环的一部分);**工具真名以注册名为准(QA 工具 = `general_qa`,非 answer_question)**
- 无 `history_processors` 弃用债 ✓;`logfire.instrument_pydantic_ai()` 条件接线(有 token 才启,routes/_deps.py)✓
- 每轮全量加载 9 工具 schema + 全部 instructions(无 progressive disclosure)
- `tool_state` 为 dict 混型(既有坏味道待办)
- 量尺资产:967 单测(85% 覆盖)+ 655-case trajectory eval(nonempty_results 0.846 / tool_f1 0.763 基线);**既有独立入口 `run_agent_eval.py` 与 pytest 汇于 `finish_cli_report`+gate 函数(eval_gate_flow.py)**

## 1. Wave 0 — 全 monorepo 依赖升级(spike 先行)

**In**:apps/agent(uv)、workers/catalog+users(pnpm)、packages/contract、apps/web、根工具链。
**策略(v2)**:按**兼容性家族**(非 package)分批,每家族一个可回退 commit 边界 + 家族门禁:

| 家族 | 成员 | 门禁 |
|---|---|---|
| pydantic 运行时 | pydantic-ai(+extras 变化:2.x 默认 extras 变少)、pydantic、pydantic-evals、logfire instrumentation、双 OpenAI 兼容网关 | make check + 真网关 smoke + 全量 eval(gate 判定) |
| DB 测试基座 | asyncpg 运行时/stub + psycopg2 同步迁移/seed(conftest_db.py:132-196) | 集成测试(需 Docker 时标注) |
| pytest 生态 | pytest、pytest-asyncio(pyproject 有**重复约束**待并)、`--asyncio-mode=auto` | 全量单测 |
| 契约组 | zod + @orpc 全家(contract+catalog+users 三处 exact-pin)+ 三镜像 lockstep + parity 测试 + openapi.json 再生成 | contract 测试 + drift check(格式 churn 允许,语义不动) |
| workers 数据层 | drizzle + @neondatabase/serverless(两个 worker) | **复验 fluent-builder workerd 挂死**(catalog 全 raw sql 的成文原因,api/nearby.ts:45) |
| CF 测试链 | vitest、@cloudflare/vitest-pool-workers、wrangler、miniflare、workerd(lock 中存在多版本共存,全链一起看) | 两 worker 的 test:worker + spike |
| 前端 | apps/web(TanStack)、frontend(legacy,最低成本) | 各自 build+test |

**Spike 定界清单**(实现前先答;✅=已实测):
- ✅ pydantic-ai 2.9.1:make check 全绿零改动;MiMo 网关 OK;DeepSeek wire 格式 OK(402 仅账户余额)
- 2.x release notes 专项:默认 extras 变化是否丢包;**`openai:` 前缀默认切 Responses API**(我们 `_parse_openai_model` 直构 `OpenAIChatModel` 侧步之——加一条测试钉住这个侧步);instrumentation 默认变化 vs 条件接线;output/tool-execution 行为变化过一遍 changelog
- `OpenAIModelProfile(openai_supports_tool_choice_required=False)` hack 的 2.x 形态;`output_validator` 的 `type: ignore` 可否删
- **`pydantic_ai.ui.vercel_ai.VercelAIAdapter`(routes/chat.py,生产流式)**:单测 + 真流各一条
- pytest-asyncio 大版本 vs `--asyncio-mode=auto`;重复约束合并
- drizzle/neon、zod/oRPC、CF 测试链:见家族表
**AC-0(v2 语义)**:各家族门禁全绿;**eval 判定 = 现有 committed gate 对未动基线 pass**(非指标逐位相同;禁止为过升级而刷新基线/放宽阈值——若确需属用户决策);breaking 清单落 PR body;lock 变更按家族分 commit(可回退边界)。
**降级规则(v2)**:某家族 >1 天仍打不平 → "最新兼容版 + 原因注释" pin;**核心依赖(pydantic 家族/契约组)的低于 latest pin = 用户决策点**,工具链小件 lead 可判。

## 2. Wave 1 — 组合面现代化

1. **`name=`**:**全部构造路径**显式命名——模块级 5 个 + `base.py` 工厂路径(工厂签名加 name 参数);AC 含"无未命名 Agent 构造"的守卫测试
2. **工具注册解耦(v2 设计定形)**:工具定义模块**去 agent 依赖**(纯函数 + Tool 描述);agent 构造时显式 `tools=[]`/toolset 注入;runner 可加 per-run toolsets(translation_agent 已示范构造注入)。禁止构造后全局变异。**AST 不变量测试随迁**:`test_agent_upstream_free.py`(`_SEAM_MODULES`/import 形状)与 `test_tools_catalog_wiring` 必须迁移而非弱化(评审重点盯)
3. **Progressive disclosure(v2 收窄)**:**eager 集合固定 = 全部 7 个意图工具(clarify、resolve_anime、search_bangumi、search_nearby、plan_route、greet_user、general_qa)**——clarify 是 ModelRetry 文案 mid-run 指名的恢复出口 + 结构化输出逃生门,greet/general_qa 是首轮路由器(schema 小,defer 无肉);**初始 defer 候选仅 web_search + translate_anime_title**;进一步 defer 需分层 eval 证据(按意图族分层看,聚合 F1 会掩盖)。defer 机制前置:确认 2.9.1 的 tool-search/discovery capability 配置 + 可达性测试(deferred 工具必须可被发现并调用,轨迹测试钉);"收窄引导语"是运行时 ModelRetry 文本,不是 defer 对象
4. **Hooks 横切面**:动态会话状态注入 → `before_model_request`(**幂等性要求:跨 retry/工具环重入不重复注入**);错误遥测 → `on.run_error`;删等价手搓散点
5. **tool_state typed**:dict 混型 → typed deps/state;**保持异构工具结果的序列化边界**。已知触点:evaluators 读 `tool_state["search_nearby"]["row_count"]`、response_builder/_UI_MAP 按 key 路由、`_seed_search_data` 会话回填、SSE payload 镜像
**回退设计**:eager/hooks 行为由单一开关位可回退(feature flag 或等价构造参数)。
**AC-1**:门禁全绿 + eval 无回归(gate 判定,分层报表附 C 族/greet/QA/nearby/route 各层)+ prompt token 对比(度量源 = eval 全集聚合 `RunResult.usage`)入 PR。

## 3. Wave 2 — harness 能力(实证裁决)

| 能力 | 决策 | 说明 |
|---|---|---|
| ManagedPrompt | 引入(**默认本地权威**) | 见下方失败契约 |
| CodeMode | 仅 spike(**预注册判据**) | 见下方判据 |
| SubAgents/Planning/compaction | 观望 | experimental,不进生产 |
| FileSystem/Shell | 排除 | 违背 upstream-free 信条(AST 测试强制) |

**ManagedPrompt 失败契约(v2)**:检入 prompt = **fail-closed 默认权威**;远端解析仅在显式开启时参与;逐类测试:无 token、DNS 失败、超时、401/403、5xx、远端空值;回退延迟有界;记录 resolved prompt 来源+版本;生产 label 固定;**env kill switch 一键禁远端**。**默认字节等同**:env 回退与 managed 内容 test-pin 相等(instructions 载 SD-19 注入防御,不许两份漂移)。**启用"远端可改生产 prompt"本身 = 用户决策**(prompt 变更绕过部署是治理变更,非 ops 细节)。
**CodeMode spike 判据(v2 预注册)**:固定 benchmark 层 = 多番对比查询 case 集(spike 前列名);重复 ×3;基线不动;判"采"需同时满足:模型往返次数 ↓≥40% + 中位延迟不劣化 + 契约/安全零回归;任一 miss 或出现安全/契约回归 → 立即弃。spike-only 本身即回退故事。
**AC-2**:上述契约各有测试;CodeMode 结论(采/弃)带预注册判据对照表。

## 4. Wave 3 — eval 官方化(吸收任务 #9;**取代 DD-23**)

> **决议变更记录**:2026-07-06 rebuild spec 的 DD-23 冻结了 pydantic-evals 迁移;用户 2026-07-14 明示按官方 evals 标准重写(本 spec §前言),**本节正式取代 DD-23**;随本 wave 在 rebuild spec 的 DD-23 处加注 supersession 指针。

- **改造既有缝,不另起炉灶**:`run_agent_eval.py` 已是独立入口,与 pytest 汇于 `finish_cli_report` + gate 函数——W3 重接此缝:官方 `dataset.evaluate()`、**流式逐 case 进度**、报告落盘、gate 复用 `gate.py`/`eval_gate_flow.py`(**禁止第二套 gate 实现**)
- **gate 等价性 = 冻结 fixture 黄金测试**:同一录制 results payload + 基线喂新旧入口,断言 failure 列表与 exit code 逐位一致;用例须覆盖:pass、指标回归、错误率触发、基线缺失/过期、capped run、首次建基线、各 exit code
- 过渡期:旧 Make/pytest 入口保留为兼容别名或 report-only 双跑一个过渡期后移除
- Dataset 序列化对齐官方;evals OTel 轨迹进 Logfire;TestModel/FunctionModel 补确定性行为单测层
- **密封性修复覆盖全部 eval 面**:`make test` 不受 `.env` 影响(修 translation gate 直连网络洞,含 test_translation.py:31 路径)
**AC-3**:黄金测试全数落地;流式进度可见;密封性验证(有/无 .env 双态跑 make test 同绿)。

## 5. 红线(全程;v2 澄清)

- LLM 不产出坐标;`nearby`/`search` 契约**语义**不动(openapi 格式性 churn 允许,drift check 绿为前提);覆盖率只升不降
- **抑制条款语义:禁新增任何 suppression;所触碰代码中可证废弃的既有 suppression(如 2.x 下多余的 type: ignore)应顺手移除**;既有未触碰的不强制清扫
- 每 wave 独立 PR;lead 三步核验 + 双评审(sonnet + Codex xhigh);每 wave 有明确回退面(W0 家族 commit 边界 / W1 开关位 / W2 本地 prompt 权威 / W3 旧入口别名)
- 基线刷新遵循 [[eval-run-recipe]]

## 6. 用户决策点(遇到即停;v2 扩)

tag/deploy;新 secret/生产配置落地;架构转向(如 CodeMode 全面接管编排);**Python 版本地板抬升**;**核心依赖接受低于 latest 的兼容 pin**;**eval 基线刷新/阈值变更(为过升级)**;**启用远端可改生产 prompt(ManagedPrompt 远端开启)**;单 wave 花费超常规(eval ~¥2/次为常规)。
