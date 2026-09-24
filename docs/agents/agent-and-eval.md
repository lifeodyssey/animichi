# Agent tier and eval — what the specs do not say

Read before touching `workers/edge/src/agent/`, `packages/agent/` or `packages/eval/`. The target
architecture is `docs/specs/2026-09-09-agent-on-pi-harness-spec.md`; the runnable eval is
`packages/eval/NATIVE.md`. This file keeps the owner's reasoning and the traps those documents do
not record.

## The best-practice source for agent design (owner, 2026-09-05)

The owner designated 李博杰《深入理解 AI Agent：设计原理与工程实践》(Apache 2.0, GitHub
`bojieli/ai-agent-book`, chapters under `book/chapterN.md`) as the best practice to design and
review the agent against: "按照他的书作为 best practice". Chapter map: 1 入门 · 2 上下文工程 ·
3 用户记忆/知识库 · 4 工具 · 5 Coding Agent · 6 交互 · 7 评估 · 8 后训练 · 9 持续进化 · 10 多 Agent.
Chapter 2's three principles bind the harness work:

- KV-cache discipline: the static prefix stays put, dynamic information is appended at the end,
  nothing in the middle is rewritten. Named anti-patterns: a dynamic system prompt, a sliding
  window that drops tool results (it causes repeated-call loops), flattening structured messages
  to plain text.
- The agent status bar: explicit state the code maintains (task progress, constraint checks, an
  environment summary) is appended as a user-role message at the end, never put into the system
  prompt.
- Compaction targets historical tool results, runs between two calls, and runs in batches near
  the threshold rather than every turn. The first production layer is a tool-result budget: large
  outputs go to disk with a preview, and the replacement string is frozen at its first occurrence.

Chapter 7 (evaluation environments, trajectory-prefix regression tasks, verifiers) is the
reference for eval design. The harness spec already cites the book; a spec or review that departs
from it says why.

## The eval's system under test is the agent (owner, 2026-09-09)

The owner asked the test-pyramid question ("eval 也是一种测试……System under test 是什么东西？")
and settled it: the SUT is the agent (system prompt, tool definitions, the loop, the model call).
Access, Neon Auth, rate limits, Durable Object persistence and the CD path are not under test;
they belong to integration tests and smoke. The harness spec (§4.1) and `packages/eval/NATIVE.md`
build on this: the task runs `createPilgrimageHarness` in process with a `MemorySessionRepo`; there
is no gateway, staging login or QA identity in the path.

Why it was settled that way: the previous eval drove the deployed staging endpoint, which needed a
QA identity, hit the per-identity rate limit, could not test a PR's candidate code, and took 2.4–4
hours for 662 cases, all downstream of the wrong SUT. Two consequences still hold: concurrency is
bounded only by the model provider ("并发可以超级加大"), and the deployed staging is allotted one canary case
in smoke/e2e, not the suite.

## Evaluator traps (2026-09-06, #1439)

A metric that scores "did nothing" as perfect. Two structural causes were found in one run: a
step-efficiency evaluator with an `actual === 0 → 1.0` branch, and an accepted-trajectory list that
handed five cases an empty chain, so a turn that called no tool matched perfectly and a turn that
did the work scored 0. Those 1.00s went into the committed baseline. Before writing a mutation
criterion of the form "turn X off and the score must drop", confirm the evaluator cannot award a
high score to doing nothing. The metrics that did discriminate were categorical
(`max_tool_calls`, `data_keys_present`, `nonempty_results`); prefer those shapes.

Two `logfire/evals` (0.22.x) traps, 2026-09-08: `task_duration` is a `performance.now()`
difference around the task call, so any queueing the task awaits is counted in it; and
`setEvalAttribute` after the task's first `await` may not land, because the run state is loaded
lazily. Capture the task run state at the start of `run()` and write `state.attributes` directly.
An attribute set the late way silently vanished across a multi-case run.

## Model facts (re-probe before relying on them)

- Never conclude from a subset. A 30-case sample showed MiMo v2.5 ahead of the baseline by
  0.11–0.19 on every metric; the full run inverted the verdict (tool metrics 3–4 points lower,
  68% cheaper). A progressive eval reports a verdict only at full size (retired harness, 2026-07-13).
- Weaker models double-encode structured tool arguments (a list arrives as a JSON string) and
  ignore retry feedback (three retries, the same string, only punctuation changed). Coerce at the
  validation boundary; a prompt fix is not reliable. The coercion took that model's error count
  from 54 to 8 and its completion rate from 91.7% to 98.8% (retired harness, 2026-07-13). Check for this when
  onboarding any model outside the two large vendors.
- `mimo-v2.5` accepts `image_url` input (a data-URL 1×1 red PNG was recognised; prompt tokens rose
  253 → 279, so the image entered the context; measured 2026-08-03). The archived capability
  survey `docs/archive/specs/2026-07-15-pydantic-ai-capability-survey.md` called it a text-only
  gateway; that claim was wrong. `mimo-v2.5` is still the default eval model (`EVAL_MODEL` in
  `packages/eval/src/native/native-run.ts`), and the SD-26 pipeline note in
  `docs/specs/2026-07-06-frontend-rebuild-inputs.md` still marks the main-loop model's vision
  capability 待核实. Re-probe before building on either.

## Indirect injection: what the 2026-07-26 research settled

SD-19 in `docs/specs/2026-07-06-frontend-rebuild-spec.md` is the policy. The rationale behind it:

1. Typed return schemas are the defence that comes free. Attack text inside a `bangumi_id` field
   cannot be read as an instruction; the field's semantics pin it as data. The pin is structural,
   not total: a schema holds ids and coordinates as data, while its string fields (titles, names,
   cities) still carry provider text that can hold instructions. Typed tools (`resolve_anime`,
   `search_bangumi`, `search_nearby`, `plan_route`) therefore shrink the injection surface rather
   than close it, and their results stay untrusted — not because they are "internal and trusted":
   their data comes from external providers.
2. The real risk surface is the free-text tools: `web_search` (title, body, href) and
   `translate_anime_title` (LLM-generated text). Both are still native tools
   (`packages/agent/src/harness.ts`, `packages/agent/src/web-search.ts`).
3. Delimiters such as `<untrusted_web_result>` are necessary, not sufficient (Willison 2023 and the
   tool-result-parsing literature agree). The TS tier delimits web-search results
   (`packages/agent/src/web-search-results.ts`) and has no detection layer; a new free-text tool
   brings its own guard.
