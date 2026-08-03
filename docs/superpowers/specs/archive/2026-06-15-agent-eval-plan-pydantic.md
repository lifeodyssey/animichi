# Agent Eval 完整方案(pydantic-evals 版)

> 2026-06-15。**取代** `2026-06-13-agent-eval-spec.md` 里"用 Evalite/Vitest 手搓"的部分
> ——决策已改:后端暂留 PydanticAI(pydantic-evals 是成熟一方套件,617 案例已是其格式),
> TS 重写后置到 MiMo 额度花完之后。
> 依据:Anthropic Demystifying Evals · τ-bench · Hamel Husain · Google ADK · pydantic-evals 文档。

## 0. 为什么留 PydanticAI 做 eval
- pydantic-evals = 一方成熟套件(数据集/4 类评估器/LLM judge/并发重试/Logfire+OTel)
- Vercel AI SDK **无一方 eval 套件**(只能手搓 Vitest 或买 Braintrust)
- 617 案例 + baseline 已是 pydantic-evals 格式,现在就能跑
- 解耦:花额度跑 eval(要成熟套件)≠ TS 重写(理由是基建,跟 eval 无关)

## 1. 四层模型(诊断金字塔)

| 层 | 测什么 | 指标 | 判分 | 频率 |
|---|---|---|---|---|
| L1 组件 | 单工具:选对没、参数齐没 | Tool Precision/Recall/F1、data-keys 命中 | 确定性(免费) | 每 PR |
| L2 轨迹 | 工具序列:顺序、冗余 | In-Order / Any-Order、Step Efficiency | 确定性(免费) | 每 PR |
| L3 结果 | 任务成没成、有没有编造 | Task Completion、Hallucination、pass^k | LLM judge(花钱) | 每日/部署前 |
| L4 多轮 | 跨轮约束保持、澄清后续 | Context Retention | LLM judge(花钱) | 定期 |

公式(可抄):
```
ToolF1 = 2PR/(P+R)   P=|实调∩期望|/|实调|   R=|实调∩期望|/|期望|
StepEfficiency = min_steps / actual_steps
pass^k = 同一 case 跑 k 次全过才算过(τ-bench;测可靠性,非峰值)
```

## 2. 指标重构(6 烂 → 分层清晰)

| 删/改 | 新指标 | 层 | 判分 |
|---|---|---|---|
| 删 MessageQuality / ToolExecution(永远满分) | — | — | — |
| 拆 IntentMatch | ToolCallRecall + RouteOrderCorrect | L2 | 确定性 |
| 改 DataCompleteness | DataKeysPresent(Contains expected_data_keys) | L1 | 确定性 |
| 改 ResponseLocale | LocaleMatch(语言检测库) | L1 | 确定性 |
| 改 StepEfficiency | 实际步数/最少步数 公式 | L2 | 确定性 |
| 新增 | TaskCompletion(judge) | L3 | LLM judge |
| 新增 | HallucinationCheck(judge:坐标/bangumi_id/地点名是否编造) | L3 | LLM judge |

## 3. pydantic-evals 实现映射

确定性层用自定义 Evaluator(从 `ctx.metadata.acceptable_stages` / `expected_data_keys`
比对;工具调用序列从 `ctx.output.steps`/`all_messages()` 提取,或配 Logfire 后用
`ctx.span_tree` + `HasMatchingSpan`)。骨架:

```python
@dataclass
class ToolCallRecall(Evaluator):
    def evaluate(self, ctx) -> dict:
        expected = set(ctx.metadata.get("acceptable_stages", []))
        actual = _extract_tool_names(ctx.output)        # from steps/spans
        if not expected: return {"tool_recall": 1.0}
        hit = expected & actual
        P = len(hit)/len(actual) if actual else 0.0
        R = len(hit)/len(expected)
        return {"tool_recall": R, "tool_precision": P,
                "tool_f1": 2*P*R/(P+R) if P+R else 0.0}
```

L3 用内置 `LLMJudge`,**judge 模型走 DeepSeek**(稳定),rubric 二元 pass/fail:

```python
task_completion = LLMJudge(
    rubric="""判断响应是否满足巡礼意图(全满足→pass,任一不满足→fail+原因):
    1 地点属于所查作品  2 语言与 query 一致  3 不编造 bangumi_id/地点名
    4 有路线需求时已 plan_route""",
    model="deepseek:deepseek-chat",
    include_input=True, include_expected_output=False,
    model_settings=ModelSettings(temperature=0.0),
)
dataset = Dataset(cases=[...], evaluators=[task_completion])  # 数据集级对所有 case
report = await dataset.evaluate(run_agent, max_concurrency=5)
report.print(baseline=Dataset.from_file("evals/baseline.json"))  # 回归对比
```

CI 闸:
```python
s = report.averages()
assert s["tool_recall"] >= 0.85           # L2 不退
assert s["task_completion_pass"] >= 0.70  # L3 不退(初值由首跑定)
```

## 4. MiMo 额度怎么花(7月底前)

确定性层免费;**MiMo 只花在两件"要跑很多次"的事**:

1. **生成对抗/负面案例**(治"几乎全 happy-path"):MiMo 批量从种子案例生成难例
   ——续集混淆("ユーフォ"vs"リズ")、地名歧义、跨语言混合查询。生成后**人工抽验 10%**
   确认是合理难例而非噪声。打 `tier=adversarial`。
2. **pass^3 稳定性**(治"跑一次不算数"):核心路径(search+plan)同 case 跑 3 次,
   全过才算过。这步烧 token,正是额度该去处。
   - judge 用 DeepSeek(质量稳);agent 跑可选 DeepSeek 或拿 MiMo 当第二 agent 模型 A/B。

## 5. judge 校准(别让阅卷老师骗你)
- 50 条 golden set 人工标 pass/fail → 和 judge 比 Cohen's κ,**目标 ≥0.8**
- κ 0.6-0.8 → 迭代 rubric;judge 温度 0;模型/prompt 变更后重测(防漂移)

## 6. 落地顺序(价值优先,懒到位)
1. **重写评估器为四层**(半天,全确定性,免费)→ 立刻可诊断,6 烂指标退役
2. **加 L3 task-completion judge(DeepSeek)+ 50 golden 校准 κ≥0.8**
3. **MiMo 生成对抗案例**补进数据集(花额度①)
4. **核心路径 pass^3**(花额度②)
5. baseline 落盘 + CI 闸;按数据集分报,**禁单一总分**,失败 case 带 Logfire trace

## 7. 不做(全套 best practice 有,但对 solo+额度过期不值)
golden trajectory 逐条人工标注 · 模拟用户多轮对话自动生成 · 序贯统计检验 ·
L4 多轮的大规模数据集(先留几条手写的关键多轮 case 即可)

## 来源
Anthropic Demystifying Evals · τ-bench(arXiv:2406.12045)· Hamel Husain evals-faq ·
Google ADK Trajectory/Response Evaluator · pydantic-evals 文档(built-in/custom/llm-judge/reporting)
