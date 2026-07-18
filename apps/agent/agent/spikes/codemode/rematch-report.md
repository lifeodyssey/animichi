# CodeMode rematch report

Model: `openai:mimo-v2.5@https://api.xiaomimimo.com/v1`  
Paired subset: `5823d5119bfe688578418967bf365283131e3c9f866322058879199521975462` (80 cases)

| Metric | ARM A control | ARM B taught | Paired delta (B−A) |
|---|---:|---:|---:|
| argument_correctness | 0.889 | 0.870 | -0.019 |
| tool_correctness | 0.705 | 0.205 | -0.506 |
| trajectory_match | 0.815 | 0.621 | -0.197 |
| max_tool_calls | 0.821 | 0.308 | -0.519 |
| data_keys_present | 0.756 | 0.744 | -0.013 |
| locale_match | 0.987 | 1.000 | +0.013 |
| nonempty_results | 1.000 | 1.000 | +0.000 |
| step_efficiency | 0.851 | 0.826 | -0.025 |
| request_p95 | 7 | 6 | -1 |
| total_tokens | 748144 | 826863 | +78719 |
| estimated_cost_usd | 0.8142 | 0.9038 | +0.0896 |

## Verdict rubric

- ADOPT: tool_correctness is within 0.01 of control, request_p95 is strictly lower, and estimated cost is no more than 15% higher.
- BENCH AGAIN: correctness clears the 0.01 floor, but request p95 or cost misses the adoption threshold.
- KILL: tool_correctness is more than 0.01 below control.

VERDICT: KILL
