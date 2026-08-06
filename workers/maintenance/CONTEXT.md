# Maintenance → Jobs (rename pending)

**Target package path:** `workers/jobs` (not `maintenance`, not `scheduler`).

This folder will be `git mv`'d in the jobs structure train. Until then, runtime code still lives here.

Design: `docs/superpowers/specs/2026-08-06-jobs-worker-structure-design.md`

## Domain model?

No. Scheduled **jobs** only (purge anonymous sessions, purge anon quota).

## Language

| Prefer | Avoid |
|---|---|
| **Job** | maintenance task (vague) |
| **Schedule / cron** | calling the whole package "scheduler" |
| `workers/jobs` | `workers/maintenance` (legacy path) |
