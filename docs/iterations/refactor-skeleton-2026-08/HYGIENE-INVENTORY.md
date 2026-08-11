# HY-1 Hygiene Inventory — refactor-skeleton 2026-08

Issue: #856 HY-1. Worktree-only inventory of root/docs drift after the monorepo
skeleton (apps/agent · workers/* · apps/web). Path renames (PATH-DELTA) follow
`docs/DOCS_POLICY.md` Single Sources of Truth: `backend/` → `apps/agent/`,
`worker/` / `worker/worker.js` → `workers/edge/`, `frontend/` → retired (#537) /
`apps/web/`. No git history rewrite; no mass tag/branch deletes.

## Decision rules

| Class | Action |
|---|---|
| Active runbook with wrong path | Fix path in place |
| Root README stale badge / env / example | Surgical rewrite |
| Historical review / archived plan citing old paths | Leave (archive is read-only history) |
| Tracked file with no consumers + strong evidence dead | Delete or archive under `docs/archive/` |
| Uncertain / still referenced by cutover runbook | Keep; list under Deferred |

## Root README fragments (en / ja / zh)

| Item | Evidence | Action |
|---|---|---|
| Next.js 16 badge | Legacy `frontend/` retired #537; browser surface is TanStack Start `apps/web/` | **Fixed** — badge → TanStack Start |
| Required `SUPABASE_ANON_KEY` "JWT validation at Worker edge" | `docs/ops/deployment.md`: edge JWT verifies public JWKS; anon key not required | **Fixed** — removed from required table |
| Python client example `animichi.clients.python.seichijunrei_client` | No such module under `apps/agent/src/animichi/clients/` (only catalog/geocode) | **Fixed** — example removed; SDK still Iteration-7 |
| How-it-works "Supabase points" | Catalog/user data plane is Neon; Supabase auth-only | **Fixed** — wording → catalog/Neon |
| Repo map missing `workers/users/`, `workers/maintenance/` | Live Workers per root `AGENTS.md` / `docs/ops/deployment.md` | **Fixed** — map rows added |
| Docs link "Implementation plans" → `docs/archive/plans/` | Flat plans empty; live history is `plans/archive/` (DOCS_POLICY A6) | **Fixed** — link to `plans/archive/` |
| Live demo host `seichijunrei.zhenjia.org` | Still the pre-apex public origin until domain cutover (#541 family) | **Keep** (ops fact, not path drift) |

## Deployment notes (duplicate / path drift)

| Location | Stale claim | Canonical | Action |
|---|---|---|---|
| `docs/ops/deployment.md` | `catalog/wrangler.toml` | `workers/catalog/wrangler.toml` | **Fixed** |
| `docs/ops/deployment.md` | bare `interfaces/fastapi_service.py` | `apps/agent/src/animichi/interfaces/fastapi_service.py` | **Fixed** |
| `docs/ops/deployment.md` | "Next.js app" in #537 note | HTML surface moved to `apps/web` (no Next.js residual for hygiene grep) | **Fixed** wording |
| `docs/ops/deployment.md` HISTORICAL `backend.scripts.backfill_city` | Pre-monorepo module path | Section already labeled historical-only | **Keep** (historical) |
| `docs/ops/cloudflare-hardening.md` | `worker/worker.js`, `frontend/out/`, `NEXT_PUBLIC_*` | `workers/edge/entry.ts` + `container-env.ts`; web = `apps/web` | **Fixed** topology + env table |
| `docs/ops/README.md` | Listed 4 of many live runbooks | Directory has maintenance, secrets, integration, … | **Fixed** — index expanded |
| `wrangler.toml` header | `SUPABASE_ANON_KEY` as edge JWT secret | Matches Env type leftover; runtime auth uses JWKS | **Fixed** comment (optional/legacy binding) |
| Root `DEPLOYMENT.md` | Already removed iter6 A6 (#640) | `docs/ops/deployment.md` only | No action |

## Dead links to retired `frontend/` / wrong paths (active surfaces)

| Surface | Finding | Action |
|---|---|---|
| Root `AGENTS.md` monorepo map | All package `AGENTS.md` targets exist; paths current | Verified OK |
| Root `AGENTS.md` "backend ≥82" | Live floor is 87 (`apps/agent/pyproject.toml` `--cov-fail-under`) | **Fixed** → `apps/agent ≥87` |
| `docs/ARCHITECTURE.md` #537 note | Mentions Next.js/OpenNext (S0.9 wants zero hits) | **Fixed** wording |
| `docs/testing-strategy.md` stack line | "Next.js + React (frontend)" | **Fixed** stack line + E2E ports note |
| `docs/testing-strategy.md` body | Many `frontend/` MSW path examples, `make test-frontend`, React/Next section | **Deferred** — full rewrite is S0.9/E1 (#262); not mass-edit this card |
| `apps/web/AGENTS.md` coverage floors | Claimed 95/94/95/95; config is 98/95/98/99 | **Fixed** to match `vitest.config.ts` |
| Archived reviews under `docs/archive/reviews/` | Full of `backend/` + `frontend/` | **Keep** (historical) |
| `docs/archive/frontend-*.md` | Intentional archive of retired frontend design | **Keep** |

## Candidate deletions (strong-evidence only)

| Candidate | Evidence | Decision |
|---|---|---|
| Root `DEPLOYMENT.md` / root-level `todo.md` / `CHANGELOG` / `VERSION` / `atlas.hcl` / `deno.lock` / skills-lock | Already absent from tree (S0-v2 GOAL A partial) | N/A |
| `scripts/qa_login.sh` + `scripts/qa_auth.py` (Supabase magic-link QA login) | **Retired by AUTH-2 #950** — the Neon Auth cutover replaced the Supabase login path; local login is `scripts/local-login.sh` (Neon, Path C), live-login E2E is `e2e/web-neon-login.spec.ts` | **Deleted** (cutover) |
| `apps/agent/.../spikes/codemode/` | Spike residual; S0-v2 GOAL A lists spikes cleanup | **Deferred** (behavior-adjacent; not pure docs HY-1) |
| Historical `docs/archive/reviews/*` | Pre-rename eng reviews | **Keep** in place (history) |

**No tracked file deleted in this card** — evidence for pure dead files was weak or cutover-blocked; prefer docs path fixes.

## AGENTS.md top-level map check

| Link / path | Status |
|---|---|
| `apps/agent/AGENTS.md` … `infra/AGENTS.md` (layout bullets) | OK |
| `docs/testing-strategy.md` | OK (exists; body partially stale — deferred) |
| `docs/ops/deployment.md` | OK |
| `docs/ARCHITECTURE.md` | OK |
| `docs/DOCS_POLICY.md` | OK |
| `docs/workflow.md` | OK |
| `docs/specs/2026-06-13-architecture-adr.md` | OK |
| `docs/specs/2026-07-06-frontend-rebuild-spec.md` | OK |
| `.claude/rules/` | OK (directory present) |

## Deferred (out of HY-1 surgical scope)

1. Full `docs/testing-strategy.md` rewrite (S0.9 / #262 E1) — coverage table already correct; body still uses legacy `frontend/` examples.
2. S0-v2 root allowlist hygiene test + dead-file script lock (launch spec Track A).
3. Spike / orphan script purge under `apps/agent` spikes.
4. Domain cutover copy (live demo URL → `animichi.com`) after #541 DNS/route ownership.
5. Archive-only reviews still citing `backend/`/`frontend/` — leave unless filter-repo (iter6 C3) rewrites history (explicitly out of scope for HY-1).

## PR-ready change set (this card)

- `docs/iterations/refactor-skeleton-2026-08/HYGIENE-INVENTORY.md` (this file)
- `README.md` · `README.ja.md` · `README.zh.md`
- `AGENTS.md`
- `docs/ops/deployment.md`
- `docs/ops/cloudflare-hardening.md`
- `docs/ops/README.md`
- `docs/ARCHITECTURE.md` (historical wording only)
- `docs/testing-strategy.md` (stack + E2E env lines only)
- `apps/web/AGENTS.md` (coverage floor mirror)
- `wrangler.toml` (header comment only)
