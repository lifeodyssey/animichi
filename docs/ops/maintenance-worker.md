# Scheduled maintenance Worker

`workers/maintenance` owns database retention jobs for the Python agent's Neon data domain. It is a
separate Worker because neither `workers/catalog` nor `workers/users` owns the tables being purged.
It has no HTTP route, `workers.dev` host, or preview URL.

## Schedules and behavior

| Cron (UTC) | Job | Python source preserved by the port |
|---|---|---|
| `37 18 * * *` | Routeless anonymous sessions inactive for 30 days | `apps/agent/agent/scripts/purge_anonymous_sessions.py` |
| `37 19 * * *` | `anon_daily_message_count` rows older than 30 UTC dates | `apps/agent/agent/scripts/purge_anon_quota_counts.py` |

Both expressions appear under the default, staging, and production `[triggers]` blocks in
`workers/maintenance/wrangler.toml`. The handler switches on the exact `controller.cron` string and
fails an unknown schedule instead of guessing which deletion to run.

The session sweep retains the Python race guarantees: it finds anonymous, stale, routeless
candidates, re-checks anonymous ownership and cutoff per session, and lets the `routes.session_id`
foreign key roll back a raced deletion. Each session is isolated in its own atomic statement, so one
FK race does not abort the remaining candidates.

## Secret chain

`AGENT_DATABASE_URL` is the exact name at all three source touchpoints:

1. required secret binding in every `workers/maintenance/wrangler.toml` environment;
2. `worker_secrets`/`env` wiring in reusable CI, staging/production callers, and the manual production
   deploy workflow;
3. the live-secret inventory in [`secrets.md`](./secrets.md).

Operators must provision different `AGENT_DATABASE_URL` values on the `staging` and `production`
GitHub Environments. The repository contains no DSN value and local development uses a git-ignored
`.dev.vars` file.

## Cutover verification

After the staging Worker deploys, wait for one real invocation and verify its Cloudflare Cron Trigger
Past Event plus the structured purge log. The old GHA workflows are intentionally retained as
manual-only, deprecated fallbacks during that window; their schedules are disabled, so hosted
runners no longer receive a database credential on a timer. Delete both fallback files only after
that staging evidence exists.
