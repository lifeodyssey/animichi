# CLAUDE.md

This file provides guidance to Claude Code and other agentic tools working in this repository.

## What This Repo Is

Seichijunrei is an anime pilgrimage search and route planning service.

Implementation status: Core runtime + Cloudflare deploy path in place. PydanticAI agent deployed.

## Source Of Truth

- Runtime entry: `backend/interfaces/fastapi_service.py` → `public_api.py` → `agents/pilgrimage_runner.py`
- Shared types: `backend/agents/models.py`
- Frontend tokens: `frontend/app/globals.css`
- Deploy wiring: `wrangler.toml` + `worker/entry.js`
- Frontend conventions: `frontend/AGENTS.md`
- Detailed architecture: `docs/ARCHITECTURE.md`
- Deployment ops: `docs/ops/deployment.md`
- Testing strategy: `docs/testing-strategy.md`

## Directory Structure

```
backend/              # Python runtime
  agents/             # AI agent (pilgrimage_agent, tools, runner, retriever)
  domain/             # Entities, value objects, LLM schemas
  infrastructure/     # External adapters (DB, observability, gateways)
  interfaces/         # API surface (fastapi_service, public_api)
  tests/              # unit, integration, eval
frontend/             # Next.js OpenNext-SSR (.open-next/); TanStack Start rebuild planned
supabase/migrations/  # DDL migrations (timestamp-ordered)
worker/entry.js       # CF Worker entry (container proxy + image proxy → OpenNext)
```

## Commands

```bash
make dev-local        # one-command: Supabase + backend + frontend (:3001)
make dev-stop         # stop backend + frontend (Supabase stays)
make local-login      # open browser with magic link login
make dev              # install all deps (including dev)
make test             # unit tests
make test-integration # integration tests
make test-all         # unit + integration
make test-eval        # model-backed evals (separate)
make lint             # ruff check + format check
make format           # ruff auto-format + fix
make typecheck        # mypy strict
make check            # lint + typecheck + test
make e2e-setup        # start Supabase + Edge Function + seed data
make e2e              # run all Playwright E2E tests
make e2e-public       # E2E tests that don't need email (fast)
```

Frontend: `cd frontend && npm ci && npm run dev`

Notes:
- pytest: `--asyncio-mode=auto`
- pre-commit hooks: ruff + mypy on every commit

## Architecture

```
User text → RuntimeAPI.handle() → run_pilgrimage_agent() → pilgrimage_agent.run()
  → tools call handlers → AgentResult (typed output + steps + tool_state)
  → agent_result_to_response() → PublicAPIResponse

For selected_point_ids:
  User selection → execute_selected_route() → AgentResult → PublicAPIResponse
```

See `docs/ARCHITECTURE.md` for full details.

### Tools (@agent.tool registrations with ModelRetry guards)

| Tool | Description |
|---|---|
| `resolve_anime` | API-first title→bangumi_id; DB cache; write-through |
| `search_bangumi` | Retriever → points by bangumi_id |
| `search_nearby` | Geo retrieval by location + radius |
| `plan_route` | Nearest-neighbor route ordering |
| `greet_user` | Ephemeral greeting/identity response |
| `answer_question` | QA pass-through |
| `clarify` | Disambiguation when query is ambiguous |

## External API Reference

Full docs in `docs/api-reference/`. Key facts:

- **Anitabi** (`api.anitabi.cn`): Pilgrimage point data. Uses **Bangumi.tv subject IDs**. `GET /bangumi/{id}/lite` for metadata, `GET /bangumi/{id}/points/detail?haveImage=true` for full point list. Images at `image.anitabi.cn`. CC BY-NC-SA 4.0.
- **Bangumi** (`api.bgm.tv`): Anime metadata (title, cover, rating, eps). `GET /search/subject/{keywords}?type=2` for search, `GET /subject/{id}` for detail. `eps=1` → movie, `eps>1` → TV.
- Both APIs share the same subject ID system. Our DB uses these IDs as primary keys.

## Guardrails

