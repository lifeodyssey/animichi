# Neon backup, RPO/RTO, and bad-migration recovery

Canonical ops page for **N5** of the Neon DBA capability map
([`2026-08-06-neon-dba-capability-map.md`](../superpowers/specs/2026-08-06-neon-dba-capability-map.md)
— D10 / D12 / D15). Schema authoring and deploy-time Atlas apply remain in
[`migrations.md`](./migrations.md); Worker/code rollback remains in
[`deployment.md`](./deployment.md).

**Scope:** Neon data plane only (catalog + agent sessions/metering + users
document tables + shared `public` revision ledger). Supabase auth is out of
scope. **No production DSNs, no secrets, and no live Neon apply** are recorded
or required by this page.

---

## Where backups live

| Layer | What it is | Where operators act |
|---|---|---|
| **Neon history (PITR)** | Continuous WAL retained for the project **history window** | Neon Console → project → **Settings → Instant restore**; restore via **Backup & Restore** on a **root** branch |
| **Time Travel Assist** | Read-only queries against a historical timestamp/LSN inside the window | Neon Console — use **before** any destructive restore to confirm the cut point |
| **Post-restore backup branch** | Neon auto-preserves pre-restore head as `{branch}_old_{timestamp}` | Neon Console → **Branches** (do not delete until the incident is closed) |
| **App-managed dumps** | **Not provisioned** for this project today | Optional later: `pg_dump` → private object storage; not a substitute for history window |

Facts operators must not forget:

1. **Instant restore applies only to root branches.** Child branches
   (`staging` children, `test-base` children, `dev/*`, preview) do **not**
   support PITR from their own history. Production and other root branches
   are the recovery targets.
2. **Restore is an overwrite, not a merge.** All databases on the target
   branch jump to the chosen timestamp/LSN; connections interrupt briefly;
   connection strings stay the same.
