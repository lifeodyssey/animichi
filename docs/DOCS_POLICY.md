# Documentation Policy

## Principle

Keep one architecture story and one task board.

Code and tests are the primary source of truth. Documentation should describe
stable boundaries, current entry points, and active plans only.

## Canonical Docs

| Document | Purpose |
|----------|---------|
| `README.md` | Repo entry point and current usage |
| `AGENTS.md` | Canonical root guide — identity, monorepo layout, cross-stack guardrails, tool routing |
| `CLAUDE.md` | Claude Code pointer (`@AGENTS.md`) — same content as `AGENTS.md` |
| `apps/agent/AGENTS.md` | Python agent (PydanticAI / FastAPI) conventions |
| `workers/catalog/AGENTS.md` | Catalog Worker (Hono / oRPC / Drizzle) + data-platform conventions |
| `workers/users/AGENTS.md` | Live user-domain Worker (Hono / oRPC / jose) conventions |
| `packages/contract/AGENTS.md` | Cross-service oRPC/Zod contract conventions |
| `apps/web/AGENTS.md` | TanStack Start rebuild conventions |
| `db/AGENTS.md` · `e2e/AGENTS.md` · `infra/AGENTS.md` | Migrations, browser tests, and IaC conventions |
| `.claude/rules/*.md` | Path-scoped rules loaded only for matching files |
| `docs/ARCHITECTURE.md` | Live runtime reference (refresh pending — see Source-of-Truth notes below) |
| `docs/ops/deployment.md` | Deployment runbook |
| `docs/ops/secrets.md` | What each repository secret is for, who consumes it, and rotation impact |
| `docs/iterations/iter5/task_plan.md` | Main task tracker |
| `docs/iterations/iter5/progress.md` | Session log |
| `docs/iterations/iter5/findings.md` | Current design findings and rationale |

## Rules

1. Do not keep legacy and current architecture docs side by side.
2. Do not add separate roadmap files when `docs/iterations/iter5/task_plan.md` already tracks the work.
3. If a subsystem is removed from the codebase, remove its docs in the same change.
4. Prefer linking to code paths over hardcoding volatile counts.
5. Planning docs may contain process detail; README and architecture docs should not.
6. Put operational docs under `docs/ops/` and iteration artifacts under `docs/iterations/`.

## Agent-docs Network

- `AGENTS.md` is canonical in each documented directory; root routes to the deeper package guide.
- Every package `AGENTS.md` has a sibling `CLAUDE.md` containing exactly `@AGENTS.md` plus newline
  (11 bytes). Never duplicate the guide into the pointer file.
- Package guides cover: identity/ownership, grounded commands, conventions, key entrypoints, and
  real pitfalls. Keep root near 200 lines and package files near 120.
- `.claude/rules/*.md` are path-scoped policy overlays, not substitutes for package guides. Their
  YAML `paths` frontmatter must match the files whose behavior they govern.

## Single Sources Of Truth

The one canonical topic→source map for this repo. Root `AGENTS.md` links here instead of keeping a
second copy — two tables drift (the exact failure the Review Check below warns against). Paths are on
the current monorepo layout; `backend/…` and `worker/worker.js` are pre-monorepo/pre-rename and gone.

| Topic | Current source of truth | Notes / was |
|---|---|---|
| **Why** the architecture is shaped this way | `docs/superpowers/specs/2026-06-13-architecture-adr.md` | Foundational ADR; its "全 TS on Workers" decision was later refined by the rebuild spec below |
| **Current target** architecture (hybrid, latest) | `docs/superpowers/specs/2026-07-06-frontend-rebuild-spec.md` | Latest; supersedes the ADR on agent language; rebuild in progress |
| Live agent runtime reference | `docs/ARCHITECTURE.md` **(paths need a refresh — separate PR)** + `apps/agent/agent/agents/animichi_runner.py` | Runtime is still Python & live; the doc's paths are stale |
| Agent entry | `apps/agent/agent/interfaces/fastapi_service.py` → `public_api.py` → `agents/animichi_runner.py` | was `backend/interfaces/…` |
| Agent shared types | `apps/agent/agent/agents/models.py`, `…/agent_result.py` | was `backend/agents/…` |
| Agent tools | `apps/agent/agent/agents/animichi_tools.py` + `web_tools.py` | Typed `TOOLS` lists injected by `build_animichi_agent()` |
| Catalog service (TS) + data platform | `workers/catalog/src/` — `ingest/` · `enrich/` · `publish/` · `api/` · `router.ts` | realizes the ADR's ingest→enrich→publish |
| Cross-service contract (zod = SoT) | `packages/contract/src/` (`models.ts`, `contract.ts`, `errors.ts`) + `packages/contract/README.md` | error registry + parity guard live here |
| User-domain service | `workers/users/` + `workers/users/AGENTS.md` | Live Hono/oRPC/jose service over Neon, `/v1/users/*` |
| Edge worker / auth / routing | `worker/entry.ts` (+ `app.ts`, `auth.ts`) | was `worker/worker.js` |
| Deploy wiring | `wrangler.toml` + `worker/entry.ts` + `docs/ops/deployment.md` | deployment.md = canonical runbook |
| DB — catalog/user data | **Neon** (Drizzle raw-SQL query-only over neon-http); migrations in `db/` (Atlas) | data plane; no Hyperdrive |
| DB — auth | **Supabase** (auth-only); migrations in `supabase/migrations/` | |
| Web app (the only browser surface) | `apps/web/` + `apps/web/AGENTS.md` (TanStack Start) | Legacy `frontend/` retired in #537; spec `2026-07-06-frontend-rebuild-spec.md` |
| Design tokens / system | `apps/web/` (animal-island-ui-tailwind); ref `docs/design/animal-island-ref/` | |
| Eval | `apps/agent/agent/tests/eval/` (Python) | |
| Testing strategy | `docs/testing-strategy.md` | |
| Deployment ops | `docs/ops/deployment.md`, `docs/ops/cloudflare-hardening.md` | |
| Iteration specs (live) | `docs/superpowers/specs/` — 平层只放活跃 spec(cicd-rebuild、catalog-rpc、byok、s1.7、neon-test-infra、rebuild、ADR) | 过时 spec 一律入 `specs/archive/`(只进不出,iter6 A6/#640) |
| Iteration plans | 当前 iteration 的计划在 `docs/iterations/<iterN>/`;历史执行 plan 全部在 `docs/superpowers/plans/archive/` | 平层不再新增 plan(iter6 A6/#640) |
| Iteration progress/handoff | `docs/iterations/<iterN>/`(progress、task_plan、handoff、status) | 根目录禁放(File Placement 规则) |
| Anonymous session purge | `docs/ops/anonymous-session-purge.md`, `.github/workflows/purge-anonymous-sessions.yml` | scheduled retention sweep, issue #273 Task 3 |

## Review Check

Before merging documentation changes:

- Is the doc still true after this patch?
- Does it duplicate another file?
- Does it describe code that no longer exists?
- Does it introduce a second architecture narrative?