- Orchestration: single PydanticAI agent (`pilgrimage_agent`) with typed output; selected-route path bypasses agent
- Tools use `ModelRetry` guards to reject invalid LLM parameters; `output_validator` rejects fabricated responses
- Auth: Next.js middleware (cookie-based for pages, JWT/sk_ for API); container trusts forwarded headers
- Frontend: Next.js OpenNext-SSR (`.open-next/` via next.config side-effect, NOT `output: export`); TanStack Start rebuild (SPA+SSG) planned
- No `Any` in Python — use `object` + `isinstance()` at trust boundaries
- New UI component = register in `frontend/components/generative/registry.ts` only
- Run `make check` before and after any change
- **No suppression without user approval.** Never add `eslint-disable`, `@ts-ignore`, `type: ignore`, `noqa`, `pragma: no cover`, `continue-on-error`, `skip`, or any other linting/type-checking suppression without explicit user confirmation. If a rule fires, fix the code instead.
- **Coverage thresholds may only be ratcheted UP, never lowered.** Current floors:
  - Frontend (vitest.config.ts): lines≥72%, statements≥68%, functions≥62%, branches≥59%
  - Backend (pytest.ini): ≥80%
  - When adding code that increases coverage, update the thresholds to the new floor

## Deployment

**Tag-based deploy:** push to main triggers CI (lint + test) but NOT deploy.
Deploy is triggered only by pushing a version tag.

```bash
git tag v1.x.x && git push origin v1.x.x  # triggers deploy
```

Flow: CI green → Tester validates on main → Tester tags → CI deploys to production.

- Container: FastAPI via Dockerfile → Cloudflare container
- Frontend: OpenNext-SSR build → `.open-next/` (worker.js + assets) → CF ASSETS binding (`.open-next/assets`); TanStack rebuild will switch to `.output/public`
- Worker: routes `/v1/*` to container, static to ASSETS
- DB migrations: applied during deploy step

## Test Environment

Local testing uses `supabase start` (full Supabase via Docker: Postgres + PostGIS + GoTrue + PostgREST):

```bash
supabase start                    # starts all Supabase services locally
# Outputs: API URL (localhost:54321), anon key, service_role key, DB URL (localhost:54322)
# Migrations from supabase/migrations/ are applied automatically

# Backend — connect to local Supabase:
export SUPABASE_URL=http://localhost:54321
export SUPABASE_DB_URL=postgresql://postgres:postgres@localhost:54322/postgres
make serve

# Frontend — set local Supabase in .env.local:
# NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
# NEXT_PUBLIC_SUPABASE_ANON_KEY=<from supabase start output>
cd frontend && npm run dev

supabase stop                     # cleanup
```

### E2E Testing (Playwright)

```bash
make e2e-setup        # one command: Supabase + seed + Edge Function + deps
make e2e              # run all 18 Playwright tests (serial, ~16s)
make e2e-public       # run 12 tests that don't need email (fast)
```

E2E tests live in `e2e/` (separate package.json, Playwright).
Requires: `supabase start` + `supabase functions serve send-auth-email --no-verify-jwt`
Frontend `.env.local` must point to local Supabase (`http://127.0.0.1:54321`).
Test data: `backend/tests/fixtures/seed.sql` (18 anime, 43 spots).
Mailpit UI: `http://localhost:54324` (view captured emails).

## Code Quality Standards

### 1-10-50 Rule
- Functions: max 10 lines. Classes: max 50 lines. Files: max 300 lines.
- Indentation: max 2 levels. Flatten with early return or extract.

### Type Safety
- No `dict[str, object]` — use dataclass or Pydantic model
- No `assert` for runtime validation — use `if not x: raise ValueError(...)`
- No bare `str` for IDs/statuses — use NewType, Literal, or Enum
- No `Any` — use `object` + `isinstance()` narrowing; Protocol for duck-typing, `cast()` at library boundaries (details: @docs/typing-rules.md)

