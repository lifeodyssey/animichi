# Animichi — AGENTS.md

Canonical repo guide for agentic coding tools. Claude Code reaches this via `CLAUDE.md`
(`@AGENTS.md`); the 30+ AGENTS.md-native tools read it directly. Keep it under ~200 lines —
stack-specific rules live in per-package `AGENTS.md` files and in `.claude/rules/` (below).

Animichi is an anime pilgrimage search + route-planning service. **Hybrid microservices**: a
Python PydanticAI agent (FastAPI, Cloudflare container) + TypeScript Cloudflare Workers (catalog,
and a planned users service) + a TanStack web app (rebuild in progress). Data plane = Neon;
auth = Supabase.

## Monorepo layout

- `apps/agent/`        — Python PydanticAI agent (FastAPI container). uv. → `apps/agent/AGENTS.md`
- `workers/catalog/`   — TS Worker: anime catalog API + data platform (ingest/enrich/publish). → `workers/catalog/AGENTS.md`
- `workers/users/`     — TS Worker: user-domain data (Neon + Drizzle). PLANNED (SD-2).
- `packages/contract/` — Shared oRPC/zod contract; source of truth for cross-service types. → `packages/contract/README.md`
- `frontend/`          — Next.js (OpenNext-SSR), **homepage-only** (chat/search deleted 2026-06). → `frontend/AGENTS.md`
- `apps/web/`          — TanStack Start rebuild. PLANNED (see rebuild spec).
- `worker/`            — CF edge worker (`entry.ts`): auth + `/v1` routing + image proxy.
- `db/`                — Neon migrations (atlas). `supabase/migrations/` — auth migrations.
- `infra/`             — Pulumi IaC.

## Package managers

- **pnpm** workspace for all TypeScript (`pnpm-workspace.yaml`). **uv** for Python (in `apps/agent/`).

## Core commands (from repo root)

- `make check`         — lint + typecheck + test. **Run before AND after any change.**
- `make dev-local`     — Supabase + backend + frontend, one command (never start services individually).
- `make local-login`   — browser magic-link login for local dev.
- `make test` / `make test-integration` / `make test-eval` — Python agent tests.
- `make e2e-setup` then `make e2e` — Playwright E2E (details in `docs/testing-strategy.md`).
- `pnpm run test:worker` — edge worker tests. Per-package commands live in that package's `AGENTS.md`.

## Cross-stack guardrails (apply everywhere)

- **1-10-50**: functions ≤10 lines, classes ≤50, files ≤300; ≤2 indent levels (early-return / extract).
- **No `Any`** — Python: `object` + `isinstance()`; TS: no `any`. No `dict[str, object]` — model it.
- **No suppression without user approval** — no `eslint-disable` / `@ts-ignore` / `type: ignore` /
  `noqa` / `pragma: no cover` / `continue-on-error` / `skip`. Fix the code; don't silence the rule.
- **Coverage floors ratchet UP only** — frontend lines≥72 / stmts≥68 / fns≥62 / branches≥59; backend ≥80.
- **Test quality**: mock the clock (no timing-dependent asserts); no conditional logic in tests
  (split them); ≤200 lines per test file; ≤5 mocks per test.
- **No local deploy** (hook `block-local-deploy`) — CI/CD only: staging = merge to `main`; prod =
  tag `v*` (+ GitHub environment approval). Details → `docs/ops/deployment.md`.

## Authoritative docs (read the matching one when doing that work)

- Architecture **why** → `docs/superpowers/specs/2026-06-13-architecture-adr.md`
- Current **target** (hybrid, latest; wins over the ADR on agent language) →
  `docs/superpowers/specs/2026-07-06-frontend-rebuild-spec.md`
- Live runtime **reference** → `docs/ARCHITECTURE.md` *(paths + frontend section pending a refresh — separate PR)*
- Deploy runbook → `docs/ops/deployment.md`
- **Single Source-of-Truth table + doc-change rules** → `docs/DOCS_POLICY.md` (the one canonical topic→path map)

## Tool routing (repo-specific; global tooling lives in `~/.claude/` — do not repeat it here)

- **Skill-first** — invoke the Skill tool before acting when a request matches: bugs → `/investigate` ·
  ship/PR → `/ship` · qa → `/qa` · review → `/review` · docs → `/document-release` · retro → `/retro` ·
  design system → `/design-consultation` · visual → `/design-review` · architecture → `/plan-eng-review` ·
  quality → `/health` · brainstorm → `/office-hours`. TDD: `/backend-tdd` (Python), `/frontend-tdd` (React).
- **Codex** — delegate code-writing / deep investigation to Codex via **`/codex`** (`use-codex`) or
  **`codex:codex-rescue`** (Skill, or Agent `subagent_type="codex:codex-rescue"`) — the managed app-server
  runtime. **Never** `codex exec --sandbox workspace-write` (hook `block-codex-exec-codewrite` blocks it).
- **Web browsing** → `/browse` (gstack). Never `mcp__claude-in-chrome__*`.
- **CodeGraph** — `.codegraph/` is initialized; follow the **global** CodeGraph rules in `~/.claude/CLAUDE.md`
  (spawn an Explore agent for exploration; only lightweight `codegraph_*` lookups in the main session).
- **MCP servers — when to reach for each on this stack** (existence is config; this is the *when*):

  | Server | Use it for |
  |---|---|
  | `supabase-seichijunrei` | Auth/Supabase ops — `list_tables`, `get_logs`, `get_advisors`, edge functions, `apply_migration`. Start here to debug auth/DB. |
  | Neon (`mcp__Neon__*`) | The **data plane** (catalog/user tables, Drizzle). Branch/query Neon. |
  | Cloudflare (`cloudflare-*`) | Workers/Wrangler docs, bindings, builds, observability for the edge/catalog. |
  | context7 | Current library docs for the exact stack (Hono, Drizzle, oRPC, AI SDK, TanStack Start, pydantic-ai). Prefer over memory. |
  | serena | LSP-backed semantic code nav/edits when codegraph isn't enough. |
  | logfire | Observability — the agent and Workers share the Logfire dashboard. |

## Harness (4-role agent system)

Planner → Executor → Reviewer → Tester. Role definitions live in `.claude/agents/`; orchestration via
`/iteration-planning` + `/iteration-execution`. **Quality Ratchet**: every AC carries a test-type
annotation (`unit`|`integration`|`eval`|`browser`|`api`) plus a test in the PR diff
(`ac_total == ac_with_test`); Reviewer wants Codecov patch ≥95%. In worktrees, use
`uv tool run ruff format`. Hooks: `block-secrets-in-pr`, `block-local-deploy`, `block-codex-exec-codewrite`.

## File placement

Never save working files to the repo root. Doc placement + the doc-change checklist → `docs/DOCS_POLICY.md`.
