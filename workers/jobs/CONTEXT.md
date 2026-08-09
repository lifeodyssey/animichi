# Jobs (was maintenance)

Scheduled retention jobs for agent-domain Neon data. **No pilgrimage domain.**

Target path: `workers/jobs` (renamed from `workers/maintenance` in #836).

Design: `docs/specs/2026-08-06-jobs-worker-structure-design.md`

## Domain model?

No. Scheduled **jobs** only (purge anonymous sessions, purge anon quota).

## Language

| Prefer | Avoid |
|---|---|
| **Job** | maintenance task (vague) |
| **Schedule / cron** | calling the whole package "scheduler" |
| `workers/jobs` | `workers/maintenance` (legacy path) |