### CSS Rules (auto-enforced)
- Read `frontend/DESIGN.md` before any design or UI work — it is the design system source of truth
- Animal Island UI reference: `docs/design/animal-island-ref/` (4 docs: color, typography, interaction, component specs) — read before component redesign work
- Tokens defined in `frontend/app/globals.css :root`; registered in `@theme inline` for Tailwind utilities
- Use semantic Tailwind classes: `bg-primary`, `text-foreground`, `border-border` — never `bg-[var(--color-*)]`
- Never use `style={{ }}` for values that have Tailwind equivalents (colors, spacing, font, radius, opacity)
- Never use `space-y-*` / `space-x-*` — use `flex flex-col gap-*` (shadcn rule)
- Never use template literal className ternaries — use `cn()` from `@/lib/utils`
- Never hardcode `oklch()` / hex in components — extract to CSS variable if used 2+ times
- Extract repeated animation strings to CSS classes in `globals.css` (`.entrance-up`, `.entrance-slide-right`, etc.)
- Use shadcn `<Skeleton>` for loading states — never hand-written `animate-pulse` divs
- Run `/css-audit` before committing frontend changes to catch remaining smells

### Test Quality
- No timing-dependent assertions — mock the clock
- No conditional logic in tests — split into separate tests
- Max 200 lines per test file. Max 5 mocks per test.

### TDD
- Backend: invoke `/backend-tdd` before writing Python code
- Frontend: invoke `/frontend-tdd` before writing React/TypeScript code

## Harness Engineering System

4-role agent harness. Definitions in `.claude/agents/`. Orchestration via `/iteration-planning` and `/iteration-execution`.

### Roles

| Role | Can do | Cannot do |
|---|---|---|
| Planner | Read code, write specs | Write code, create PRs |
| Executor | Write code + tests in worktree, create PR | Merge PRs, modify outside scope |
| Reviewer | Read diffs, run evals, approve/reject | Write code, merge PRs |
| Tester | Test running app, write E2E/API tests, tag for deploy | Read source code, edit production code |

### Workflow

```
Planner → spec (docs/superpowers/specs/)
  ↓
Coordinator → cards + wave graph (docs/superpowers/plans/)
  ↓
Per wave (parallel within wave, sequential across waves):
  Executor (worktree) → PR
  Reviewer → approve/request_changes
  Merge → rebase remaining PRs → next wave
  ↓
After all waves:
  Coordinator → pull main → supabase start → make serve → npm run dev → wait healthz
  Tester → test all ACs against running app (localhost:8080 + localhost:3000)
  All pass → Tester: git tag vX.Y.Z → push → CI deploys
  Coordinator → supabase stop → kill serve
```

### Agent Dispatch

- Executor: `subagent_type="executor"`, `model="sonnet"`, `isolation="worktree"`
- Reviewer: `subagent_type="reviewer"` (Read/Grep/Bash, no Write/Edit)
- Tester: `subagent_type="tester"` (Bash/Read/Write/Skill/WebFetch)
- In worktrees: `uv tool run ruff format` (not `uv run ruff format`)
- Reviewer: Codecov patch >= 95% (P1 if below, unless doc-only)

### Quality Ratchet

Every AC: test type annotation (unit|integration|eval|browser|api) + test in PR diff.
Reviewer verifies: `ac_total == ac_with_test`.

### Hook

`.claude/hookify.block-secrets-in-pr.local.md` — blocks gh pr comment/review containing secrets.

## File Placement

- Runtime: repo root or `backend/interfaces/`
- Docs: `docs/ops/` (ops), `docs/superpowers/plans/` (cards), `docs/superpowers/specs/` (specs)
- NEVER save working files to root folder

## gstack

Use `/browse` for all web browsing. Never use `mcp__claude-in-chrome__*` tools.
If broken: `cd ~/.claude/skills/gstack && ./setup`

## Skill Routing

IMPORTANT: When request matches a skill, invoke via Skill tool FIRST.

- Bugs, errors → /investigate
- Ship, deploy, PR → /ship
- QA, test → /qa
- Code review → /review
- Docs after ship → /document-release
- Retro → /retro
- Design system → /design-consultation
- Visual audit → /design-review
- Architecture → /plan-eng-review
- Code quality → /health
- Brainstorming → /office-hours

<!-- CLAUDE_CODE_MIGRATION_START:-Documents-Seichijunrei-agent-.claude-worktrees-ssr-migration-CLAUDE.md -->
# Migrated Claude Code Project Instructions

