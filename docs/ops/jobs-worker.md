# Scheduled maintenance Worker

`workers/jobs` owns database retention jobs for the Python agent's Neon data domain. It is a
separate Worker because neither `workers/catalog` nor `workers/users` owns the tables being purged.
It has no HTTP route, `workers.dev` host, or preview URL.

## Schedules and behavior

| Cron (UTC) | Job | Python source preserved by the port |
|---|---|---|
| `37 18 * * *` | Routeless anonymous sessions inactive for 30 days | `apps/agent/src/animichi/scripts/purge_anonymous_sessions.py` |
| `37 19 * * *` | `anon_daily_message_count` rows older than 30 UTC dates | `apps/agent/src/animichi/scripts/purge_anon_quota_counts.py` |

Both expressions appear under the default, staging, and production `[triggers]` blocks in
`workers/jobs/wrangler.toml`. The handler switches on the exact `controller.cron` string and
fails an unknown schedule instead of guessing which deletion to run.

The session sweep retains the Python race guarantees: it finds anonymous, stale, routeless
candidates, re-checks anonymous ownership and cutoff per session, and counts a delete that matches
zero rows as raced. Each session is isolated in its own atomic statement, so a raced session does not
abort the remaining candidates. The `routes.session_id` FK backstop no longer exists — the rename
dropped the cross-BC FK (#852), so no FK race is possible.

## Secret chain

`AGENT_DATABASE_URL` names both the Cloudflare Secrets Store secret and the Worker binding:

1. **Staging (#912 PR2):** `[[env.staging.secrets_store_secrets]]` in `workers/jobs/wrangler.toml`
   binds `AGENT_DATABASE_URL` to the same-named store secret (managed by `infra/neon-secrets`).
   No GitHub secret and no `wrangler secret put` step exists for the staging value.
2. **Production:** still uploaded by CI from the same-named GitHub environment secret
   (`worker_secrets` in `reusable-deploy-component.yml` callers) until the #912 cutover;
3. the live-secret inventory in [`secrets.md`](./secrets.md).

The `[env.production.secrets] required` block in `workers/jobs/wrangler.toml` is the fail-closed
guard for the production upload chain. Staging's guard is the binding itself: a missing
store secret fails the deploy, and `.get()` throws at runtime if it is ever deleted. (A name
must NOT appear in both `secrets.required` and a Secrets Store binding — wrangler rejects it.)
Local development uses a git-ignored `.dev.vars` file.

## Cutover verification

After the staging Worker deploys, wait for one real invocation and verify its Cloudflare Cron Trigger
Past Event plus the structured purge log. The old GHA workflows are intentionally retained as
manual-only, deprecated fallbacks during that window; their schedules are disabled, so hosted
runners no longer receive a database credential on a timer. Delete both fallback files only after
that staging evidence exists.
