# Neon environment topology + branch SLA

**Ticket:** [#859](https://github.com/lifeodyssey/animichi/issues/859) · **Parent:** [#829](https://github.com/lifeodyssey/animichi/issues/829)
**DBA map:** `docs/specs/2026-08-06-neon-dba-capability-map.md` (N3)

## Branches / environments

| Name | Purpose | Wipe policy | Who applies Atlas migrations | Notes |
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
| Who may hold migrator DSN | CI + break-glass owners only; never Worker/container runtime secrets |

## Apply path (current)

1. **PR / affected CI:** the `db` component lane runs `atlas migrate validate` hermetically; the live-Neon dry-run was dropped with the test-infra retirement #1053.
2. **Deploy:** `cd.yml` builds one sealed `db` payload. Staging sends its expected head to the OIDC-authenticated migrator; production applies the same payload with its protected `NEON_DATABASE_URL` and `search_path=public` after approval.
3. **Local:** same Atlas pin as CI for **empty/dev/test-base** only. Staging/prod apply is the deploy workflow; laptop apply to staging/prod requires explicit owner HITL (not routine).

## Align with campaign decisions

- Role matrix SQL: #831 · staging wire: #832 · prod: #855
- History squash / gazetteer out of chain: #845–#850
- Update wipe row for staging when #845 D1 is locked (wipe vs soft).

## Links

- `db/AGENTS.md` — ownership + role intent (#830)
- `docs/ops/deployment.md` — deploy orchestration