Source: `~/Documents/Seichijunrei-agent/.claude/worktrees/ssr-migration/CLAUDE.md`

# CLAUDE.md

This file provides guidance to Claude Code and other agentic tools working in this repository.

## What This Repo Is

Seichijunrei is an anime pilgrimage search and route planning service.

Implementation status: Core runtime + Cloudflare deploy path in place. PydanticAI agent deployed.

## Source Of Truth

- Runtime entry: `backend/interfaces/fastapi_service.py` → `public_api.py` → `agents/pilgrimage_runner.py`
- Shared types: `backend/agents/models.py`
- Frontend tokens: `frontend/app/globals.css`
- Deploy wiring: `wrangler.toml` + `worker/entry.js`
- Frontend conventions: `frontend/AGENTS.md`
- Detailed architecture: `docs/ARCHITECTURE.md`
- Deployment ops: `docs/ops/deployment.md`
- Testing strategy: `docs/testing-strategy.md`

## Directory Structure

```
backend/              # Python runtime
  agents/             # AI agent (pilgrimage_agent, tools, runner, retriever)
  domain/             # Entities, value objects, LLM schemas
  infrastructure/     # External adapters (DB, observability, gateways)
  interfaces/         # API surface (fastapi_service, public_api)
  tests/              # unit, integration, eval
frontend/             # Next.js OpenNext-SSR (.open-next/); TanStack Start rebuild planned
supabase/migrations/  # DDL migrations (timestamp-ordered)
worker/entry.js       # CF Worker entry (container proxy + image proxy → OpenNext)
```

## Commands

```bash
make dev-local        # one-command: Supabase + backend + frontend (:3001)
make dev-stop         # stop backend + frontend (Supabase stays)
make local-login      # open browser with magic link login
make dev              # install all deps (including dev)
make test             # unit tests
make test-integration # integration tests
make test-all         # unit + integration
make test-eval        # model-backed evals (separate)
make lint             # ruff check + format check
make format           # ruff auto-format + fix
make typecheck        # mypy strict
make check            # lint + typecheck + test
make e2e-setup        # start Supabase + Edge Function + seed data
make e2e              # run all Playwright E2E tests
make e2e-public       # E2E tests that don't need email (fast)
```

Frontend: `cd frontend && npm ci && npm run dev`

Notes:
- pytest: `--asyncio-mode=auto`
- pre-commit hooks: ruff + mypy on every commit

## Architecture

```
User text → RuntimeAPI.handle() → run_pilgrimage_agent() → pilgrimage_agent.run()
  → tools call handlers → AgentResult (typed output + steps + tool_state)
  → agent_result_to_response() → PublicAPIResponse

For selected_point_ids:
  User selection → execute_selected_route() → AgentResult → PublicAPIResponse
```

See `docs/ARCHITECTURE.md` for full details.

### Tools (@agent.tool registrations with ModelRetry guards)

| Tool | Description |
|---|---|
| `resolve_anime` | API-first title→bangumi_id; DB cache; write-through |
| `search_bangumi` | Retriever → points by bangumi_id |
| `search_nearby` | Geo retrieval by location + radius |
| `plan_route` | Nearest-neighbor route ordering |
| `greet_user` | Ephemeral greeting/identity response |
| `answer_question` | QA pass-through |
| `clarify` | Disambiguation when query is ambiguous |

## External API Reference

Full docs in `docs/api-reference/`. Key facts:

- **Anitabi** (`api.anitabi.cn`): Pilgrimage point data. Uses **Bangumi.tv subject IDs**. `GET /bangumi/{id}/lite` for metadata, `GET /bangumi/{id}/points/detail?haveImage=true` for full point list. Images at `image.anitabi.cn`. CC BY-NC-SA 4.0.
- **Bangumi** (`api.bgm.tv`): Anime metadata (title, cover, rating, eps). `GET /search/subject/{keywords}?type=2` for search, `GET /subject/{id}` for detail. `eps=1` → movie, `eps>1` → TV.
- Both APIs share the same subject ID system. Our DB uses these IDs as primary keys.

## Guardrails

