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
- `auth-migration-neon.md` — Neon Auth (Better Auth) cutover runbook (flag-gated; Supabase still verifies today)
- `neon-test-infra.md` · `neon-local-spike-findings.md` — Neon test-base / local proxy operator notes
- `git-daily-squash-runbook.md` — W8 git history daily-squash execution runbook (mirror/bundle backup, branch swap or force-with-lease, `main-legacy` retention ≥30 days, rollback, owner checklist; #851/#858)
- `indexnow.md` · `privacy.md` — SEO push and privacy ops notes

Keep iteration task trackers, progress logs, and findings under `docs/iterations/`.

## Repo scripts

- `scripts/git-squash-daily.py` — dry-run daily squash of a ref by Asia/Shanghai
  day. Builds a local-only `dry-run/daily-squash-<ts>` branch where each day's
  tip tree becomes one parent-chained synthetic commit, verifies the final tree
  is identical (`git diff` empty), and prints day/new-commit counts plus the 5
  densest days. **Never pushes** — no push code path exists. Local-only preview
  tool for planning history rewrites; run e.g.
  `python3 scripts/git-squash-daily.py --ref origin/main`. See module docstring
  and `--help` for details.
