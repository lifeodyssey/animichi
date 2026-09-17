# HISTORICAL (pre-2026-07): feat/ssr-cloudflare Post-deploy Notes

This section records the old feat/ssr-cloudflare merge runbook. It is not the current deployment
trigger or an executable migration procedure. **Historical only; no longer current.** The current
Neon migration authority is `migrations/neon/` applied by pinned Atlas before the Worker rollout;
use [`migrations.md`](../../ops/migrations.md) and the workflow paths above instead.

After the old feat/ssr-cloudflare merge, operators used these checks:

1. **Historical Supabase schema event (not a current apply)** — the old Supabase CLI path recorded
   these legacy schema files:
   - `20260509200000_fix_wrong_bangumi_ids.sql` — delete wrong seed IDs
   - `20260510170000_add_bangumi_platform.sql` — add platform column
   - `20260510180000_add_points_city.sql` — add city column to points

2. **Backfill city for existing points** — one-time, run after migrations:
   ```bash
   AGENT_SVC_DATABASE_URL=<production_dsn> uv run python -m backend.scripts.backfill_city
   ```
   This reverse-geocodes all points with `city IS NULL` using GeoNames data (~12MB).
   Expected: ~1000+ points across ~50 cities. Takes <30 seconds.

3. **Verify** — check a few bangumi:
   ```sql
   SELECT city, count(*) FROM points GROUP BY city ORDER BY count DESC LIMIT 10;
   ```
