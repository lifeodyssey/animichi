# Animichi — AGENTS.md

Canonical repo guide for agentic coding tools. Claude Code reaches this via `CLAUDE.md`
(`@AGENTS.md`); Codex, pi, kimi, opencode and the other AGENTS.md-native tools read it directly.
It is the entry point and the index: what every task needs is inline, everything else is one link
away — "Shared agent knowledge" below, the per-package `AGENTS.md` files, `.claude/rules/`.

Animichi is an anime pilgrimage search + route-planning service. **Hybrid microservices**:
TypeScript Cloudflare Workers (the edge Worker's gateway + native Pi agent tier, catalog, users,
migrator) + a TanStack web app. The Python PydanticAI agent was retired with its CI lane (#1607).
Data plane = Neon;
auth = **Neon Auth (Better Auth) integrated in `apps/web`** (SD-31); the edge verifies Neon Auth
JWTs only (AUTH-2 #950 hard cut — Supabase verification deleted); the users worker trusts only the
edge-forwarded identity. **Do not add Supabase-auth or self-verification code**.

## Monorepo layout

- `workers/catalog/`   — TS Worker: anime catalog API + data platform (ingest/enrich/publish). → `workers/catalog/AGENTS.md`
- `workers/users/`     — LIVE Hono/oRPC user-data Worker over Neon; verifies nothing itself (no `jose`) — it trusts the edge-forwarded identity; 13 `test/*.worker.test.ts` files + CI lane. → `workers/users/AGENTS.md`
- `packages/agent/`    — Platform-independent TS agent domain library (`@animichi/agent`), consumed by edge. → `packages/agent/AGENTS.md`
- `packages/contract/` — Shared oRPC/zod contract; cross-service source of truth. → `packages/contract/AGENTS.md`
- `packages/eval/`     — Node native Pi task and preserved statistical oracles with `logfire/evals`. → `packages/eval/AGENTS.md`
- `packages/pi-session-neon/` — Native Pi session storage (`NeonStorage`/`NeonSessionRepo`) and the data plane's one Prisma 8 chain (`migrations/`), the whole migration authority (#1636). → `packages/pi-session-neon/AGENTS.md`
- `packages/prisma-geography/` — Private Prisma 8 PostGIS geography extension pack; control/runtime descriptors and disposable-DB evidence. → `packages/prisma-geography/AGENTS.md`
- `packages/test-postgres/` — Test-only Postgres data plane (image, readiness wait, clean DB, the Prisma chain, the five service roles) shared by every database-backed suite. → `packages/test-postgres/AGENTS.md`
- `apps/web/`          — TanStack Start SSR app; **the only browser surface** (legacy `frontend/` retired, #537). → `apps/web/AGENTS.md`
- `workers/edge/`      — CF edge worker (`workers/edge/src/entry.ts`): the gateway (auth, `/v1` routing, the image/tile proxies incl. the private `docs-assets` arm at `/img/docs/*`; no page fallback — unmatched paths 404) **and**, the native Pi agent tier (`workers/edge/src/agent/`: authenticated admission → `SessionAgent` → Neon settlement) — most of the package's source is now that tier. → `workers/edge/AGENTS.md`
- `workers/migrator/`  — TS Worker that applies the one Prisma chain (bundled into the Worker) behind GitHub OIDC; `supabase/` is an archived historical migration dir (issue #1000), not a live surface. → `workers/migrator/AGENTS.md`
- `e2e/`               — Playwright browser suite for `apps/web`. → `e2e/AGENTS.md`
- `infra/`             — Pulumi Cloudflare IaC. → `infra/AGENTS.md`

## Core commands (from repo root)

- `make check-full`    — every package's lint + typecheck + test + test:integration, the fresh-schema
  apply and the catalog spike. **Run before AND after a change that spans packages**; a single
  package's own scripts are the loop for anything narrower.
- `make dev-local`     — the web app, one command (never start services individually). Login is Neon Auth (AUTH-2 #950).
- `make local-login`   — browser magic-link login for local dev.
- `make e2e-setup` then `make e2e` — Playwright E2E (details in `docs/testing-strategy.md`).
- `pnpm run test:worker` — edge worker tests. Per-package commands live in that package's `AGENTS.md`.

## Cross-stack guardrails (apply everywhere)

- **1-10-50**: functions ≤10 lines, classes ≤50, files ≤300; ≤2 indent levels (early-return / extract).
- **No `any`** in TypeScript — model the shape.
- **Never request a third-party upstream from a test, a script, or a development machine.**
  `api.anitabi.cn` and `image.anitabi.cn` are reached only by the deployed egress service, and only
  in the shapes `docs/api-reference/anitabi-api.md` describes — that document is the authority, and
  anything it does not describe is not permitted. Tests stub the upstream; to see a real response,
  read the pinned document. We are rate-limited by agreement and have already been refused once, so
  an exploratory `curl` spends a relationship rather than a request.
- **No suppression without user approval** — no `eslint-disable` / `@ts-ignore` / `type: ignore` /
  `noqa` / `pragma: no cover` / `continue-on-error` / `skip`. Fix the code; don't silence the rule.
- **TypeScript gate** — TypeScript 7.0.2 direct + type-aware oxlint/tsgolint with
  `--deny-warnings` across every package. ESLint left the repo with `frontend/` (#537).
- **Coverage floors ratchet UP only** — `apps/web` floors live in `apps/web/vitest.config.ts` (mirrored in `apps/web/AGENTS.md`).
- **Test quality**: mock the clock (no timing-dependent asserts); no conditional logic in tests
  (split them); ≤200 lines per test file; ≤5 mocks per test.
- **No local deploy** (`block-local-deploy`, an owner-local rule — see `docs/agents/harness.md`) — CD only: a push to
  `main` builds a complete immutable release snapshot and dispatches CD for that snapshot's own
  artifact ID; a manual dispatch can still select another existing `artifact_id`. CD deploys it to
  staging, then promotes the same digests after the actual production job's GitHub environment
  approval. Main commits may be skipped; there is no tag deployment path.
  Platform activation prerequisites and operator steps → `docs/ops/deployment.md`.

## Testing rules (owner, verbatim)

- "NEVER write unit tests after you write code."
- "Highly prefer E2E tests as the sole testing mechanism. Use them to verify complex features work. At the end of E2E tests, produce a verifiable and repeatable artifact."
- "If you must test a system in isolation, FIRST write all the ways it could fail, THEN write the code."

## Recording new knowledge (every agent)

- Durable learnings are recorded where all agents read them: the guides indexed below and the
  machine-local directory named there. No agent-private memory store (Claude auto-memory, Codex
  memory, a session note) is the record.
- Public and non-sensitive learnings go to the `docs/agents/<topic>.md` that owns the topic, by
  PR, batched with the work that produced them; keep the why, the incident and the date.
- Machine-local or sensitive learnings (paths on this machine, identifiers, credential recipes,
  tool quirks) go to `~/.agents/projects/animichi/`, written immediately, never into the repository.
- A short normative constraint on specific paths goes to `.claude/rules/<name>.md` with a
  `paths:` frontmatter, force-added because `.claude/` is gitignored (`.claude/rules/git-commit.md`);
  cross-cutting guidance stays in `docs/agents/`.

## Authoritative docs (read the matching one when doing that work)

- Architecture **why** → `docs/specs/2026-06-13-architecture-adr.md`
- Current **target** for the agent runtime and eval (native Pi harness inside `workers/edge`;
  supersedes SD-4 of the rebuild spec) → `docs/specs/2026-09-09-agent-on-pi-harness-spec.md`
- Web rebuild target (still canonical for `apps/web`) → `docs/specs/2026-07-06-frontend-rebuild-spec.md`
- Current runtime **reference** (native chat, remaining services and verification boundaries) → `docs/ARCHITECTURE.md`
- Deploy runbook → `docs/ops/deployment.md`
- **What we may request from Anitabi** (the pinned upstream document; nothing outside it is
  permitted) → `docs/api-reference/anitabi-api.md`, with the egress service and the agreed rate in
  `docs/ops/anitabi-egress.md`
- **Single Source-of-Truth table + doc-change rules** → `docs/DOCS_POLICY.md` (the one canonical topic→path map)
- Current **campaign tracking** (merged restructure-spec × GOAL; waves P0–P8; ADRs 0003–0005) →
  `docs/specs/2026-08-08-repo-closeout-spec.md`

## Shared agent knowledge (read the matching one when doing that work)

Topic guides in `docs/agents/`:

- `docs/agents/package-managers.md` — pnpm 12 settings, catalogs, uv, Bundler. Before touching a dependency.
- `docs/agents/commit-and-pr-hygiene.md` — one outcome per commit; subject format; commitlint; no trailers. Before committing.
- `docs/agents/tool-routing.md` — skill-first routing, Orca vs legacy Codex, MCP servers, stack skills. Before choosing a tool.
- `docs/agents/harness.md` — the 4-role system, Quality Ratchet, committed vs owner-local gates,
  Escalation path (who decides). Before dispatching or escalating.
- `docs/agents/delivery-flow.md` — ticket → PR → merge → deployed: `/to-tickets`, pre-dispatch checks,
  one story = one PR, stacked PRs, review rounds, Checks before a PR merges, CD observation. When moving a card.
- `docs/agents/review-and-verification.md` — the false greens recorded here and what caught each: mutation
  scope, fake boundaries, stale text, writer tampering. Before reviewing or accepting work.
- `docs/agents/worktrees-and-local-gates.md` — base reset, one worktree per agent, commit and push
  verification, hooks, removal after merge. Before creating or removing a worktree.
- `docs/agents/ci-and-github-mechanics.md` — green-but-BLOCKED, startup failures, ruleset facts, ESC
  traps, "works locally". When CI or the merge state confuses you.
- `docs/agents/code-standards.md` — methodology mandate, no compat shims, latest deps, official SDKs, `pnpm exec`. Before writing code.
- `docs/agents/database-and-migrations.md` — Neon role scoping, table ownership, the WebSocket-only driver,
  `neonctl` traps, counting round trips. Before touching the data plane.
- `docs/agents/infra-and-secrets.md` — secrets by Pulumi, values never in chat, prove before replacing,
  non-interactive CLI writes. Before any operational step.
- `docs/agents/agent-and-eval.md` — the owner's best-practice source, why the eval SUT is the agent,
  evaluator traps, model facts. Before touching the agent tier or `packages/eval`.
- `docs/agents/frontend.md` — design-system lineage, design-skill entry points, visible-UI cards, the installed API. Before touching `apps/web`.
- `docs/agents/owner-decisions.md` — standing owner decisions with date and issue. Before proposing scope.
- `docs/agents/issue-tracker.md` — GitHub Issues (`lifeodyssey/animichi`) via `gh`; wayfinding operations. Before touching an issue.
- `docs/agents/triage-labels.md` — the five triage roles mapped 1:1 to label strings, plus `wayfinder:*`. When labelling.
- `docs/agents/domain.md` — root `CONTEXT-MAP.md` → per-package `CONTEXT.md`; system ADRs in `docs/adr/`. Before exploring a package.
- `docs/agents/orca-project-setup.md` · `docs/agents/orca-coordinator-prompt.md` — Orca project settings and prompt. When coordinating a card in Orca.

Path-scoped rules in `.claude/rules/` (Claude Code loads each for matching paths; every other
agent reads them from here):

- `.claude/rules/git-commit.md` — commit discipline; what hooks do to a failed commit; `.claude/` tracking. When committing, anywhere.
- `.claude/rules/worktree-hygiene.md` — record state before acting in a worktree; hooks on; remove after merge. When acting in any worktree.
- `.claude/rules/naming-ownership.md` — no `helper`/`util`/`manager`; SOLID over 1-10-50; limits by design. When naming or splitting code.
- `.claude/rules/tests.md` — name tests by SUT; readability is a deletion criterion; platform before assertion. When writing or moving a test.
- `.claude/rules/lint.md` — the oxlint gate for live TypeScript packages. When editing `workers/**`, `packages/**` or `apps/web/**` TypeScript.
- `.claude/rules/css.md` — frontend CSS/UI rules; read `apps/web/AGENTS.md` first. When editing `apps/web` `.tsx` or `.css`.
- `.claude/rules/ci.md` — GitHub Actions authoring: lanes, pinning, compile-time constraints. When editing `.github/{workflows,actions,test,lib,scripts}/**` or `test/repo-config/**`.
- `.claude/rules/infra.md` — Pulumi IaC scope, state backend, secrets, production approval. When editing `infra/**`.

Machine-local notes and private references (this machine's tooling, identifiers, credential
recipes, Orca operation) live outside the repository at `~/.agents/projects/animichi/`. Read them
there when present; never copy them into the repository.

## File placement

Never save working files to the repo root. Doc placement + the doc-change checklist → `docs/DOCS_POLICY.md`.

Workflow overview (Matt × Policy C): `docs/workflow.md`.
