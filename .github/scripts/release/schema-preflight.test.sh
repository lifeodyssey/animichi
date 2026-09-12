#!/usr/bin/env bash
# Behavior tests for the release schema preflight (#1590). Probe commits reached main during a
# CD debugging session and left this script echoing `schema-preflight.json` into the job log,
# while the migrator's 503 body carried the driver exception — so the log carried a DSN. The
# response body must never appear in the log again, on any path. The bounded 503 retry those
# commits added is a real fix and is pinned here instead: it waits for a just-published migrator
# that is not answering yet, then fails closed at the attempt cap. A `curl` stub stands in for
# the network and a `sleep` stub for the clock, so retries and intervals are asserted without a
# real host and without real waiting.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/.github/scripts/release/schema-preflight.sh"
TMP="$(mktemp -d)"
LAST_STATE_DIR=""
LAST_WORK_DIR=""
LAST_OUT=""
trap 'rm -rf "$TMP" "$LAST_STATE_DIR" "$LAST_WORK_DIR"' EXIT

fail=0
HEAD_VERSION="20260101000000_init"
PRISMA_TARGET="$(printf 'a%.0s' {1..64})"
# The bytes the stub writes into every response body. No job-log line may contain them.
CANARY="LEAK_CANARY"

mkdir -p "$TMP/bin"
cat > "$TMP/bin/curl" <<'STUB'
#!/usr/bin/env bash
# Three call shapes reach this stub: the OIDC token (the only URL carrying `audience=`, read by
# `jq -er .value`), `/healthz` (await_migrator_bundle's identity poll), and `/preflight`
# (`-o schema-preflight.json -w '%{http_code}'`, so the body is a file and the printed value is
# the status code). Every response body carries $CANARY, the successful one included: a path
# that leaks only on success would pass a failure-only assertion.
set -euo pipefail
state_dir="${STUB_STATE_DIR:?}"
printf '%s\n' "$*" >> "$state_dir/argv"
url="${*: -1}"

if [[ "$url" == *audience=* ]]; then
  printf '{"value":"stub-oidc-token"}'
  exit 0
fi
if [[ "$url" == */healthz ]]; then
  printf '{"bundleHead":"%s","prismaTarget":"%s"}' "${STUB_HEAD:?}" "${STUB_PRISMA:?}"
  exit 0
fi

out=""
prev=""
for arg in "$@"; do
  [ "$prev" = "-o" ] && out="$arg"
  prev="$arg"
done
[ -n "$out" ] || { echo 'stub: no -o target' >&2; exit 1; }

count=1
[ ! -f "$state_dir/preflight-calls" ] || count=$(( $(cat "$state_dir/preflight-calls") + 1 ))
echo "$count" > "$state_dir/preflight-calls"

if [ "$count" -le "${STUB_FAIL_UNTIL:-0}" ]; then
  code="${STUB_FAIL_CODE:-503}"
  case "$code" in
    409) printf '{"error":"stale_bundle","bundleHead":"old","note":"LEAK_CANARY"}' > "$out" ;;
    503) printf '{"error":"preflight_unavailable","note":"LEAK_CANARY"}' > "$out" ;;
    *) printf '{"error":"refused","note":"LEAK_CANARY"}' > "$out" ;;
  esac
  printf '%s' "$code"
  exit 0
fi

printf '{"compatible":true,"expectedHead":"%s","appliedHead":"%s","pendingCount":0,"note":"LEAK_CANARY","prisma":{"targetHash":"%s","markerHash":"%s","usedLiveMarker":true,"migrations":[]}}' \
  "${STUB_HEAD:?}" "${STUB_HEAD:?}" "${STUB_PRISMA:?}" "${STUB_PRISMA:?}" > "$out"
printf '200'
STUB
chmod +x "$TMP/bin/curl"

cat > "$TMP/bin/sleep" <<'STUB'
#!/usr/bin/env bash
# Records the interval it was asked to wait and returns at once, so a case can assert both
# that the loop slept and how long it intended to sleep for.
set -euo pipefail
printf '%s\n' "$1" >> "${STUB_STATE_DIR:?}/sleeps"
STUB
chmod +x "$TMP/bin/sleep"

seed_release() { # seed_release <dir> — the release artifacts the script reads from cwd
  local dir="$1"
  mkdir -p "$dir/release/migrations" "$dir/release/migrator/bundle"
  : > "$dir/release/migrations/$HEAD_VERSION.sql"
  printf 'h1:stub=\n%s.sql h1:stub=\n' "$HEAD_VERSION" > "$dir/release/migrations/atlas.sum"
  printf '{"storage":{"storageHash":"%s"}}' "$PRISMA_TARGET" > "$dir/release/migrator/bundle/contract.json"
}

run() { # run <label> <want-exit> <mode> [env...]
  local label="$1" want="$2" mode="$3"; shift 3
  local rc
  rm -rf "$LAST_STATE_DIR" "$LAST_WORK_DIR"
  LAST_STATE_DIR="$(mktemp -d)"
  LAST_WORK_DIR="$(mktemp -d)"
  seed_release "$LAST_WORK_DIR"
  LAST_OUT="$(cd "$LAST_WORK_DIR" && env "$@" \
    STUB_STATE_DIR="$LAST_STATE_DIR" STUB_HEAD="$HEAD_VERSION" STUB_PRISMA="$PRISMA_TARGET" \
    MIGRATOR_URL="https://migrator.example.test" \
    ACTIONS_ID_TOKEN_REQUEST_TOKEN=stub-request-token \
    ACTIONS_ID_TOKEN_REQUEST_URL="https://token.example.test/?api-version=1" \
    PATH="$TMP/bin:$PATH" bash "$SCRIPT" staging "$mode" 2>&1)" && rc=0 || rc=$?
  if [ "$rc" -eq "$want" ]; then
    printf 'PASS %-64s exit=%s\n' "$label" "$rc"
  else
    fail=$((fail + 1))
    printf 'FAIL %-64s want=%s got=%s\n%s\n' "$label" "$want" "$rc" "$LAST_OUT"
  fi
}

