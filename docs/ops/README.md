# Operations Docs

Operational runbooks and environment-facing procedures live here.

Use this directory for:
- deployment and rollback procedures
- Cloudflare hardening and edge-routing notes
- observability and incident-response runbooks
- other long-lived operational docs that are not iteration-specific

Current canonical docs:
- `deployment.md` — Cloudflare Workers + Containers deployment runbook (topology, auth flow, env boundaries, rollback)
- `migrations.md` — Neon Atlas migration authority, Drizzle query/type boundary, CI, and deployment order
- `neon-backup-rpo.md` — Neon PITR placement, RPO/RTO targets, HITL monitor checklist, failed-migrate + bad-migration recovery (N5 / #860)
- `cloudflare-hardening.md` — WAF rate limiting, prompt-injection filtering, rollback for edge rules, container-level egress network policy (#284 Task 7)
- `secrets.md` — repository/environment secret inventory, consumers, rotation impact
- `integration.md` — single source for env/secrets layout, domain topology, data path, deploy chain, local dev
- `maintenance-worker.md` — scheduled maintenance Worker schedules and cutover checks
- `anonymous-session-purge.md` — scheduled anonymous-session retention sweep (cron cadence, required secret, reading a run)
- `auth-migration-neon.md` — Neon Auth (Better Auth) cutover runbook (flag-gated; Supabase still verifies today)
- `neon-test-infra.md` · `neon-local-spike-findings.md` — Neon test-base / local proxy operator notes
- `indexnow.md` · `privacy.md` — SEO push and privacy ops notes

Keep iteration task trackers, progress logs, and findings under `docs/iterations/`.
