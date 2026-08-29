#!/usr/bin/env bash
# Behavior test for why-blocked.sh through its public CLI and stubbed GitHub
# boundary. The known #1214 failure mode is a raw neutral CodeQL conclusion
# rendered as a blocker even when the ordinary required statuses are green.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/scripts/local-gates/why-blocked.sh"
FIXTURE="$ROOT/scripts/local-gates/fixtures/why-blocked-gh.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
ln -s "$FIXTURE" "$TMP/bin/gh"

run_case() {
  local scenario="$1" output="$2"
  RC=0
  WHY_BLOCKED_SCENARIO="$scenario" PATH="$TMP/bin:$PATH" \
    bash "$SCRIPT" 42 > "$output" 2>&1 || RC=$?
}

run_case blocked "$TMP/blocked"
[ "$RC" = 1 ] || { printf 'FAIL: blocked PR exited %s\n' "$RC" >&2; exit 1; }
grep -qF 'required checks without success (2):' "$TMP/blocked"
grep -qF -- '- CodeQL: raw_conclusion=neutral status=completed source=check-run app_id=15368 required_by_pr=unknown' "$TMP/blocked"
grep -qF -- '- Review Gate: raw_conclusion=pending status=completed source=status app_id=none required_by_pr=true' "$TMP/blocked"
grep -qF 'branch staleness: behind (behind_by=3)' "$TMP/blocked"
grep -qF 'unresolved threads: 2' "$TMP/blocked"

run_case clean "$TMP/clean"
[ "$RC" = 0 ] || { printf 'FAIL: clear PR exited %s\n' "$RC" >&2; exit 1; }
grep -qF 'required checks without success (0):' "$TMP/clean"
grep -qF -- '- none' "$TMP/clean"
grep -qF 'branch staleness: current (behind_by=0)' "$TMP/clean"
grep -qF 'unresolved threads: 0' "$TMP/clean"

run_case wrong-source "$TMP/wrong-source"
[ "$RC" = 1 ] || { printf 'FAIL: wrong-source PR exited %s\n' "$RC" >&2; exit 1; }
grep -qF -- '- Security: raw_conclusion=failure status=completed source=check-run app_id=15368' "$TMP/wrong-source"

run_case same-time-rerun "$TMP/same-time-rerun"
[ "$RC" = 1 ] || { printf 'FAIL: same-time rerun PR exited %s\n' "$RC" >&2; exit 1; }
grep -qF -- '- Security: raw_conclusion=failure status=completed source=check-run app_id=15368' "$TMP/same-time-rerun"

run_case wrong-status-source "$TMP/wrong-status-source"
[ "$RC" = 1 ] || { printf 'FAIL: wrong-status-source PR exited %s\n' "$RC" >&2; exit 1; }
grep -qF -- '- Review Gate: raw_conclusion=missing status=missing source=none app_id=15368 required_by_pr=unknown' "$TMP/wrong-status-source"

run_case queued-success "$TMP/queued-success"
[ "$RC" = 1 ] || { printf 'FAIL: queued-success PR exited %s\n' "$RC" >&2; exit 1; }
grep -qF -- '- PR Verification: raw_conclusion=success status=queued' "$TMP/queued-success"

run_case merge-blocked "$TMP/merge-blocked"
[ "$RC" = 1 ] || { printf 'FAIL: blocked merge state exited %s\n' "$RC" >&2; exit 1; }
grep -qF 'PR #42: merge_state=BLOCKED' "$TMP/merge-blocked"

run_case unreadable "$TMP/unreadable"
[ "$RC" = 2 ] || { printf 'FAIL: unreadable snapshot exited %s\n' "$RC" >&2; exit 1; }
grep -qF 'BLOCKED: unreadable why-blocked input:' "$TMP/unreadable"

printf '%s\n' 'why-blocked.test.sh: blocker, both source kinds, status, merge, and unreadable cases are green'
