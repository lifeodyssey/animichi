#!/usr/bin/env bash
# The stubbed CD environment the schema-preflight behaviour tests run the script inside (#1590).
#
# Source it from a test file, call `run` and the `expect_*` assertions, and end with
# `report_suite <name>`. A `curl` stub stands in for the network and a `sleep` stub for the
# clock, so retries and intervals are asserted without a real host and without real waiting.
# Two files share it because the script under test has two independent concerns — what its
# retries do, and what reaches the job log — and each concern owns its own test file.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/.github/scripts/release/schema-preflight.sh"
TMP="$(mktemp -d)"
LAST_STATE_DIR=""
LAST_WORK_DIR=""
LAST_OUT=""
trap 'rm -rf "$TMP" "$LAST_STATE_DIR" "$LAST_WORK_DIR"' EXIT

fail=0
HEAD_VERSION="20260101000000_init"
PRISMA_TARGET="$(printf 'a%.0s' {1..64})"

mkdir -p "$TMP/bin"
cat > "$TMP/bin/curl" <<'STUB'
#!/usr/bin/env bash
# Three call shapes reach this stub: the OIDC token (the only URL carrying `audience=`, read by
# `jq -er .value`), `/healthz` (await_migrator_bundle's identity poll), and `/preflight`
# (`-o schema-preflight.json -w '%{http_code}'`, so the body is a file and the printed value is
# the status code). Every response body carries the LEAK_CANARY bytes, the successful one
# included: a path that leaks only on success would pass a failure-only assertion.
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

# curl's exit 6, "could not resolve host": no status code is printed and no body is written.
[ "$count" -gt "${STUB_TRANSPORT_FAIL_UNTIL:-0}" ] || exit 6

# Two overlapping failure phases, so a case can pose the sequence both retries exist for: a
# migrator published seconds ago that first cannot answer at all (503) and then answers from
# its old bundle (409). STUB_UNAVAILABLE_UNTIL wins over STUB_FAIL_UNTIL on the early calls.
code=200
[ "$count" -gt "${STUB_FAIL_UNTIL:-0}" ] || code="${STUB_FAIL_CODE:-503}"
[ "$count" -gt "${STUB_UNAVAILABLE_UNTIL:-0}" ] || code=503

case "$code" in
  200) printf '{"compatible":true,"expectedHead":"%s","appliedHead":"%s","pendingCount":0,"note":"LEAK_CANARY","prisma":{"targetHash":"%s","markerHash":"%s","usedLiveMarker":true,"migrations":[]}}' \
    "${STUB_HEAD:?}" "${STUB_HEAD:?}" "${STUB_PRISMA:?}" "${STUB_PRISMA:?}" > "$out" ;;
  409) printf '{"error":"stale_bundle","bundleHead":"old","note":"LEAK_CANARY"}' > "$out" ;;
  503) printf '{"error":"preflight_unavailable","note":"LEAK_CANARY"}' > "$out" ;;
  *) printf '{"error":"refused","note":"LEAK_CANARY"}' > "$out" ;;
esac
printf '%s' "$code"
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

# What cd.yml puts in the environment, plus the identity the stub answers /healthz with.
RUN_ENV=(
  MIGRATOR_URL="https://migrator.example.test"
  ACTIONS_ID_TOKEN_REQUEST_TOKEN=stub-request-token
  ACTIONS_ID_TOKEN_REQUEST_URL="https://token.example.test/?api-version=1"
  STUB_HEAD="$HEAD_VERSION"
  STUB_PRISMA="$PRISMA_TARGET"
)

fresh_release_workspace() { # a throwaway cwd holding the release artifacts the script reads
  rm -rf "$LAST_STATE_DIR" "$LAST_WORK_DIR"
  LAST_STATE_DIR="$(mktemp -d)"
  LAST_WORK_DIR="$(mktemp -d)"
  mkdir -p "$LAST_WORK_DIR/release/migrations" "$LAST_WORK_DIR/release/migrator/bundle"
  : > "$LAST_WORK_DIR/release/migrations/$HEAD_VERSION.sql"
  printf 'h1:stub=\n%s.sql h1:stub=\n' "$HEAD_VERSION" > "$LAST_WORK_DIR/release/migrations/atlas.sum"
  printf '{"storage":{"storageHash":"%s"}}' "$PRISMA_TARGET" > "$LAST_WORK_DIR/release/migrator/bundle/contract.json"
}

# No diagnostic below reprints $LAST_OUT. It is the subject of the leak assertions, and a
# regression that puts a DSN back into it would otherwise be reported by copying that DSN into
# the job log: when an assertion says "X must not appear", its failure message may not contain
# X. A failure names the case; re-run that one case locally to read its output.
run() { # run <label> <want-exit> <mode> [env...]
  local label="$1" want="$2" mode="$3" rc; shift 3
  fresh_release_workspace
  LAST_OUT="$(cd "$LAST_WORK_DIR" && env "${RUN_ENV[@]}" "$@" STUB_STATE_DIR="$LAST_STATE_DIR" \
    PATH="$TMP/bin:$PATH" bash "$SCRIPT" staging "$mode" 2>&1)" && rc=0 || rc=$?
  [ "$rc" -ne "$want" ] || { printf 'PASS %-64s exit=%s\n' "$label" "$rc"; return; }
  fail=$((fail + 1))
  printf 'FAIL %-64s want=%s got=%s\n' "$label" "$want" "$rc"
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
    printf 'FAIL %-64s want-present=%s got=%s\n' "$1" "$2" "$present"
  fi
}

report_suite() { # report_suite <name> — the sourcing test file's verdict and exit status
  [ "$fail" -ne 0 ] || { echo "All $1 tests passed."; return 0; }
  echo "$fail $1 test(s) failed." >&2
  exit 1
}
