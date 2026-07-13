# Operations Docs

Operational runbooks and environment-facing procedures live here.

Use this directory for:
- deployment and rollback procedures
- Cloudflare hardening and edge-routing notes
- observability and incident-response runbooks
- other long-lived operational docs that are not iteration-specific

Current canonical docs:
- `deployment.md` — Cloudflare Workers + Containers deployment runbook (topology, auth flow, env boundaries, rollback)
- `cloudflare-hardening.md` — WAF rate limiting, prompt-injection filtering, rollback for edge rules, container-level egress network policy (#284 Task 7)
- `preview.md` — per-PR preview environments (label-gated CF preview URLs + Neon branch-per-PR + auto-teardown)
- `anonymous-session-purge.md` — scheduled anonymous-session retention sweep (cron cadence, required secret, reading a run)

Keep iteration task trackers, progress logs, and findings under `docs/iterations/`.
