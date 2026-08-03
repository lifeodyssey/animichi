# Agent Eval Spec — 拿来即用版(按段评估)

> 状态:DRAFT(2026-06-13)。基于:① agent 代码解剖(事实)② Agent Eval 业界最佳
> 实践调研(Anthropic Demystifying Evals / τ-bench / Hamel Husain / Confident AI,
> 来源见会话记录)③ 现有资产(617 案例、baselines:IntentMatch 54%、
> ResponseLocale 60%、Translation 72.6%)。
> 本 spec 同时适用于现 Python 栈与 TS 迁移(parity gate 的判分器)。

## 1. Agent 解剖(代码事实,回答"分了哪几段、是不是 ReAct")

**形态:typed tool-calling loop**(PydanticAI)——ReAct 的现代后裔:没有显式
"Thought:" 草稿,推理由函数调用承载;**最终输出本身也是一次工具调用**
(5 个 ToolOutput 之一:clarify/search/route/qa/greeting)。`retries=2`。

| 段 | 内容 | 性质 | 代码位置 |
|---|---|---|---|
| S0 入口守卫 | 长度上限 2000 · 注入检测(log-only) | 确定性 | guardrails.py |
| S1 意图路由 | LLM 第一步选工具(7 选 1) | **LLM** | pilgrimage_agent 指令 |
| S2 实体解析 | resolve_anime:标题→subject_id;歧义→clarify(候选经 tool_state 跨轮恢复) | LLM 参数 + 确定性 handler | pilgrimage_tools.py:170 |
| S3 检索 | search_bangumi / search_nearby(给定参数后确定性) | 确定性 | retriever.py |
| S4 规划 | plan_route handler:聚类(union-find 50m)+ 最近邻排序 + TimedItinerary | **纯算法,零 LLM** | route_optimizer.py |
| S5 合成 | 最终 typed output:文案、语言(locale 注入 @instructions) | **LLM** | pilgrimage_agent.py:295 |
| S6 输出守卫 | output_validator 反编造(search 响应必须真调过 search 工具;route 必须调过 plan_route→ModelRetry)+ 坐标日本框 + translation gate | 确定性 | pilgrimage_agent.py:351 |
| S7 多轮状态 | tool_state 种子(resolve_candidates/pending_clarify/last_search/origin)+ 历史压缩(_compact_tool_results + _sliding_window) | 混合 | pilgrimage_runner.py |
| 旁路 | execute_selected_route(勾选重排) | 零 LLM | selected_route.py |

**治乱第一刀**:S4/S6/旁路是纯代码——**它们根本不该进 LLM eval**,用 Vitest 单测
覆盖(顺序最优性对照暴力解、时刻算术、validator 触发矩阵)。现有 plan_quality
数据集中属于 S4 确定性的部分全部单测化。

## 2. 分层映射(业界金字塔 × 我们的段)

```
End-to-End ──── 任务完成率(TCR)· pass^2 一致性 ──── 全链
Trajectory ──── Tool Call F1 · 步数效率 · 无循环 ──── S1 + 工具序列
Component ───── 单工具精确指标 ──────────────────── S2 / S3 /(S4→单测)
Multi-turn ──── 澄清后续轮正确性 · 状态保持 ──────── S7
```

Anthropic 原则:**先评产出,再评路径**——trajectory 只在产出失败需要归因时看,
不惩罚等效但不同的工具序列(宽松序匹配)。

## 3. 每段 Eval 规格(核心交付,每行可直接建文件)

| 段 | 数据集 | case 字段 | 指标(公式) | 判分 | 阈值(=现 baseline,棘轮只升) | 跑频 |
|---|---|---|---|---|---|---|
| S1 | `intents.jsonl` | id, input, locale, expected_first_tool, golden_tools[], tags | first-tool acc;Tool Call F1 = 2PR/(P+R),P=∩/agent 调用数,R=∩/golden 数(宽松序) | 确定性 | acc ≥ **0.54**(IntentMatch 现状) | PR(子集)/日(全量) |
| S2 | `resolve.jsonl` | title_query, expected: subject_id 或 "clarify", acceptable_candidates[] | resolve 精确命中率;clarify 触发 precision/recall(歧义集必须触发、唯一集不得触发) | 确定性 | 命中 ≥0.85;clarify P/R 各 ≥0.8(新测,首跑定基线) | PR |
| S3 | `retrieval.jsonl` + fixture DB(seed.sql) | params, expected_point_ids[] | recall@k | 确定性 | ≥0.95(给定参数后应近乎确定) | PR |
| S4 | **无 eval 集** | — | 顺序最优性(≤10 站对照全排列精确解)、TimedStop 算术、物語順 ep/s 缺失降级、墓碑排除 | Vitest 单测 | 100% pass | 每 PR |
| S5a | `locale.jsonl` | input, locale, expected_lang | 语言检测库判定(非 judge) | 确定性 | ≥ **0.60**(ResponseLocale 现状) | PR |
| S5b | `faithfulness.jsonl` | input, tool_returns(录制), response | **二元 judge**(rubric 见 §4) | LLM judge | unfaithful 率 ≤5%;judge κ ≥0.7 方可启用 | 日/release |
| S5c | `translation.jsonl`(现 72.6%) | 沿用 + **3 个已知 bug 模式各固化为 regression cases** | 现指标沿用 | judge | ≥ **0.726** | 日 |
| S6 | **无 eval 集** | — | validator 触发矩阵(伪造 search/route 响应→必须 ModelRetry)、注入样本 log、坐标框 | Vitest 单测 | 100% | 每 PR |
| S7 | `dialogues.jsonl` | 脚本化多轮:turns[], 每轮 expected;关键检验:**澄清轮之后那一轮是否用了更新后的约束** | 逐轮确定性 + 终态校验 | 确定性为主 | 首跑定基线 | 日 |
| 轨迹 | `golden_trajectories.jsonl` | instruction, golden_tools[](标注严格序/宽松序), end_state | Step Efficiency = golden 步数/实际步数;Loop Rate;pass^2(同 case 跑 2 次须全过) | 确定性 | 效率 ≥0.7;loop=0;pass^2 smoke 全过 | 日 |

