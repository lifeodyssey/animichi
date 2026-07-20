# Held-out generalization suite (`agent_eval_heldout_v1`)

**Purpose.** Prove the agent-behavior optimizations of the last arc — current-turn
locale policy (#361), translation-retrieval guards (#361), the repeat-guard
(#403), and disambiguation convergence + backstop (#405) — **generalize** to
unseen content rather than overfitting the specific cases they were tuned on
(the エヴァ / 君の名は。 anchors).

**Design.** 33 cases spanning the four optimized behavior families, authored with
**genuinely different content** — anime and query phrasings that the fixes never
saw. Overused dataset anchors (君の名は。, 響け！ユーフォニアム, エヴァ, ガンダム,
Fate, 涼宮ハルヒ …) are deliberately avoided. Nine cases use **recent 2025-2026
titles** (ダンダダン, メダリスト for the resolve path; SAKAMOTO DAYS, 全修 for the
not-found path) — a held-out in *time* as well as content.

| Family | n | Content |
|---|---|---|
| locale (query-script ≠ session-locale) | 10 | 氷菓 / らき☆すた / 推しの子 / ダンダダン / メダリスト × ja·zh·en |
| translation-retrieval (zh/en/romaji/abbrev) | 8 | 氷菓 / らき☆すた / 推しの子 / ダンダダン / メダリスト |
| disambiguation convergence (not-found → clarify) | 11 | 名探偵コナン / ポケモン / マクロス / テニス / ペルソナ / 銀魂 / 夏目 / Attack on Titan / SAKAMOTO DAYS / 全修 |
| switch-anime (post-resolve, no wandering) | 4 | 氷菓 / らき☆すた / ダンダダン / メダリスト |

**How to run** (report-only — must NOT overwrite the canonical baseline, which is
keyed by layer+model, not dataset name):

```bash
# Back up the canonical trajectory baseline first; this run overwrites it.
cd apps/agent
cp agent/tests/eval/baselines/agent_l4_trajectory_*.json /tmp/canon.bak
EVAL_DATASET=agent_eval_heldout_v1.json \
  uv run python -m agent.tests.eval.run_agent_eval
cp /tmp/canon.bak agent/tests/eval/baselines/agent_l4_trajectory_*.json  # restore
```

**Verdict (2026-07-20 run, live MiMo).** Generalization confirmed — held-out
aggregate meets or beats the canonical 662-case baseline on every metric:

| metric | held-out (33) | canonical baseline |
|---|---:|---:|
| tool_correctness | 0.94 | 0.75 |
| trajectory_match | 0.98 | 0.85 |
| max_tool_calls | 0.94 | 0.93 |
| locale_match | 0.97 | 0.97 |
| argument_correctness | 1.00 | 0.87 |
| data_keys_present | 0.97 | 0.73 |

All nine 2025-2026 titles generalize cleanly. `step_efficiency` on clarify cases
is a structural 0.50 (resolve + clarify = 2 steps vs an ideal of 1) and matches
the baseline — not a regression.

**Known residual (tracked, not chased).** `HO_conv_en_003` (Attack on Titan, en)
answers as general_qa instead of clarifying and burns an extra tool call — the
one behavioral soft spot. It is an outlier (10 / 11 convergence cases converge to
a single tool call, including all three 2025-2026 not-found titles), likely a
famous-franchise over-eagerness in MiMo. Deliberately **not** patched: tuning a
fix to one case would be the very overfitting this suite exists to prevent.
