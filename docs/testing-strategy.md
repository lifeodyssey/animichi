# Animichi Testing Strategy

Date: 2026-07-18
Status: CURRENT
Repo: lifeodyssey/animichi
Stack: TanStack Start + React (`apps/web`), Cloudflare Workers (`workers/edge` with the native Pi agent tier · `catalog` · `users` · `maintenance`)

## Table of Contents

1. [Test Pyramid](#test-pyramid)
2. [Frontend Testing](#frontend-testing)
3. [Eval Layers](#eval-layers)
4. [Mock Strategy](#mock-strategy)
5. [Database Testing & SQL Review](#database-testing--sql-review)
6. [E2E Testing](#e2e-testing)
7. [Coverage Targets & CI](#coverage-targets--ci)
8. [Eval Resilience & Deploy Impact](#eval-resilience--deploy-impact)
9. [Code Standards (Embed in Prompt)](#code-standards-embed-in-prompt)
10. [Reviewer Checklist](#reviewer-checklist)
11. [Toolchain](#toolchain)
12. [References](#references)

---

## Test Pyramid

```
                    ┌─────────────┐
                    │  🌐 E2E     │ ← Evaluator (no code access, real app testing)
                    │  Browser    │   browse daemon / Chrome DevTools MCP
                    ├─────────────┤
                    │  📊 Eval    │ ← Full agent run, CI-only monitor
                    │  Layer 3    │   Agent end-to-end
                    ├─────────────┤
                    │  📊 Eval    │ ← Single LLM call
                    │  Layer 2    │   Agent tool selection / output
                    ├─────────────┤
                    │  📊 Eval    │ ← Deterministic, no LLM, seconds
                    │  Layer 1    │   Tool guards / answer validation
                    ├─────────────┤
                    │  🔌 API     │ ← Full HTTP + real DB
                    │  Tests      │   Worker HTTP + test-postgres
                    ├─────────────┤
                    │  🔗 Integ.  │ ← Component interaction
                    │  Tests      │   DB + API contract + SSE contract
                    ├─────────────┤
               ┌────┤  🧪 Unit   │ ← Fastest, most numerous
               │    │  Tests      │   Function/class level, fully mocked
               └────┴─────────────┘
```

**Principle: more tests at the bottom, fewer at the top. Unit tests in seconds, E2E in minutes.**

---

## Frontend Testing

### Unit Tests (Vitest)

**What to test:** Pure functions and utility logic.

**Scope:**
- `lib/types.ts` — type guards (isSearchData, isRouteData, isQAData, isTimedRouteData)
- `lib/api.ts` — hydrateResponseData, request header construction, error handling
- SSE parsing logic
- Date/locale formatting

**No mocking needed — pure logic.**

### Component Tests (Vitest + React Testing Library + MSW)

**What to test:** React component rendering and user interaction.

**Scope:**
- `MessageBubble` — render different response types (search/route/clarify/error)
- `PilgrimageGrid` — grouping display, tab switching (By Episode / By Area)
- `AppShell` — three-column layout, message selection, activeMessageId state
- `Sidebar` — session list rendering, click switching, "+ New chat" button
- `ResultPanel` — GenerativeUIRenderer registry lookup
- `InputArea` — send button state (disabled/enabled), loading state

**MSW setup:**

```typescript
// frontend/__tests__/mocks/handlers.ts
import { http, HttpResponse } from 'msw'

export const handlers = [
  http.post('/v1/runtime', () => {
    return HttpResponse.json({
      success: true, status: 'ok', intent: 'search_bangumi',
      session_id: 'sess-test', message: '111 spots found',
      data: { results: { rows: [{ id: 1, title_ja: '久美子ベンチ' }], row_count: 111 } },
      ui: { component: 'PilgrimageGrid' }
    })
  }),
  http.get('/v1/conversations', () => {
    return HttpResponse.json({ conversations: [] })
  }),
]

// frontend/__tests__/setup.ts
import { server } from './mocks/server'
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

**Why MSW over `vi.mock('../lib/api')`:**
- MSW intercepts at the network layer, covering fetch logic in `api.ts` (headers, error handling)
- Changing an API path without updating the mock causes test failure (good)
- Same handlers reusable in Storybook and dev
- `vi.mock` skips testing `api.ts` itself

**Component test example:**

```typescript
describe('MessageBubble', () => {
  it('handles null data without crash (BUG-02 regression)', () => {
    const response = { success: true, status: 'ok', data: undefined }
    expect(() => render(<MessageBubble role="bot" response={response} />)).not.toThrow()
  })
})
```

**Fixture conventions:**

```typescript
// frontend/__tests__/fixtures/responses.ts
export const searchResponse = { success: true, status: 'ok', intent: 'search_bangumi', ... }
export const routeResponse = { success: true, status: 'ok', intent: 'plan_route', ... }
export const clarifyResponse = { success: true, status: 'needs_clarification', ... }
export const errorResponse = { success: false, status: 'error', message: 'Pipeline failed' }
export const emptyResponse = { success: true, status: 'empty', data: { results: { rows: [], row_count: 0 } } }
```

---

## Eval Layers

Reference: [Anthropic — Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)

### Eval Pyramid

```
         ┌──────────────────────────────────────────────┐
         │ Layer 3: Agent Eval (full agent run)            │
         │ • 163 cases × full pilgrimage_agent run       │
         │ • Runtime: 1-2 hours, CI-only monitor         │
         │ • Tests: end-to-end convergence, output quality │
         │ • Grader: model-based (LLM scoring)           │
         │ • Metrics: pass@1, pass^3                     │
         ├──────────────────────────────────────────────┤
         │ Layer 2: Agent Tool Eval (single LLM call)     │
         │ • 163 cases × single agent.run()              │
         │ • Runtime: 3-10 minutes                       │
         │ • Tests: tool selection, params, output type   │
         │ • Grader: code-based (schema) + model-based   │
         │ • Metrics: accuracy, valid_output_rate         │
         ├──────────────────────────────────────────────┤
    ┌────┤ Layer 1: Component Eval (deterministic)       │
    │    │ • output_validator rules, ModelRetry guards    │
    │    │ • Runtime: 5 seconds                          │
    │    │ • Tests: deterministic logic correctness       │
    │    │ • Grader: code-based (assert)                 │
    │    │ • Metrics: pass/fail                          │
    └────┴──────────────────────────────────────────────┘
```

### Three Grader Types

| Type | Used in | Pros | Cons |
|------|---------|------|------|
| **Code-based** | L1, L2 schema | Fast, cheap, objective, reproducible | Brittle against valid variations |
| **Model-based** | L2 semantic quality, L3 | Flexible, captures nuance | Non-deterministic, needs calibration |
| **Human** | Calibrating model-based | Gold standard | Expensive, slow |

### Eval Metrics

**pass@k:** Probability of at least one success in k attempts. Use for "just needs to work once."
**pass^k:** Probability that ALL k trials succeed. Use for user-facing reliability.

### Eval execution

The native eval surface is `packages/eval` (`packages/eval/NATIVE.md`); no model-backed eval runs
in CI.

### Eval-Driven Development (TDD for LLMs)

1. **Red**: Write eval case (expected behavior), confirm it fails
2. **Green**: Modify prompt / add tool / change validator to pass
3. **Refactor**: Optimize prompt length, reduce token consumption

---

## Mock Strategy

**Core principle: Mock at boundaries, never mock the system under test.**

---

## Database Testing & SQL Review

### Migration Testing

The test fixture never parses, filters, splits, or swallows migration SQL. Atlas 0.30.0 applies
`migrations/neon/` transactionally and records revisions in `public.atlas_schema_revisions`; tests
then assert required tables, extensions, the `vector(1024)` column, and its HNSW index. New
catalog/user schema changes are authored in `migrations/neon/` directly; the archived Supabase
compatibility files (`supabase/`, issue #1000) are not a source and never require an Atlas twin. See
`docs/ops/neon-test-infra.md` for the source rule; `test-base` refresh is manual since #1053.

### SQL Review Standards

Reviewer must check all SQL for:

1. **Performance:** Indexed WHERE columns (verify with EXPLAIN ANALYZE), no SELECT *, LIMIT on large tables, no N+1 (use JOIN or batch)
2. **Security:** Parameterized queries (`$1, $2`), no string concatenation. RLS policies correct. Sensitive data (e.g. credential hashes) hashed.
3. **Correctness:** NULL handling (COALESCE / IS NOT NULL). Transaction boundaries. Unique constraints.
4. **Maintainability:** Formatted SQL (aligned clauses). Comments explain "why" not "what". Migration naming: `YYYYMMDDHHMMSS_description.sql`. Idempotent migrations.

---

## E2E Testing

**Executed by Evaluator. Evaluator has no code access — only operates the live app.**

### Test Environment

`supabase start` is **no longer needed for auth E2E** (AUTH-2 #950): the auth plane is Neon Auth,
login E2E is `e2e/web-neon-login.spec.ts` (live Neon origin, **fail-closed** — #1690 removed the
self-skip that made every run green while asserting nothing; without the QA identity its lane fails
and names the variables), and `make e2e-setup`
installs deps only. Its lane is local (`pnpm --filter animichi-e2e run test:login`): no pull-request
job holds a credential, so the browser job reports the proof as `NOT RUN` instead of implying it.

- Web: `apps/web` Vite dev / Wrangler preview (default `E2E_WEB_BASE_URL=http://localhost:3000`)
- Auth: **Neon Auth (Better Auth)** — live login E2E signs in against the real Neon origin
  (AUTH-2 #950); Supabase GoTrue + `send-auth-email` + Mailpit are retired
- **Nothing is mocked** (the unit suite's MSW lane is separate)

`make e2e-setup` installs E2E deps and the Playwright browser; it no longer starts Supabase or
seeds a compatibility database (the auth E2E database was specific to the retired magic-link flow).

### Core Journeys

| ID | Journey | Actions | Assertions |
|----|---------|---------|------------|
| E2E-01 | Anime search | Type "響け！ユーフォニアム" → send | PilgrimageGrid renders, row count > 0 |
| E2E-02 | Nearby search | Type "宇治駅の近く" → send | Results shown, no excessive duplicates |
| E2E-03 | Route planning | After search, type "ルートを作って" | Route result or clarify prompt, not blank |
| E2E-04 | History switch | Click sidebar entry | Shows correct session messages |
| E2E-05 | New chat | Click "+ New chat" | Chat panel clears |
| E2E-06 | Mobile | Viewport 375px | Bottom drawer works, sidebar overlay |
| E2E-07 | Error recovery | Trigger backend 500 | Error shown, send button recovers |
| E2E-08 | Multilingual | Search in ja/zh/en | Response language matches input |

### Evaluator-Generated Edge Cases

Beyond AC-defined scenarios, Evaluator proactively generates:
- Empty input / very long input (1000 chars)
- Special characters (emoji, HTML tags, SQL injection attempts)
- Rapid-fire 10 messages
- Page refresh → session recovery
- Network throttle (3G)
- Switch between 3 sessions and back

### Screenshots as Evidence

```json
{
  "evidence": [
    {"type": "screenshot", "step": "E2E-01", "file": "/tmp/e2e-search.png", "note": "Search results OK"},
    {"type": "screenshot", "step": "E2E-03", "file": "/tmp/e2e-route.png", "note": "Route still blank ❌"}
  ]
}
```

### Visual Regression (Pixel) Pipeline

The pixel pipeline (`e2e/visual/`, two-tier doctrine: convergence vs
regression) is exposed as a parameterized, re-entrant task atom:

- `make visual-check` — every frame in the registry.
- `make visual-check PAGE=landing MODE=night` — one frame; `PAGE` accepts a
  full frame key or a partial key resolved against `MODE`.
- `make visual-check RATIO=0.05` — loosen the pixel budget; `RATIO` is the
  threshold config, default `0.01`, must be a finite number in `(0, 1]` (a
  malformed value fails fast with `exitCode: 2` + `error`, never a silent
  `NaN`→`null`).
- `make visual-check-self-test` — shell-boundary contract check, three
  phases: (1) multi-frame — runs the atom with no `PAGE` (every frame) and
  asserts each frame has a report, all verdicts are `pass`, and
  `summary.exitCode` is `0`; (2) invocation — a malformed `RATIO` fails fast
  with a fresh `exitCode: 2` summary; (3) host-arm — with docker unavailable
  and no resolvable Playwright binary, the host arm fails fast with an
  environment summary instead of a bare "command not found". Loose budget on
  purpose (contract, not convergence — that is C4). Needs docker + a
  reachable app; fails closed otherwise.
- The docker arm runs Playwright in the image with `e2e/node_modules`; the
  host arm resolves Playwright from `e2e/node_modules` first, then the
  workspace root, and fails fast (environment summary) if neither exists.

Contract (inputs/outputs):

- **Inputs**: `PAGE` (empty = all frames), `MODE` (`day`/`night`, for partial
  keys only), `RATIO` (pixel budget, from config), `E2E_WEB_BASE_URL`
  (default `http://localhost:3000`).
- **The single authoritative verdict is `e2e/visual/report/summary.json`** —
  written fresh on every invocation path (including invocation failures, with
  an `error` field), with a `runId` for freshness; per-frame reports are
  cleared by the runner once, before the frame loop (never from the host
  shell — rm on a Docker Desktop bind mount races the container's writes
  with ENOENT; never per frame, or frame N+1 would delete frame N's report
  and every frame but the last would misreport "no convergence report
  produced").
  `summary.exitCode` has three states: `0` every frame compared and passed ·
  `1` at least one visual diff (`failedFrames`) ·
  `2` environment or invocation problem (unknown `PAGE`, malformed `RATIO`,
  or a frame produced no comparison — app unreachable, runner blocked —
  **fail-closed: zero compared pixels is never green**).
  `scripts/visual-check.sh` exits 0/1/2
  directly; via `make` GNU make remaps any recipe failure to its own exit `2`
  (still nonzero), so the 1-vs-2 distinction lives in the JSON, not in make's
  exit code.
- Per-frame `status` (`pass`/`fail`/`skipped`) carries `ratio`, `threshold`,
  `reason`; `failedFrames` / `skippedFrames` are the flat lists.
- Frame registry, determinism rules, orchestration recipe, and the C4
  convergence TODO (frames not yet converged under the default `RATIO=0.01`):
  `e2e/visual/README.md`.

---

## Coverage Targets & CI

### Enforced coverage floors

The configuration files are authoritative. This table mirrors their live numeric values; change a
floor in its config and this table in the same commit.

| Metric | Configured floor (%) | Source of truth |
|--------|----------------------|-----------------|
| Frontend statements | `98` | `apps/web/vitest.config.ts`, `test.coverage.thresholds.statements` |
| Frontend branches | `95` | `apps/web/vitest.config.ts`, `test.coverage.thresholds.branches` |
| Frontend functions | `98` | `apps/web/vitest.config.ts`, `test.coverage.thresholds.functions` |
| Frontend lines | `99` | `apps/web/vitest.config.ts`, `test.coverage.thresholds.lines` |

Frontend inclusion,
exclusion, reporter, and ratchet details remain in `apps/web/vitest.config.ts`; this document does
not define a second coverage policy.

### Affected PR CI

`.github/workflows/pr-verification.yml` is the single pull-request and merge-queue workflow. The
affected set is pnpm's: `pnpm ls -r --depth -1 --json --filter "...[<merge-base>]"` selects every
workspace project whose files changed plus every dependent, and each selected package runs its own
`lint` / `typecheck` / `test` / `test:integration`. The paths outside the package graph
(`apps/web`, `migrations/neon`, `e2e`, the root dependency files) are routed by
`dorny/paths-filter` into dedicated jobs, and a root dependency change means every package.
`PR Verification` blocks merge unless every lane succeeds; the direct `Security` context separately
fail-closes the six always-on security jobs.

**No pull request runs a model-backed eval.** The `CI / agent eval (L0 smoke)` lane — 80 capped
trajectories against MiMo through `https://opencode.ai/zen/go/v1` — was deleted with the
affected-matrix rewrite, so no pull-request or merge-queue job holds a provider credential of any
kind. The capped run was always report-only, and removing it changed no merge verdict.

**No pull-request job holds any credential at all** — provider or otherwise. That is not an
observation, it is a contract: `.github/test/workflow-credentials.test.rb` rejects a `secrets.*`
read (or `secrets: inherit`) anywhere under `.github/`, so a PR lane cannot present the staging QA
identity. #1690 settled what follows for the one proof that wanted it: the live Neon Auth login
lane is a **local** lane (`pnpm --filter animichi-e2e run test:login`, credentials from
`.env.test`), and the browser job reports it as `NOT RUN` in its step summary and as a run
annotation rather than letting the summary imply coverage — the spec is fail-closed, so it can
never skip its way to green, and it is never selected by a lane that cannot run it. Moving that
proof into CI would mean a CD/staging lane that opens the QA identity from Pulumi ESC under an
environment-bound OIDC identity (the `cd.yml` pattern) — an owner
decision, recorded in `docs/ops/auth-migration-neon.md` §7.2.

No model-backed lane is left in CI: the nightly L1 trajectory workflow ran the Python agent's suite
and was deleted with it (#1607).

Deployment is not a CI job. A successful merge creates a `main` push; only then does
`.github/workflows/cd.yml` build and promote the affected release cohort.

---

## Eval Resilience & Deploy Impact

### Per-Layer Deploy Impact

| Eval Layer | On Failure | Reason |
|------------|-----------|--------|
| Layer 1 (deterministic) | **Block deploy** | Deterministic failure = actually broken |
| E2E (browser) | **Block PR merge** | User-visible issues must be fixed |

---

## Code Standards (Embed in Prompt)

The following is embedded directly in Executor and Reviewer prompts. No runtime lookup needed.

### React / TanStack Start (`apps/web`)

- Prefer server loaders and route-level data; mark client components only when interaction/state needs the browser
- Hook rules: no hooks in conditionals/loops
- key prop with stable IDs (e.g. `message.id`), not array index
- `useCallback` for event handlers to prevent unnecessary child re-renders
- CSS via Tailwind utility + `apps/web/src/styles/globals.css` design tokens
- `useEffect` cleanup: return cleanup function to prevent memory leaks
- Package conventions and coverage floors: `apps/web/AGENTS.md` + `apps/web/vitest.config.ts`

### MSW (Mock Service Worker)

- `setupServer` in `beforeAll`, close in `afterAll`
- `server.resetHandlers()` in `afterEach` to prevent test pollution
- `onUnhandledRequest: 'error'` — unmocked requests auto-fail
- Handlers centralized in `__tests__/mocks/handlers.ts`

### Clean Code

- **1-10-50**: methods < 10 lines, classes < 50 lines, max 1 indentation level
- **Early return** instead of nested if-else
- **Self-documenting names**, zero comments (unless explaining "why")
- **Declare variables near usage point**
- **No `any` type** (TypeScript) — model the shape

### SOLID

- **S** — Single Responsibility: one module, one reason to change
- **O** — Open/Closed: new tool = new tool registration, don't modify agent core
- **L** — Liskov Substitution: subclasses don't break parent constraints
- **I** — Interface Segregation: don't expose unused methods
- **D** — Dependency Inversion: handlers depend on DB interface (async methods), not concrete implementation

### Naming Conventions

| Category | Rule | Good | Bad |
|----------|------|------|-----|
| Functions | Verb-first | `find_bangumi_by_title()` | `get_data()` |
| Booleans | is/has/can/should prefix | `is_cached`, `has_results` | `cached`, `found` |
| Classes | Noun, describes role | `RouteOptimizer` | `RouteHelper` |
| Constants | SCREAMING_SNAKE | `MAX_RETRIES` | `maxRetries` |
| Files | Match content | `resolve_anime.py` | `handler1.py` |
| React components | PascalCase | `MessageBubble` | `Bubble` |
| Hooks | use prefix | `useChat` | `chatManager` |
| Tests | test_ + describe behavior | `test_returns_empty_on_timeout` | `test_1` |

### Mock Rules (by test layer)

- Unit: mock all external dependencies (DB, API, LLM)
- Integration: mock only LLM; DB is real (`packages/test-postgres`)
- API test: mock only LLM, real DB
- Frontend component: MSW mock API layer
- E2E: **mock nothing**

---

## Reviewer Checklist

### Code Review (by priority)

**P0 — Must fix:**
- Security vulnerabilities (SQL injection, XSS, hardcoded secrets)
- Crash bugs (null pointer, unhandled exceptions)
- Data loss risk (missing transactions, race conditions)
- `Any` type introduced

**P1 — Should fix:**
- SOLID violation
- Clean Code rule violation (method > 10 lines, deep nesting)
- Missing corresponding test (Quality Ratchet: every AC must have a test)
- Framework best practice violation (Workers, React)
- Unclear naming

**P2 — Suggested:**
- Code duplication (extractable helper)
- Performance optimization opportunity
- Better data structure choice

### SQL Review

- Parameterized queries (`$1, $2`), no string concatenation
- WHERE columns indexed
- No `SELECT *`
- Large tables have `LIMIT`
- NULL handling (COALESCE / IS NOT NULL)
- Transaction boundaries correct
- Migrations idempotent

### Framework-Specific Review

For uncertain framework APIs or newly introduced libraries, Reviewer should use context7 to check latest docs. Known best practices (listed above) do not require runtime lookup.

---

## Toolchain

### Frontend

| Tool | Purpose | Status |
|------|---------|--------|
| `vitest` | Test framework | 🆕 To install |
| `@testing-library/react` | Component testing | 🆕 To install |
| `@testing-library/jest-dom` | DOM assertions | 🆕 To install |
| `@testing-library/user-event` | User interaction simulation | 🆕 To install |
| `msw` | API mock | 🆕 To install |
| `jsdom` | Browser env simulation | 🆕 To install |

---

## References

- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [MSW — Mock Service Worker](https://github.com/mswjs/msw)
- [Anthropic: Demystifying Evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [Anthropic: Harness Design](https://www.anthropic.com/engineering/harness-design-long-running-apps)
- [pgTAP: PostgreSQL Unit Testing](https://pgtap.org/)
- [Clean Code / TDD Principles](https://zhenjia.org/posts/clean-code-refactoring-and-test-driven-development)
- [Agentic Coding Workflow](https://zhenjia.org/posts/my-core-agentic-coding-workflow-on-2025-12-8)
