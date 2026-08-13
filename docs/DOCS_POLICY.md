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
| `migrations/AGENTS.md` · `e2e/AGENTS.md` · `infra/AGENTS.md` | Atlas migrations, browser tests, and IaC conventions |
| `.claude/rules/*.md` | Path-scoped rules loaded only for matching files |
| `docs/ARCHITECTURE.md` | Live runtime reference (refresh pending — see Source-of-Truth notes below) |
| `docs/ops/deployment.md` | Deployment runbook |
| `docs/ops/secrets.md` | What each repository secret is for, who consumes it, and rotation impact |
| `docs/iterations/README.md` | Main task tracker / session log / findings — pointer into the live iteration (no hardcoded `iterN`) |

## Docs Tree Map (W1)

Sole navigation for `docs/` — no docs-level README. Paths on the post-reorg layout (#908 W1).

| Path | Holds | Write policy |
|---|---|---|
| `docs/specs/` | Active, non-superseded design specs (ADRs live flat) | Superseded → `docs/archive/specs/` (one-way) |
| `docs/adr/` | Registered ADRs 0001–0005 (canonical) | Amend via a new ADR |
| `docs/ops/` | Live runbooks (deployment, hardening, maintenance, …) | Update in place |
| `docs/iterations/` | Active iteration artifacts + `README.md` pointer | Per-iteration dirs |
| `docs/archive/` | `specs/` · `plans/` · `reviews/` · `design-sync/` · `mockups-demo/` · `landing-hero/` · `review-boards/` | Read-only history |
| `docs/design/` | Live design guidance (tokens, mascot, prompts) | Update in place |
| `docs/api-reference/` · `docs/agents/` | External API refs · agent guides | Update in place |

## Rules

1. Do not keep legacy and current architecture docs side by side.
2. Do not add separate roadmap files when the live iteration (see `docs/iterations/README.md`) already tracks the work.
3. If a subsystem is removed from the codebase, remove its docs in the same change.
4. Prefer linking to code paths over hardcoding volatile counts.
5. Planning docs may contain process detail; README and architecture docs should not.
6. Put operational docs under `docs/ops/` and iteration artifacts under `docs/iterations/`.
7. Docs images >1MB: never commit. Upload to the private R2 bucket and link through the edge
   `/img` proxy (`workers/edge/proxy/image-proxy.ts` — upstreams `image.anitabi.cn` today; R2-backed
   serving is a listed edge extension). Legacy >1MB assets under `docs/archive/` are W6 strip candidates.

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
| **Why** the architecture is shaped this way | `docs/specs/2026-06-13-architecture-adr.md` | Foundational ADR; its "全 TS on Workers" decision was later refined by the rebuild spec below |
| **Current target** architecture (hybrid, latest) | `docs/specs/2026-07-06-frontend-rebuild-spec.md` | Latest; supersedes the ADR on agent language; rebuild in progress |
| Live agent runtime reference | `docs/ARCHITECTURE.md` + `apps/agent/src/animichi/agents/animichi_runner.py` | Runtime is still Python & live |
| Agent entry | `apps/agent/src/animichi/interfaces/fastapi_service.py` → `public_api.py` → `agents/animichi_runner.py` | was `backend/interfaces/…` |
| Agent shared types | `apps/agent/src/animichi/agents/models.py`, `…/agent_result.py` | was `backend/agents/…` |
| Agent tools | `apps/agent/src/animichi/agents/animichi_tools.py` + `web_tools.py` | Typed `TOOLS` lists injected by `build_animichi_agent()` |
| Catalog service (TS) + data platform | `workers/catalog/src/` — `ingest/` · `enrich/` · `publish/` · `api/` · `router.ts` | realizes the ADR's ingest→enrich→publish |
| Cross-service contract (zod = SoT) | `packages/contract/src/` (`models.ts`, `contract.ts`, `errors.ts`) + `packages/contract/README.md` | error registry + parity guard live here |
| User-domain service | `workers/users/` + `workers/users/AGENTS.md` | Live Hono/oRPC/jose service over Neon, `/v1/users/*` |
| Edge worker / auth / routing | `workers/edge/src/entry.ts` (+ `src/app.ts`, `src/identity/auth.ts`) | was `worker/worker.js`, then `worker/` (iter6 C2) |
| Deploy wiring | `workers/edge/wrangler.toml` + `workers/edge/src/entry.ts` + `docs/ops/deployment.md` | deployment.md = canonical runbook |
| DB — catalog/user data | **Neon** (Drizzle raw-SQL query-only over neon-http); migrations in `db/` (Atlas) | data plane; no Hyperdrive |
| DB — auth | **Supabase** (auth-only); migrations in `supabase/migrations/` | |
| Web app (the only browser surface) | `apps/web/` + `apps/web/AGENTS.md` (TanStack Start) | Legacy `frontend/` retired in #537; spec `2026-07-06-frontend-rebuild-spec.md` |
| Design tokens / system | `apps/web/` (animal-island-ui-tailwind); ref `docs/design/animal-island-ref/` | |
| Eval | `apps/agent/src/animichi/tests/eval/` (Python) | |
| Testing strategy | `docs/testing-strategy.md` | |
| Deployment ops | `docs/ops/deployment.md`, `docs/ops/cloudflare-hardening.md` | |
| Secrets architecture / worker secrets | `docs/adr/0003-secrets-architecture.md` | CF Secrets Store + Neon-hosted role passwords + Pulumi `neon.Role`; supersedes the ESC-first plan of #674 |
| Local development gates | `docs/ops/local-gates.md` + `.pre-commit-config.yaml` | changed-package routing (`--staged` pre-commit / merge-base pre-push); single pre-push orchestrator `scripts/local-gates/pre-push.sh`; agent gate = ruff lint/format + mypy + vulture + coverage + offline Docker integration + container build (parity with `pipeline-agent.yml`); canonical 87 agent floor; offline Docker/web integration locally; browser e2e/live-Neon/evals/deploys stay in CI |
| Close-out campaign (2026-08) | `docs/specs/2026-08-08-repo-closeout-spec.md` | ADRs 0004/0005; merges restructure-spec × GOAL; waves P0–P8 |
| Neon backup / RPO / bad-migration recovery | `docs/ops/neon-backup-rpo.md` | N5 (#860); PITR + HITL checklist; pairs with `migrations.md` |
| Iteration specs (live) | `docs/specs/` — 平层只放非 superseded spec(不维护名单;以 superseded 标注与 archive 位为准) | superseded spec 一律入 `docs/archive/specs/`(只进不出,iter6 A6/#640) |
| Iteration plans | 当前 iteration 的计划在 `docs/iterations/<iterN>/`;历史执行 plan 全部在 `docs/archive/plans/` | 平层不再新增 plan(iter6 A6/#640) |
| Iteration progress/handoff | `docs/iterations/<iterN>/`(progress、task_plan、handoff、status) | 根目录禁放(File Placement 规则) |

## Review Check

Before merging documentation changes:

- Is the doc still true after this patch?
- Does it duplicate another file?
- Does it describe code that no longer exists?
- Does it introduce a second architecture narrative?