- Orchestration: single PydanticAI agent (`pilgrimage_agent`) with typed output; selected-route path bypasses agent
- Tools use `ModelRetry` guards to reject invalid LLM parameters; `output_validator` rejects fabricated responses
- Auth: Next.js middleware (cookie-based for pages, JWT/sk_ for API); container trusts forwarded headers
- Frontend: Next.js OpenNext-SSR (`.open-next/` via next.config side-effect, NOT `output: export`); TanStack Start rebuild (SPA+SSG) planned
- No `Any` in Python — use `object` + `isinstance()` at trust boundaries
- New UI component = register in `frontend/components/generative/registry.ts` only
- Run `make check` before and after any change
- **No suppression without user approval.** Never add `eslint-disable`, `@ts-ignore`, `type: ignore`, `noqa`, `pragma: no cover`, `continue-on-error`, `skip`, or any other linting/type-checking suppression without explicit user confirmation. If a rule fires, fix the code instead.
- **Coverage thresholds may only be ratcheted UP, never lowered.** Current floors:
  - Frontend (vitest.config.ts): lines≥72%, statements≥68%, functions≥62%, branches≥59%
  - Backend (pytest.ini): ≥80%
  - When adding code that increases coverage, update the thresholds to the new floor

## Deployment

**Tag-based deploy:** push to main triggers CI (lint + test) but NOT deploy.
Deploy is triggered only by pushing a version tag.

```bash
git tag v1.x.x && git push origin v1.x.x  # triggers deploy
```

Flow: CI green → Tester validates on main → Tester tags → CI deploys to production.

- Container: FastAPI via Dockerfile → Cloudflare container
- Frontend: OpenNext-SSR build → `.open-next/` (worker.js + assets) → CF ASSETS binding (`.open-next/assets`); TanStack rebuild will switch to `.output/public`
- Worker: routes `/v1/*` to container, static to ASSETS
- DB migrations: applied during deploy step

## Test Environment

Local testing uses `supabase start` (full Supabase via Docker: Postgres + PostGIS + GoTrue + PostgREST):

```bash
supabase start                    # starts all Supabase services locally
# Outputs: API URL (localhost:54321), anon key, service_role key, DB URL (localhost:54322)
# Migrations from supabase/migrations/ are applied automatically

# Backend — connect to local Supabase:
export SUPABASE_URL=http://localhost:54321
export SUPABASE_DB_URL=postgresql://postgres:postgres@localhost:54322/postgres
make serve

# Frontend — set local Supabase in .env.local:
# NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
# NEXT_PUBLIC_SUPABASE_ANON_KEY=<from supabase start output>
cd frontend && npm run dev

supabase stop                     # cleanup
```

### E2E Testing (Playwright)

```bash
make e2e-setup        # one command: Supabase + seed + Edge Function + deps
make e2e              # run all 18 Playwright tests (serial, ~16s)
make e2e-public       # run 12 tests that don't need email (fast)
```

E2E tests live in `e2e/` (separate package.json, Playwright).
Requires: `supabase start` + `supabase functions serve send-auth-email --no-verify-jwt`
Frontend `.env.local` must point to local Supabase (`http://127.0.0.1:54321`).
Test data: `backend/tests/fixtures/seed.sql` (18 anime, 43 spots).
Mailpit UI: `http://localhost:54324` (view captured emails).

## Code Quality Standards

### 1-10-50 Rule
- Functions: max 10 lines. Classes: max 50 lines. Files: max 300 lines.
- Indentation: max 2 levels. Flatten with early return or extract.

### Type Safety
- No `dict[str, object]` — use dataclass or Pydantic model
- No `assert` for runtime validation — use `if not x: raise ValueError(...)`
- No bare `str` for IDs/statuses — use NewType, Literal, or Enum
- No `Any` — use `object` + `isinstance()` narrowing; Protocol for duck-typing, `cast()` at library boundaries (details: @docs/typing-rules.md)