preflight_calls() { cat "$LAST_STATE_DIR/preflight-calls" 2>/dev/null || echo 0; }
recorded_sleeps() { cat "$LAST_STATE_DIR/sleeps" 2>/dev/null || true; }

expect_eq() { # expect_eq <label> <want> <got>
  if [ "$2" = "$3" ]; then
    printf 'PASS %-64s\n' "$1"
  else
    fail=$((fail + 1))
    printf 'FAIL %-64s want=%s got=%s\n' "$1" "$2" "$3"
  fi
}

expect_log() { # expect_log <label> <want-present:0|1> <pattern>
  local present=0
  grep -qF -- "$3" <<<"$LAST_OUT" && present=1
  if [ "$present" -eq "$2" ]; then
    printf 'PASS %-64s\n' "$1"
  else
    fail=$((fail + 1))
    printf 'FAIL %-64s want-present=%s got=%s\n%s\n' "$1" "$2" "$present" "$LAST_OUT"
  fi
}

echo "=== the ordinary compatible answer ==="
run "a 200 on the first attempt passes without waiting" 0 native
expect_eq "and asks the migrator exactly once" 1 "$(preflight_calls)"
expect_eq "and never sleeps" "" "$(recorded_sleeps)"

echo
echo "=== a just-published migrator that is not answering yet (503) ==="
run "a 503 that recovers on the third attempt passes" 0 native STUB_FAIL_UNTIL=2
expect_eq "and it really retried three times" 3 "$(preflight_calls)"
expect_eq "and slept the default 15s between them" "$(printf '15\n15')" "$(recorded_sleeps)"

run "a 503 that never recovers fails closed" 1 native STUB_FAIL_UNTIL=999
expect_eq "after exactly the default cap of 10 attempts" 10 "$(preflight_calls)"
expect_log "and says what it was waiting on, not a container" 1 \
  "::error::migrator never answered preflight after 10 attempts"
expect_log "and no line blames a container that is not involved" 0 "container"

run "the attempt cap is a constant the caller can drive" 1 native \
  STUB_FAIL_UNTIL=999 UNAVAILABLE_ATTEMPTS=3 UNAVAILABLE_POLL_SECONDS=2
expect_eq "and three attempts is where it stops" 3 "$(preflight_calls)"
expect_eq "and the interval is the one it was given" "$(printf '2\n2\n2')" "$(recorded_sleeps)"

echo
echo "=== the response body never reaches the job log (#1590) ==="
# The stub writes $CANARY into every body it produces. These four runs are one per branch that
# reads schema-preflight.json: success, 503 exhaustion, outright refusal, stale bundle.
run "a successful run prints no response body" 0 native
expect_log "success path is canary-free" 0 "$CANARY"
run "an exhausted 503 prints no response body" 1 native STUB_FAIL_UNTIL=999 UNAVAILABLE_ATTEMPTS=2
expect_log "503 path is canary-free" 0 "$CANARY"
run "a refused preflight prints no response body" 1 native STUB_FAIL_UNTIL=999 STUB_FAIL_CODE=500
expect_log "refusal path is canary-free" 0 "$CANARY"
expect_log "and still names the status it refused on" 1 \
  "::error::migration preflight refused or unavailable (HTTP 500)"
run "an unresolved stale bundle prints no response body" 1 native \
  STUB_FAIL_UNTIL=999 STUB_FAIL_CODE=409
expect_log "stale-bundle path is canary-free" 0 "$CANARY"

echo
echo "=== the stale-bundle 409 path is unchanged ==="
run "a 409 stale bundle that republishes in time passes" 0 native \
  STUB_FAIL_UNTIL=2 STUB_FAIL_CODE=409 BUNDLE_POLL_SECONDS=0
expect_eq "and it polled three times" 3 "$(preflight_calls)"
run "a 409 stale bundle that never moves fails closed" 1 native \
  STUB_FAIL_UNTIL=999 STUB_FAIL_CODE=409 BUNDLE_POLL_SECONDS=0
expect_eq "after the existing three-attempt stale budget" 3 "$(preflight_calls)"
expect_log "and reports the stale bundle, not a 503 wait" 1 \
  "::error::native preflight remained on a stale bundle"
run "the stale budget is still the caller's to set" 1 native \
  STUB_FAIL_UNTIL=999 STUB_FAIL_CODE=409 BUNDLE_POLL_SECONDS=0 STALE_BUNDLE_ATTEMPTS=5
expect_eq "and five attempts is where it stops" 5 "$(preflight_calls)"
run "atlas-only mode has no bundle to be stale, so a 409 refuses" 1 --atlas-only \
  STUB_FAIL_UNTIL=999 STUB_FAIL_CODE=409
expect_eq "on the first answer" 1 "$(preflight_calls)"

echo
if [ "$fail" -eq 0 ]; then
  echo "All schema-preflight tests passed."
else
  echo "$fail schema-preflight test(s) failed." >&2
  exit 1
fi
