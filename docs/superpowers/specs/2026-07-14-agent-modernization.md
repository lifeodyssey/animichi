# Spec · Agent 现代化(Wave 0–3)

> 2026-07-14。对齐 pydantic 官方推荐(官方 skill `ai:building-pydantic-ai-agents` v1.1.1 +
> `pydantic-ai-harness:pydantic-ai-harness` v0.1.0 + https://ai.pydantic.dev 文档)。
> 用户授权:自主推进到 Wave 3;Codex(gpt-5.6-sol,medium)写全部代码;合并入 `feat/frontend-rebuild`;
> **永不 tag/deploy**。前置:改名 PR(pilgrimage_agent→animichi)已先行,本 spec 以改名后的标识符书写。

## 0. 现状基线(实测,2026-07-14)

- `pydantic-ai==1.107.0`;**`pydantic_ai.capabilities`/`Hooks`/`Agent.from_file` 已存在**(晚期 1.x 铺回了 2.x 组合面);harness 包要求 `pydantic-ai-slim>=2.1.0`
- 4 个 Agent(animichi_agent / route_planner_agent / translation_agent / eval×2)**均未传 `name=`**
- animichi_agent:`ToolOutput` ×5 联合输出(**无 `str` 漏洞** ✓)、`output_validator`、`ModelRetry` 守卫
- 9 个 `@animichi_agent.tool` 跨文件装饰器注册(animichi_tools.py / catalog_tools.py / web_tools.py),import 顺序耦合(文件头注释自认)
- 无 `history_processors` 弃用债 ✓;`logfire.instrument_pydantic_ai()` 已接(interfaces/routes/_deps.py)✓
- 每轮全量加载 7+2 工具 schema + 全部 instructions(无 progressive disclosure)
- `tool_state` 为 dict 混型(既有坏味道待办)
- 量尺资产:967 单测(85% 覆盖)+ 655-case trajectory eval(nonempty_results 0.846 / tool_f1 0.763 基线)

## 1. Wave 0 — 全 monorepo 依赖升级(spike 先行)

**In**:apps/agent(uv:pydantic-ai→2.x 最新、pydantic、pydantic-evals、logfire、fastapi、httpx、pytest、ruff、mypy…)、workers/catalog+users(pnpm:drizzle、vitest、wrangler、eslint、tsc…)、packages/contract(zod/oRPC)、apps/web、根工具链。
**策略**:按 package 分组升级 + 分组门禁;升不动的记录原因后 pin(pin 必须带注释)。
**Spike 定界清单**(实现前先答):
- pydantic-ai 2.x breaking:`OpenAIModelProfile(openai_supports_tool_choice_required=False)` hack 的 2.x 形态;`@agent.tool`/`ToolOutput`/`output_validator` API 变化;`resolve_model` 所依赖的 provider 构造
- MiMo/DeepSeek OpenAI 兼容网关对 2.x 请求形状的容忍度(实测各一条)
- vitest/wrangler/miniflare 大版本 breaking(workerd pool 测试形态)
**AC-0**:各组门禁全绿;agent 全量单测 + 全量 eval 无回归(gate 判定);breaking 清单落 PR body;`uv.lock`/`pnpm-lock.yaml` 一次性提交。
**风险**:2.x 未知面 → spike 不过夜:如某组升级代价爆炸(>1 天),该组降级为"最新兼容版 + 原因注释",不阻塞后续 wave。

## 2. Wave 1 — 组合面现代化

1. **`name=`**:全部 Agent 显式命名(`animichi`/`route_planner`/`translation`/`eval_scorer`/`eval_feedback_miner`)——Logfire span 可辨识
2. **工具注册解耦**:跨文件装饰器 → 显式 toolset/`tools=[]` 注入;消灭 import 顺序耦合;模块可独立测试
3. **Progressive disclosure**:逐工具评估 `defer_loading`——候选:greet_user/answer_question(长尾)、clarify 说明书、geocoding 收窄引导语(专家上下文);**每项以 eval 实证**(意图路由指标不得回归,预期 C 族 clarify 指标改善 + prompt token 下降可测)
4. **Hooks 横切面**:动态会话状态注入 → `before_model_request`;错误遥测 → `on.run_error`;删等价手搓散点
5. **tool_state typed**:dict 混型 → typed deps/state(既有待办并入)
**AC-1**:门禁全绿 + eval 无回归 + prompt token 对比数据(before/after)入 PR。

## 3. Wave 2 — harness 能力(实证裁决)

| 能力 | 决策 | 说明 |
|---|---|---|
| ManagedPrompt | 引入 | instructions 交 Logfire 管理;**若需新 secret/prod 配置 → env 可选回退,ops 步骤写 PR body 留用户执行** |
| CodeMode | 仅 spike | 场景:多番对比查询(gather 并行);eval 实证不划算即弃,证据入 PR |
| SubAgents/Planning/compaction | 观望 | experimental,不进生产 |
| FileSystem/Shell | 排除 | 违背 upstream-free 信条 |

**AC-2**:ManagedPrompt 有回退路径且默认行为不变;CodeMode spike 结论(采/弃)带 eval 数据。

## 4. Wave 3 — eval 官方化(吸收任务 #9)

- 独立 runner(`python -m agent.evals …`):官方 `dataset.evaluate()`,**流式逐 case 进度**,报告落盘,gate 为 post-step 出 exit code
- Makefile `test-eval*` 改接 runner;pytest 侧仅留薄冒烟
- Dataset 序列化对齐官方 Dataset Management;evals OTel 轨迹进 Logfire(instrumentation 现成)
- TestModel/FunctionModel 补确定性行为单测层(工具路由不再花 eval 钱)
**AC-3**:runner 跑通全量 eval 且 gate 语义与现 gate.py 等价(同基线同判定);进度流式可见;`make test` 密封性不受 `.env` 影响(顺手修 translation gate 直连网络的密封洞)。

## 5. 红线(全程)

- LLM 不产出坐标;`nearby`/`search` 契约不动;无任何 lint/type/test 抑制;覆盖率只升不降
- 每 wave 独立 PR;lead 三步核验(git ground truth + 防篡改读测试 + 独立重跑全量门禁)+ 双评审(sonnet + Codex xhigh)
- 基线刷新遵循 [[eval-run-recipe]](MIMO_API_KEY 域名映射、.env 双刃、schema-v2 转换)

## 6. 用户决策点(遇到即停)

tag/deploy、新 secret/生产配置落地、架构转向(如 CodeMode 全面接管编排)、单 wave 花费超常规(eval ~¥2/次为常规)。
