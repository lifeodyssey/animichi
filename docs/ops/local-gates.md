# Local Gates Design — changed-package routing (monorepo)

Campaign lesson: code repeatedly reached CI that local gates should have caught (ruff format in `scripts/*.py`, SC2086 ×2, edge lint, TS typecheck, stale `atlas.sum`). CI remains the terminal gate; local gates make a red push the exception.

## Principles

1. **Changed-package routing** — a push touches packages; only those packages' gates run. Full-repo runs are reserved for the few sub-second checks.
2. **Two stages**: pre-commit (seconds — formatting/lint/syntax/secrets) and pre-push (minutes — typecheck + unit tests + integrity). Integration tests do **not** run locally (see below).
3. **No suppressions**: a failing gate must be fixed or explicitly triaged; `--no-verify` is documented as a policy violation (CI still enforces).
4. **Sourcery is not a local hook**: PR review via the GitHub App (installed).

## Package map (git diff path → gate set)

| Path prefix | Package | pre-commit lint | pre-push checks |
|---|---|---|---|
| `apps/agent/` | agent | ruff + ruff-format (py) | `uv run mypy` + `uv run pytest src/animichi/tests/unit -q --cov --cov-fail-under=82` |
| `apps/web/` | web | oxlint (type-aware) | `tsc --noEmit` + vitest unit |
| `workers/catalog/` | catalog | oxlint | `tsc --noEmit` + vitest worker suite |
| `workers/users/` | users | oxlint | `tsc --noEmit` + vitest |
| `workers/edge/` | edge | oxlint | `tsc --noEmit` + `node --test workers/edge/*.test.ts` |
| `workers/jobs/` | jobs | oxlint | `tsc --noEmit` + vitest |
| `packages/contract/` | contract | oxlint | `tsc --noEmit` + contract tests |
| `infra/` | infra | — (oxlint not used) | `tsc --noEmit` + `node --test topology-*.test.ts` |
| `migrations/` | db | — | `atlas migrate validate --dir migrations/neon` |
| `.github/` | ci | actionlint (workflows) | `check-actions-pinned.sh` + `assert-workflow-invariants.rb` |
| `scripts/`, `.github/scripts/` | scripts | shellcheck (shell) + ruff (py) | — |
| `docs/` | docs | — | doc-consistency subset (`test_secrets_docs_consistency.py` + link check) |
| anything else / unknown | — | — | typecheck on all packages (conservative fallback) |

`packages/contract` is treated as changed whenever any of its consumers changed (contract is the cross-service source of truth) — the router unions: changed packages ∪ {contract if any worker/web/agent changed}.

## Changed-package detection

```
scripts/local-gates/changed-packages.sh
  base = origin/main (or HEAD^ when origin is missing)
  git diff --name-only $base...HEAD | prefix-map → sorted unique package set
```

Output format: one package per line (`agent catalog contract …`). Hooks read it and dispatch per-package commands; empty set → only universal checks.

## pre-commit (universal + changed packages)

Universal (always, sub-second):
- trailing-whitespace, end-of-file-fixer, check-yaml, check-toml
- gitleaks (secret scan)
- shellcheck (on `scripts/` + `.github/scripts/` shell files, `--severity=warning`)
- actionlint (on `.github/workflows/*.{yml,yaml}`)

Changed packages:
- agent → `ruff check --fix` + `ruff format` (all repo Python — ruff is fast enough to run repo-wide, kept universal for Python actually)
- web/catalog/users/edge/jobs → `oxlint --type-aware --deny-warnings` scoped to the package

Note: ruff runs repo-wide (universal) because Python files are few and ruff is sub-second; oxlint runs per changed TS package.

## pre-push (changed packages, < ~3 min typical)

- typecheck: changed package's `tsc --noEmit` (agent: mypy)
- unit tests: changed package's fast suite (see table)
- `db` changed → `atlas migrate validate --dir migrations/neon`
- `ci` changed → pinned-actions + workflow invariants scripts
- `docs` changed → doc-consistency subset
- always: agent unit coverage gate when agent changed

Command notes: pnpm workspaces — `pnpm --filter catalog typecheck` etc.; edge tests run from the repo root (`pnpm run test:worker`).

## Why integration tests stay in CI

Integration tests require real environments: Neon ephemeral branches (python-integration, catalog spikes), PostGIS+pgvector containers, Playwright browsers (cross-stack e2e). They are minutes-long, environment-dependent, and their value is cross-component behaviour, not per-push feedback. They run in CI on every PR (required lanes) and on demand locally via `make test-integration` / `make e2e` / `pnpm run test:spike`. Local hooks cover the unit layer; CI owns the integration layer — this is the standard monorepo split.

## Failure handling

- pre-commit failures: fix in working tree, re-run (auto-fix hooks modify files).
- pre-push failures: fix or, when the failure is environmental (e.g. atlas needs docker), document the exemption in the commit/push — policy: no silent `--no-verify`; CI still gates.
- Router bugs: unknown paths fall back to full typecheck (conservative).

## Files

- `scripts/local-gates/changed-packages.sh` — the router
- `.pre-commit-config.yaml` — hook wiring (existing, reworked)
- This document — the contract
