# Neon environment topology + branch SLA

**Ticket:** [#859](https://github.com/lifeodyssey/animichi/issues/859) · **Parent:** [#829](https://github.com/lifeodyssey/animichi/issues/829)
**DBA map:** `docs/specs/2026-08-06-neon-dba-capability-map.md` (N3)

## Branches / environments

| Name | Purpose | Wipe policy | Who applies migrations | Notes |
| --- | --- | --- | --- | --- |
| **production** (`main` compute) | Live user data | **No wipe** | Main-only CD database phase (migrator DSN); one human approval before the production cohort | Soft baseline only for history squash (#845/#849) |
| **staging** | Pre-prod integration | Wipe **allowed** with owner go (campaign W6 may wipe or soft-baseline) | Main-only CD calls the OIDC-authenticated migrator; owner break-glass CLI only with explicit HITL, not routine | Target for #832 min-privilege DSN cutover first |
| **test-base** | Integration fixture parent | Wipe + reseed **expected** | Refreshed manually with a personal `NEON_API_KEY` (#1053 retired the CI workflow; the branch is data, not CI) | Not production-like traffic; no DB-backed CI lane connects to it (that lane is hermetic Docker) |
| **dev** (personal / shared dev branch) | Local and ad-hoc agent work | Wipe OK | Developer with branch DSN | Prefer branch-per-PR when available |
| **preview / PR** (optional Neon branch) | Isolated PR schema checks | Ephemeral; delete with PR | CI create-branch + migrate on branch URL | Use Neon create-branch Action if enabled |

## SLA / retention (intent)

| Concern | Intent |
| --- | --- |
| Staging uptime | Best-effort; may break during refactor trains |
| Production RPO | Neon PITR / plan backup window — detail in N5 (#860) |
| Migration apply window | Staging: anytime on merge to main deploy path; Prod: only via production deploy gate |
| Who may hold migrator DSN | CI + break-glass owners only; never Worker runtime secrets |

## Apply path (current)

1. **PR / affected CI:** the `db` component lane runs `prisma migration check` and a disposable fresh-schema apply hermetically; the live-Neon dry-run was dropped with the test-infra retirement #1053.
2. **Deploy:** `cd.yml` builds one sealed migrator bundle. Both environments send the selected schema identity to their own OIDC-authenticated migrator, which holds the DSN; production applies the same bundle after approval.
3. **Local:** there is no local apply. `make db-lint` / `make db-status` are static, and the disposable fresh-schema gate applies to a throwaway container only.

## Align with campaign decisions

- Role matrix SQL: #831 · staging wire: #832 · prod: #855
- History squash / gazetteer out of chain: #845–#850
- Update wipe row for staging when #845 D1 is locked (wipe vs soft).

## Links

- `db/AGENTS.md` — ownership + role intent (#830)
- `docs/ops/deployment.md` — deploy orchestration