### CSS Rules (auto-enforced)
- Read `frontend/DESIGN.md` before any design or UI work — it is the design system source of truth
- Animal Island UI reference: `docs/design/animal-island-ref/` (4 docs: color, typography, interaction, component specs) — read before component redesign work
- Tokens defined in `frontend/app/globals.css :root`; registered in `@theme inline` for Tailwind utilities
- Use semantic Tailwind classes: `bg-primary`, `text-foreground`, `border-border` — never `bg-[var(--color-*)]`
- Never use `style={{ }}` for values that have Tailwind equivalents (colors, spacing, font, radius, opacity)
- Never use `space-y-*` / `space-x-*` — use `flex flex-col gap-*` (shadcn rule)
- Never use template literal className ternaries — use `cn()` from `@/lib/utils`
- Never hardcode `oklch()` / hex in components — extract to CSS variable if used 2+ times
- Extract repeated animation strings to CSS classes in `globals.css` (`.entrance-up`, `.entrance-slide-right`, etc.)
- Use shadcn `<Skeleton>` for loading states — never hand-written `animate-pulse` divs
- Run `/css-audit` before committing frontend changes to catch remaining smells

### Test Quality
- No timing-dependent assertions — mock the clock
- No conditional logic in tests — split into separate tests
- Max 200 lines per test file. Max 5 mocks per test.

### TDD
- Backend: invoke `/backend-tdd` before writing Python code
- Frontend: invoke `/frontend-tdd` before writing React/TypeScript code

## Harness Engineering System

4-role agent harness. Definitions in `.claude/agents/`. Orchestration via `/iteration-planning` and `/iteration-execution`.

### Roles

| Role | Can do | Cannot do |
|---|---|---|
| Planner | Read code, write specs | Write code, create PRs |
| Executor | Write code + tests in worktree, create PR | Merge PRs, modify outside scope |
| Reviewer | Read diffs, run evals, approve/reject | Write code, merge PRs |
| Tester | Test running app, write E2E/API tests, tag for deploy | Read source code, edit production code |

### Workflow

```
Planner → spec (docs/superpowers/specs/)
  ↓
Coordinator → cards + wave graph (docs/superpowers/plans/)
  ↓
Per wave (parallel within wave, sequential across waves):
  Executor (worktree) → PR
  Reviewer → approve/request_changes
  Merge → rebase remaining PRs → next wave
  ↓
After all waves:
  Coordinator → pull main → supabase start → make serve → npm run dev → wait healthz
  Tester → test all ACs against running app (localhost:8080 + localhost:3000)
  All pass → Tester: git tag vX.Y.Z → push → CI deploys
  Coordinator → supabase stop → kill serve
```

### Agent Dispatch

- Executor: `subagent_type="executor"`, `model="sonnet"`, `isolation="worktree"`
- Reviewer: `subagent_type="reviewer"` (Read/Grep/Bash, no Write/Edit)
- Tester: `subagent_type="tester"` (Bash/Read/Write/Skill/WebFetch)
- In worktrees: `uv tool run ruff format` (not `uv run ruff format`)
- Reviewer: Codecov patch >= 95% (P1 if below, unless doc-only)

### Quality Ratchet

Every AC: test type annotation (unit|integration|eval|browser|api) + test in PR diff.
Reviewer verifies: `ac_total == ac_with_test`.

### Hook

`.claude/hookify.block-secrets-in-pr.local.md` — blocks gh pr comment/review containing secrets.

## File Placement

- Runtime: repo root or `backend/interfaces/`
- Docs: `docs/ops/` (ops), `docs/superpowers/plans/` (cards), `docs/superpowers/specs/` (specs)
- NEVER save working files to root folder

## gstack

Use `/browse` for all web browsing. Never use `mcp__claude-in-chrome__*` tools.
If broken: `cd ~/.claude/skills/gstack && ./setup`

## Skill Routing

IMPORTANT: When request matches a skill, invoke via Skill tool FIRST.

- Bugs, errors → /investigate
- Ship, deploy, PR → /ship
- QA, test → /qa
- Code review → /review
- Docs after ship → /document-release
- Retro → /retro
- Design system → /design-consultation
- Visual audit → /design-review
- Architecture → /plan-eng-review
- Code quality → /health
- Brainstorming → /office-hours
<!-- CLAUDE_CODE_MIGRATION_END:-Documents-Seichijunrei-agent-.claude-worktrees-ssr-migration-CLAUDE.md -->
