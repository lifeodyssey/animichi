# Anonymous session purge runbook

Issue #273 Task 3: the scheduled sweep that deletes stale, routeless anonymous
sessions so anonymous free-text queries and locations don't accumulate
without a TTL.

## What it does

`apps/agent/agent/scripts/purge_anonymous_sessions.py` deletes an anonymous
conversation (and its cascaded `conversation_messages`) plus its `sessions`
row once:

- `conversations.user_id` matches the `anon_` prefix, and
- `conversations.updated_at` is older than `anonymous_session_retention_days`
  (`Settings`, default 30 days), and
- the session produced **no** `routes` row.

A session that produced a route is retained **permanently**, unconditionally
— that exclusion is not configurable, only the retention window is.

Each session is purged in its own transaction, and the conversation delete
re-checks the anon/cutoff predicate rather than trusting the earlier scan —
closing the race where the owner logs in (`POST /v1/session/migrate`)
between the eligibility scan and the delete. A session lost to that race, or
refused by the `routes.session_id` FK backstop, is logged and skipped; the
rest of the sweep continues. See `agent/scripts/purge_anonymous_sessions.py`
docstrings and `agent/infrastructure/supabase/repositories/session.py`
(`purge_session`) for the mechanics.

## Trigger: `.github/workflows/purge-anonymous-sessions.yml`

- **Cron cadence:** `37 18 * * *` (18:37 UTC daily, off-peak, off the hour —
  matches the `agent-eval-nightly.yml` precedent). Discretionary; change the
  `cron:` line to retune.
- **Scheduled workflows only run from the repository's default branch.**
  Merging this workflow file to a non-default branch (or a stale PR base)
  will never fire the cron — only `workflow_dispatch` works off-branch. If
  the sweep appears to have stopped running, confirm the workflow file is
  actually present on `main`/the default branch, not just on a feature
  branch or an unmerged PR.
- **Manual trigger:** `workflow_dispatch` — run it on demand from the Actions
  tab, or `gh workflow run purge-anonymous-sessions.yml`.
- **Required secret:** `SUPABASE_DB_URL` in this workflow's GitHub Actions
  environment. Without it, `Settings` fails fast (`SUPABASE_DB_URL is not
  set`) and the job goes red — this is deliberate: a missing secret must
  **fail loudly**, not silently report "nothing to purge" (which is
  indistinguishable from a healthy day with no eligible sessions).
- **Local dry run:**
  ```bash
  cd apps/agent
  SUPABASE_DB_URL=... uv run python -m agent.scripts.purge_anonymous_sessions --dry-run
  ```
  Reports the eligible-session count without deleting anything.

## Reading a run

The job writes `purged=N raced=N failed=N` to the step's `$GITHUB_STEP_SUMMARY`
(via `agent.scripts.purge_anonymous_sessions._write_step_summary`):

- `purged` — sessions actually deleted this run.
- `raced` — the find-then-delete race resolved itself (the session was no
  longer anon-owned or no longer past cutoff by the time the delete ran,
  typically because the owner logged in mid-sweep). Not a failure.
- `failed` — a per-session database error (most likely the `routes` FK
  backstop catching a route written between the scan and the delete). Logged
  as `anonymous_session_purge_failed` with the session id; the sweep still
  exits 0 unless something outside the per-session loop breaks.

A nonzero exit code means an **unexpected** (non-Postgres) error escaped the
per-session isolation — that's a programming bug, not a race, and should page
someone.

## Related

- `db/migrations/20260728000001_conversations_user_id_pattern_ops.sql` +
  the `supabase/migrations/` twin — the `text_pattern_ops` index the purge
  scan's `LIKE 'anon\_%'` match depends on. The test Postgres image and the
  Neon test branches this runs against are both provisioned as `en_US.utf8`
  (a non-C collation) — `tests/integration/test_session_retention_integrity.py`
  asserts against this value directly; if the environment's collation is
  ever intentionally changed, update both places together.
- `apps/agent/agent/interfaces/routes/session_migration.py` — the login-time
  ownership transition this purge coexists with.