负样本配额:**每个数据集 ≥20% 负例**(查无此番、0 圣地、注入文本、空工具返回)——
只测 happy path 是排名第一的反模式。

## 4. Faithfulness Judge Rubric(全文,可直接用)

```
你是一个严格的事实验证员。任务:判断 agent 回复是否完全基于工具返回的结果。
【输入】工具调用列表及其返回值(context);agent 最终回复(response)
【步骤】
1. 列举 response 中所有具体事实声明(数字、地名、话数、时刻、比较)
2. 对每条声明,在 context 中找到明确支持句
3. 任何声明无法找到直接支持 → 判为 unfaithful
【输出 JSON】{"verdict":"faithful|unfaithful","unsupported_claims":[…],"reasoning":"…"}
边界:工具返回为空→所有外部声明均不忠实;有依据的拒答→忠实。
```

Judge 纪律:**二元判定**(与人类一致率高于 1-5 分制);一维一 rubric;禁
"use your judgment";judge 模型版本+温度 0 锁定;**金集校准**:30-50 条人工标注,
Cohen's κ ≥0.7 方可上线,κ 季度复测(防 judge 漂移);judge 调用过 AI Gateway
(重复案例语义缓存)。

## 5. 数据集重组(617 案例迁移映射)

```
backend/tests/eval/        →  evals/
  agent_eval_v2.json       →  archive/(废弃归档)
  agent_eval_v3.json       →  拆:intents / resolve / golden_trajectories
  translation_v1.json      →  translation(+3 bug 模式 regression 化)
  plan_quality_v1.json     →  S4 确定性部分→Vitest 单测;主观部分→E2E judge
  runtime_journey_v1.json  →  dialogues / E2E
新增:locale / faithfulness(录制工具返回)/ regression(一 bug 一 case 永不删)
统一 schema:{id, layer, stage, input, expected, tags:{source: synthetic|real|regression, difficulty}, locale}
每数据集一个 README:测什么/阈值/跑频/owner 指标。
```

## 6. CI 接线

- **fast gate(每 PR)**:S1-S3/S5a 确定性子集(~150 条)+ S4/S6 单测;
  统计:二项式 95% CI 下界 ≥ baseline − 2pp
- **slow gate(每日 + release)**:全量含 judge;统计:bootstrap 1000 次重采样,
  降幅 >3pp 且显著 → block;judge 案例 3 次多数票抗 flaky
- **报告纪律**:分数按数据集分报,**禁止单一总分**;每个失败 case 附 Logfire trace 链接
- **parity gate(迁移)**:TS 栈每数据集 ≥ Python baseline(同统计标准),逐数据集放行
- 序贯检验:<300 样本不依赖大数定律,样本充分即提前停

## 7. 反模式守则(贴墙)

总分掩盖(已禁)· judge 漂移(版本锁+κ复测)· 过拟合 eval 集(real/synthetic 分标,
定期补真实失败)· 只测 happy path(20% 负例配额)· 路径过刚性(宽松序默认)·
**Transcript blindness——每周人工读 10 条 trace,机器分数不能替代眼睛** ·
单次运行下结论(smoke 跑 pass^2)· 先写 evaluator 后看真实失败(生产失败→case 优先)

## 8. 四周落地排期

1. **W1**:数据集重组(§5,半天)+ S4/S6 单测化 + 每工具 20 条确定性 case
   (正确参数 ×1 + 错误参数 ×2 + 空返回 ×1)
2. **W2**:50 条 golden trajectories(5 意图 × 正常/边界各 10)→ Tool Call F1 跑通
3. **W3**:Faithfulness judge + 30 条金集校准至 κ ≥0.7
4. **W4**:CI fast/slow gate 上线;Python baseline 全量落盘 → parity gate 待命
5. **持续**:每个生产失败 → regression case(永不删)
