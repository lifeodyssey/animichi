#!/usr/bin/env bash
# AC6 repair-evidence recorder tests (issue #1008 AC6, finding 5): the
# orchestrator-facing recorder (repair_evidence_record.py) is the only producer
# of a verdict's repair_evidence record. Local-deterministic-harness mode
# writes exactly {"mode": "local-deterministic-harness"} and rejects every
# orchestrator field; opencode mode digests the log file the orchestrator
# points at and records the command/session verbatim. This hermetic module
# feeds the recorder a CANNED fixture log — clearly not a live session — and
# never claims an OpenCode run happened; a missing/empty/unreadable log fails
# closed with no record printed, and every emitted record validates through
# the real verdict schema.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RECORDER="$ROOT/scripts/local-gates/repair_evidence_record.py"
GATE="$ROOT/scripts/local-gates/review-verdict.sh"
FIX="$ROOT/scripts/local-gates/fixtures"
FIXTURE_LOG="$FIX/fixture-opencode-session.log"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
run() { # run <label> <want-exit> <cmd...>
  local label="$1" want="$2"; shift 2
  local out rc
  out="$("$@" 2>&1)" && rc=0 || rc=$?
  if [ "$rc" -eq "$want" ]; then
    printf 'PASS %-44s exit=%s\n' "$label" "$rc"
  else
    fail=$((fail + 1)); printf 'FAIL %-44s want=%s got=%s %s\n' "$label" "$want" "$rc" "$out"
  fi
}

check_record() { # check_record <out> <want-mode> <want-command> <want-session> <want-digest>
  printf '%s' "$1" | python3 -c '
import json, sys
record = json.load(sys.stdin)
mode, command, session, digest = sys.argv[1:]
assert set(record) == {"mode", "command", "session", "log_digest"}, record
assert record["mode"] == mode, record
assert record["command"] == command, record
assert record["session"] == session, record
assert record["log_digest"] == digest, record
' "$2" "$3" "$4" "$5"
}

echo "=== AC6 recorder: local-deterministic-harness mode writes only mode ==="
run "local mode records the deterministic harness" 0 "$RECORDER" --mode local-deterministic-harness
run "local mode rejects an extra orchestrator field" 2 \
  "$RECORDER" --mode local-deterministic-harness --command "opencode exec"
local_out="$("$RECORDER" --mode local-deterministic-harness)"
if printf '%s' "$local_out" | python3 -c '
import json, sys
record = json.load(sys.stdin)
assert set(record) == {"mode"} and record["mode"] == "local-deterministic-harness", record
'; then
  printf 'PASS %-44s\n' "local record is exactly {mode}"
else
  fail=$((fail + 1)); printf 'FAIL %-44s %s\n' "local record is exactly {mode}" "$local_out"
fi

echo
echo "=== AC6 recorder: opencode mode digests the orchestrator's log ==="
want_digest="$(shasum -a 256 "$FIXTURE_LOG" | awk '{print $1}')"
run "opencode mode with the fixture log records it" 0 \
  "$RECORDER" --mode opencode --command "codex exec --sandbox off" --session "sess-fixture-001" --log "$FIXTURE_LOG"
record_out="$("$RECORDER" --mode opencode --command "codex exec --sandbox off" --session "sess-fixture-001" --log "$FIXTURE_LOG")"
if check_record "$record_out" opencode "codex exec --sandbox off" "sess-fixture-001" "$want_digest"; then
  printf 'PASS %-44s\n' "opencode record carries the matching log digest"
else
  fail=$((fail + 1)); printf 'FAIL %-44s\n' "opencode record carries the matching log digest"
fi
python3 - "$FIX/verdict-approve.json" "$TMP/opencode-verdict.json" "$record_out" <<'PY'
import json
import sys

src, dst, record = sys.argv[1], sys.argv[2], sys.argv[3]
verdict = json.load(open(src, encoding="utf-8"))
verdict["repair_evidence"] = json.loads(record)
json.dump(verdict, open(dst, "w"), indent=2)
PY
run "verdict with the recorded opencode evidence validates" 0 "$GATE" validate "$TMP/opencode-verdict.json"

echo
echo "=== AC6 recorder: missing/empty/unreadable log fails closed ==="
run "opencode mode without --session fails closed" 2 \
  "$RECORDER" --mode opencode --command "codex exec" --log "$FIXTURE_LOG"
run "opencode mode without --log fails closed" 2 \
  "$RECORDER" --mode opencode --command "codex exec" --session "sess-x"
run "opencode mode with a missing log fails closed" 1 \
  "$RECORDER" --mode opencode --command "codex exec" --session "sess-x" --log "$TMP/absent.log"
run "opencode mode with an empty log fails closed" 1 \
  "$RECORDER" --mode opencode --command "codex exec" --session "sess-x" --log /dev/null
touch "$TMP/unreadable.log"
chmod 000 "$TMP/unreadable.log"
run "opencode mode with an unreadable log fails closed" 1 \
  "$RECORDER" --mode opencode --command "codex exec" --session "sess-x" --log "$TMP/unreadable.log"
chmod 600 "$TMP/unreadable.log"
no_record="$( "$RECORDER" --mode opencode --command "codex exec" --session "sess-x" --log "$TMP/absent.log" 2>/dev/null )" && rc=0 || rc=$?
if [ "$rc" -ne 0 ] && [ -z "$no_record" ]; then
  printf 'PASS %-44s\n' "a failed run prints no record"
else
  fail=$((fail + 1)); printf 'FAIL %-44s rc=%s out=%s\n' "a failed run prints no record" "$rc" "$no_record"
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "All review-verdict recorder tests passed."
else
  echo "$fail recorder test(s) failed." >&2
  exit 1
fi