3. **History window is the real retention SLA.** Neon defaults are plan-capped
   (Free ≤ 6 h; Launch default 1 d / max 7 d; Scale default 1 d / max 30 d —
   see [Neon history window](https://neon.com/docs/introduction/history-window)).
   Confirm the live project slider in Console; do not assume max retention.
4. **Worker rollback never undoes schema.** See
   [deployment.md — Database migrations do NOT roll back this way](./deployment.md).

---

## RPO / RTO expectations

These are **product targets for this monorepo's Neon data plane**, not Neon
marketing claims. Adjust only with an owner decision recorded in the DBA map
or this file's changelog.

| Metric | Target | Notes |
|---|---|---|
| **RPO** (max acceptable data loss) | **≤ history window, continuous within it** | Neon retains change history continuously for the configured window; within that window, restore can target millisecond/LSN granularity. Outside the window, loss is unbounded unless a future off-platform dump exists. **Operator action:** keep production history window **≥ 7 days** when the plan allows (Launch max / Scale preferred). |
| **RPO — practical “oops” case** | **Minutes of intentional cut-point choice**, not hours of missing WAL | The limiting factor is usually “when was the bad write?” not “when was the last backup?”. Use Time Travel Assist to pick the cut. |
| **RTO** (time to restore service after a data-plane incident) | **≤ 60 minutes** when an owner is available and the fix is PITR or a prepared forward-fix migration | Clock starts at human detection. Includes decide → protect traffic → restore or forward-fix → smoke. |
| **RTO — complex bad migration + multi-Worker coordination** | **≤ 4 hours** target; may exceed if expand/contract or dual-write cleanup is required | Worker code can roll back in minutes ([deployment.md](./deployment.md)); schema path is forward-only by default. |

**Non-goals for RTO today:** automated failover to a second Neon project,
multi-region active-active, or zero-touch restore from CI.

---

## Monitoring and alerting (HITL)

### Automated alerts — **HITL / not wired**

| Signal | Desired alert | Status |
|---|---|---|
| Neon compute/storage/history quota or project-level outage | Neon Console / email notification | **HITL** — no repo-owned pager wiring; owner enables Neon notifications in Console |
| Atlas `migrate apply` failure in deploy | GitHub Actions job red on `reusable-deploy-component` / promotion | **CI-visible**; not a phone page. Owner watches the deploy run |
| Logfire DB error rate / latency SLO | Logfire alert on staging/prod projects | **HITL** — Logfire tokens exist per environment; **no** Neon-specific alert rules checked into this repo yet (D12 gap) |
| Staging/prod table count or Atlas revision drift after deploy | Automated post-deploy probe | **HITL** — still manual (see failed-migrate checklist); post-deploy suites partially TODO |

Do **not** invent webhook secrets or production DSNs to “close” this gap in a
docs PR. Closing automated pages is a follow-up with owner + secrets review.

### Manual checklist with owner (preferred N5 acceptance)

**Owner:** repository maintainers who hold **Neon Console admin** on the
shared project **and** **GitHub Environment** access for `staging` /
`production` (same people who approve production deploys).

Run **at least monthly** (and after any production Atlas apply):

| # | Check | How (no secrets in tickets) | Pass? |
|---|---|---|---|
| 1 | History window ≥ target | Neon Console → Settings → Instant restore; record days only | ☐ |
| 2 | Root branches still named as expected | Console Branches list: production / staging roots present; no surprise renames | ☐ |
| 3 | Neon notifications on | Project settings → notifications / email for failures & usage | ☐ |
| 4 | Last production deploy Atlas step green | GitHub Actions run for the last prod promotion; Atlas step succeeded | ☐ |
| 5 | Spot-check table presence (staging first) | Via Console SQL editor or approved read-only path: `public` has expected business tables; **never paste DSNs** | ☐ |
| 6 | Drill note | Optional quarterly: Time Travel Assist against **staging root** to a known timestamp (read-only); record date in the PR/issue that closes the drill | ☐ |

After the checklist, leave a short durable note (issue comment or ops PR):
`Neon N5 monthly: YYYY-MM-DD — history_window=Nd — owner=@… — pass/fail`.

---

## Failed migrate checklist

Use when Atlas `migrate apply` fails in CI/deploy, or apply “succeeds” but the
Worker cannot query the expected schema.

1. **Stop promotion.** Do not re-run production apply in a loop. Staging first
   always.
2. **Capture non-secret evidence:** workflow run URL, Atlas exit class
   (checksum / SQL error / connection), migration filename, environment name.
   Redact DSNs from any pasted logs.
3. **Classify:**
   - *Never applied* — revision ledger unchanged; fix SQL/hash in a new PR;
     re-run after review.
   - *Partially applied / dirty* — treat as incident; do **not** use
     `--allow-dirty` casually (deploy lane keeps clean-database check on; see
     [`migrations.md`](./migrations.md)).
   - *Applied but app incompatible* — schema moved; old or new Workers break;
     go to [Bad-migration recovery stub](#bad-migration-recovery-stub).
4. **Verify ledger** on the target branch (Console SQL / approved readonly):
   inspect `public.atlas_schema_revisions` (or Atlas status via migrator DSN
   **offline from tickets**). Confirm which versions are present.
5. **Decide path:** forward-fix migration vs PITR (only when data/schema
   destruction requires time travel — owner call).
6. **Record** branch identity, revision, operator, and outcome in the deploy
   issue or PR (D8 intent). No secrets.

---

## Bad-migration recovery stub

**Default narrative (already in deploy docs):** a Worker rollback does **not**
un-apply Atlas. Prefer **forward-fix**: new timestamped migration that restores
a safe shape (expand/contract). Never rewrite an applied file in
`migrations/neon/`.

### A. Forward-fix (preferred)

1. Freeze further deploys that touch the broken path.
2. If new Workers are broken but old Workers work with the new schema: roll
   Workers back per [deployment.md](./deployment.md) **only if** the rolled-back
   code is compatible with the **current** schema.
3. Author a new migration that repairs data/constraints; `atlas migrate hash` +
   validate; land via normal PR → staging apply → smoke → production.
4. Add/adjust tests that would have caught the failure (unit or integration).

### B. Neon instant restore (destructive; owner-only)

Use when forward-fix cannot recover (mass bad DML, irreversible drop, corrupt
seed) and the damage is inside the history window.

1. **Owner approval** recorded on the incident issue.
2. Prefer **staging root** rehearsal if the failure is reproducible there.
3. Time Travel Assist: confirm timestamp/LSN **before** the bad change and
   after the last known-good write you must keep.
4. Neon Console → root branch → Backup & Restore → restore from history (or
   CLI `neon branches restore` with `preserve_under_name` / auto backup
   branch). Expect brief connection blip; strings unchanged.
5. Re-check Atlas revision ledger vs `migrations/neon` on the restored state.
   You may need a careful forward migration to re-align code with the restored
   schema, or redeploy the Worker version that matched that schema.
6. Keep the `{branch}_old_*` backup branch until smoke passes; then decide
   retention (storage cost vs forensic value).
7. **Do not** PITR production to “experiment.” Child-branch workflows and
   `test-base` refresh stay on [`neon-test-infra.md`](./neon-test-infra.md).

### C. After any recovery

- Smoke: `/healthz`, one catalog read, one users path if users schema touched.
- Confirm maintenance Worker still has a valid agent-domain DSN binding (no
  secret rotation unless the incident required it).
- File follow-ups: missing expand/contract, missing checklist item, alert gap.

---

## Related entry points

- [`docs/ops/migrations.md`](./migrations.md) — Atlas authority, apply command, expand/contract
- [`docs/ops/deployment.md`](./deployment.md) — deploy order; Worker/Pulumi rollback; schema non-rollback
- [`db/AGENTS.md`](../../db/AGENTS.md) — migration conventions
- [`docs/ops/neon-test-infra.md`](./neon-test-infra.md) — test-base / branch quota (not production PITR)
- [`docs/superpowers/specs/2026-08-06-neon-dba-capability-map.md`](../superpowers/specs/2026-08-06-neon-dba-capability-map.md) — D10/D12/D15, N5 acceptance
- Neon docs: [Instant restore](https://neon.com/docs/introduction/branch-restore) ·
  [History window](https://neon.com/docs/introduction/history-window) ·
  [Backups overview](https://neon.com/docs/manage/backups)

## Changelog

| Date | Change |
|---|---|
| 2026-08-07 | N5 (#860): initial RPO/RTO, PITR placement, HITL monitor checklist, failed-migrate + bad-migration stubs |
