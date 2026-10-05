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

## Model request prefix stability (#546, 2026-10-02)

Chapter 2's KV-cache discipline above is now machine-checked. The prefix is the leading system
message's prompt plus its tool declarations, in the order `createPilgrimageHarness` advertises
them. `packages/agent/src/native-request-prefix.ts` replays the transcript a provider actually
received (`requestPrefixOf`), serializes it (`serializePrefix`), and names every drift
(`prefixDrift`, `assertPrefixStable`); `assertPrefixPinned` compares a sent prefix to the production
advertisement. The guard runs in `packages/agent/test/native-request-prefix.test.ts` (timestamp,
session id, request id, tool reorder and declaration mutations) and
`packages/agent/test/native-prefix-drift.test.ts` (two turns of one session; two sessions under
different mocked clocks, locales and ids).

Every prefix-instability source audited, with its location and disposition:

| Source | Location | Disposition |
| --- | --- | --- |
| System prompt | `packages/agent/src/native-configuration.ts:2` | Fixed: a constant with no clock, session or request value; `assertPrefixPinned` fails when it moves. |
| Advertised tool order | `packages/agent/src/native-tools.ts:16` and `packages/agent/src/harness.ts:15` | Fixed: one tuple literal, never object-key or set iteration; `NATIVE_TOOL_ORDER` is the order the harness advertises. |
| Eval tool-order provenance | `packages/eval/src/native/prefix-cases.ts` (`productionToolNames`) | Fixed: reads `NATIVE_TOOL_ORDER`, so recorded provenance cannot drift from the harness. |
| `transform_context` tail | `packages/agent/src/native-context-hooks.ts:12-16` | Declined as prefix drift: the hook returns only `messages`; the appended `agent_status` user message and the frozen-summary substitution of prior tool results come after the stable transcript. The two-turn test asserts append-only growth and a summary equal to the tool result's declared `frozenSummary`. |
| Per-operation tool settings | `workers/edge/src/agent/host/operation-tool-settings.ts:28-36` | Declined: the operation scalar changes `PilgrimageToolContext` (`locale`, `origin`, translation models), never the advertised tool list or prompt. |
| Per-session composition | `workers/edge/src/agent/host/native-bootstrap.ts:35` | Declined: `compose` supplies models and tool context; the prompt and the tools come from the shared `NATIVE_AGENT_OPTIONS` and `createPilgrimageHarness`. |
| BYOK model swap | `workers/edge/src/agent/host/native-models.ts` (`nativeByokModels`) | Declined: a BYOK credential changes the model and transport, not the request prefix. |
| Translation sub-request | `packages/agent/src/translate-anime-title.ts:42` | Declined: its own short system prompt belongs to a separate `completeSimple` call, not the main transcript prefix. |
| Entry timestamps and ids | system-message construction | Declined: the leading system message carries `timestamp: 0`; entry, tool-result and operation ids live after the prefix, and the guard allows only appended messages or a declared frozen summary. |

Not measured here: the production cache hit rate and each provider's caching semantics. They need
production telemetry access and stay with the owner.

## Observability and eval research (2026-10-03)

The owner asked whether the whole observability and evaluation design was wrong ("我感觉是我们一整个
可观测性和评测设计的有问题"). `docs/iterations/agent-platform-research-2026-10/OBSERVABILITY-AND-EVAL-RESEARCH.md`
records what pi itself provides and recommends, the consensus of mature projects on both topics, the
thirteen gaps between that consensus and this repository, four candidate directions and the nine owner
questions they raise. Read it before proposing observability or eval work; its §6 questions are open
until a decision lands in `docs/agents/owner-decisions.md`.

## Agent API shape research (2026-10-04)

The owner asked whether splitting the API into a base capability layer with our chat agent as one of
its consumers is best practice, and how mature vertical agent products shape their APIs.
`docs/iterations/agent-platform-research-2026-10/AGENT-API-SHAPE-RESEARCH.md` records, with cited
sources, how Anthropic's own products, the AI platforms, mature vertical products and the published
guidance shape agent APIs; a consensus-and-dissent table over eleven design questions; the comparison
with our current `/v1` (checked against the code) and with the proposed split (its parts have
precedent, the whole has none found); four candidate directions and the open owner questions. See it
before changing the shape of `/v1`; its §7 questions are open until a decision lands in
`docs/agents/owner-decisions.md`.

## pi 1.0 packages research (2026-10-04)

The owner asked what the packages released with pi 1.0 could replace among our hand-written parts.
`docs/iterations/agent-platform-research-2026-10/PI-1.0-PACKAGES-RESEARCH.md` maps each pi 1.0 package
(pi-durable, pi-telemetry, pi-ai, pi-mcp, pi-server and the rest) against the agent runtime we wrote:
what is usable now (pi-ai's OpenCode Go provider, pi-telemetry's `TelemetryContext`), what pi-durable
takes over (the harness's part, not our business layer), what does not fit, and the questions a
migration has to answer. Read it before touching the pi version line.
