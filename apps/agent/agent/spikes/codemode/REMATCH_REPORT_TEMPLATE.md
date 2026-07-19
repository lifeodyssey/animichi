# CodeMode rematch report

Model: `<model-id>`  
Paired subset: `<sha256>` (`<case-count>` cases)

| Metric | ARM A control | ARM B taught | Paired delta (B−A) |
|---|---:|---:|---:|
| argument_correctness | `<A>` | `<B>` | `<B−A>` |
| tool_correctness | `<A>` | `<B>` | `<B−A>` |
| trajectory_match | `<A>` | `<B>` | `<B−A>` |
| max_tool_calls | `<A>` | `<B>` | `<B−A>` |
| data_keys_present | `<A>` | `<B>` | `<B−A>` |
| locale_match | `<A>` | `<B>` | `<B−A>` |
| nonempty_results | `<A>` | `<B>` | `<B−A>` |
| step_efficiency | `<A>` | `<B>` | `<B−A>` |
| request_p95 | `<A>` | `<B>` | `<B−A>` |
| total_tokens | `<A>` | `<B>` | `<B−A>` |
| estimated_cost_usd | `<A>` | `<B>` | `<B−A>` |

## Verdict rubric

- ADOPT: tool correctness is within 0.01 of control, request p95 is strictly lower,
  and estimated cost is no more than 15% higher.
- BENCH AGAIN: correctness clears the 0.01 floor, but request p95 or cost misses.
- KILL: tool correctness is more than 0.01 below control.

VERDICT: `<ADOPT | BENCH AGAIN | KILL>`
