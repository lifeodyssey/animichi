# Orchestration — where the mechanism lives

Since 2026-09-29 the delivery orchestration mechanism is kept in the private repository
`lifeodyssey/zdev` (local checkout `~/Documents/zdev`, written `$ZDEV` below). This repository
keeps what a card must satisfy; zdev keeps how cards are driven.

| Stays here (the rules) | Lives in zdev `orchestration/` (the mechanism) |
|---|---|
| `docs/ops/orca-card-delivery.md` — the delivery runbook | `skills/animichi-orca-orchestration/` — the coordinator manual |
| `docs/ops/review-gate.md`, `docs/ops/local-gates.md` — merge and push gates | `scripts/orca/` — card reconciler and PR feedback inventory |
| `docs/agents/delivery-flow.md`, `docs/agents/harness.md` — flow and escalation | `scripts/orca-headless/` — the headless launcher |
| `docs/agents/review-and-verification.md` — the review bar | the Orca coordinator prompt and project setup guide (`orchestration/` + `docs/`) |
| `docs/agents/owner-decisions.md` — standing decisions | `local/` — the Orca automation precheck and tick prompt |

Writer and reviewer lanes run inside this repository and read only the left column, so every rule
a candidate is judged by stays here.

The coordinator skill is installed globally, not per repository:
`~/.claude/skills/animichi-orca-orchestration` and `~/.agents/skills/animichi-orca-orchestration`
are symlinks into `$ZDEV/orchestration/skills/`. `~/orca/animichi-coordinator-precheck.sh` and
`~/orca/animichi-coordinator-tick-prompt.md` are symlinks into `$ZDEV/orchestration/local/`, so the
Orca automation's absolute paths keep working and the files are versioned.

The Ruby suites for the reconciler and the launcher run in zdev (`ruby test/run.rb` in each script
directory); they are no longer part of this repository's `contracts` lane.
