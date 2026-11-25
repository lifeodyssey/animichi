#!/usr/bin/env bash
# SUT: .github/scripts/catalog-first-request.sh
# Behaviour tests for the probe CD runs right after the staging smoke: one cold request to
# catalog's public popularity route, then one warm one, each timed and never retried, judged only
# once both timings, each answer's Server-Timing and their difference are in the log, and sent with
# the Cloudflare Access service token that is required by name and never sent to this machine. A
# `curl` stub stands in for the network: it writes the case's body to curl's `-o` file and the
# case's response headers to its `-D` file, as curl writes them, prints the case's status and
# timings for `-w`, exits with the case's code, and records its argv, which is how the cases read
# what the probe sent.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/.github/scripts/catalog-first-request.sh"
CONTRACT="$ROOT/packages/contract/src/access-service-token.ts"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail=0
OUT=""
ARGV=""
# What staging's catalog answers in Server-Timing, different for each request so a swap shows.
COLD_SERVER_TIMING="db-connect;dur=48.0,db-query;dur=21.0,total;dur=75.0"
WARM_SERVER_TIMING="db-connect;dur=31.0,db-query;dur=12.0,total;dur=46.0"
# Response headers as curl's `-D` writes an HTTP/2 answer's: the status line first, CRLF line ends,
# lowercase field names, a blank line last. The escapes are the stub's to expand.
COLD_HEADERS="HTTP/2 200\r\ncontent-type: application/json\r\nserver-timing: $COLD_SERVER_TIMING\r\n\r\n"
WARM_HEADERS="HTTP/2 200\r\ncontent-type: application/json\r\nserver-timing: $WARM_SERVER_TIMING\r\n\r\n"
NO_SERVER_TIMING="HTTP/2 200\r\ncontent-type: application/json\r\n\r\n"

mkdir -p "$TMP/bin"
cat > "$TMP/bin/curl" <<'STUB'
#!/usr/bin/env bash
# Call 1 answers as the cold request and call 2 as the warm one, each from its STUB_<ROLE>_* settings.
# Like curl, it writes no `-D` file at all for an answer that never arrived (empty headers).
set -euo pipefail
printf '%s\n' "$*" >> "${STUB_STATE_DIR:?}/argv"
role=WARM
[ "$(wc -l < "$STUB_STATE_DIR/argv")" -gt 1 ] || role=COLD
body="STUB_${role}_BODY" status="STUB_${role}_STATUS" timing="STUB_${role}_TIMING" code="STUB_${role}_EXIT"
headers="STUB_${role}_HEADERS"
while [ "$#" -gt 1 ]; do
  [ "$1" != "-o" ] || printf '%s' "${!body}" > "$2"
  [ "$1" != "-D" ] || [ -z "${!headers}" ] || printf '%b' "${!headers}" > "$2"
  shift
done
printf '%s %s' "${!status}" "${!timing}"
exit "${!code}"
STUB
chmod +x "$TMP/bin/curl"

verdict() { # verdict <label> <detail when it fails> <check command...>
  local label="$1" detail="$2"; shift 2
  if "$@"; then printf 'PASS %s\n' "$label"; return; fi
  fail=$((fail + 1))
  printf 'FAIL %s\n%s\n' "$label" "$detail"
}

# A healthy cohort unless the case's VAR=value settings say otherwise: two 200 answers carrying a
# bangumi array and a Server-Timing each, the cold one slower, and a declared service token.
run_at() { # run_at <origin> <label> <want-exit> [VAR=value...]
  local origin="$1" label="$2" want="$3" state rc; shift 3
  state="$(mktemp -d "$TMP/case.XXXXXX")"
  OUT="$state/out" ARGV="$state/argv"
  touch "$ARGV"
  env CF_ACCESS_CLIENT_ID=id.access CF_ACCESS_CLIENT_SECRET=not-a-real-secret \
    STUB_COLD_BODY='{"bangumi":[]}' STUB_COLD_STATUS=200 STUB_COLD_TIMING='0.400000 1.500000' STUB_COLD_EXIT=0 \
    STUB_WARM_BODY='{"bangumi":[]}' STUB_WARM_STATUS=200 STUB_WARM_TIMING='0.050000 0.250000' STUB_WARM_EXIT=0 \
    STUB_COLD_HEADERS="$COLD_HEADERS" STUB_WARM_HEADERS="$WARM_HEADERS" \
    "$@" STUB_STATE_DIR="$state" PATH="$TMP/bin:$PATH" bash "$SCRIPT" "$origin" > "$OUT" 2>&1 && rc=0 || rc=$?
  verdict "$label" "want exit $want, got $rc: $(cat "$OUT")" [ "$rc" -eq "$want" ]
}

run() { run_at "https://staging.example.test" "$@"; }

expect_line() { # expect_line <label> <text the probe printed>
  verdict "$1" "no line carries \"$2\" in: $(cat "$OUT")" grep -qF -- "$2" "$OUT"
}

expect_whole_line() { # expect_whole_line <label> <a line the probe printed, nothing more on it>
  verdict "$1" "no line is exactly \"$2\" in: $(cat -v "$OUT")" grep -qxF -- "$2" "$OUT"
}

expect_calls() { # expect_calls <label> <curl processes the probe started>
  local got; got="$(wc -l < "$ARGV" | tr -d ' ')"
  verdict "$1" "want $2 curl calls, got $got" [ "$got" -eq "$2" ]
}

expect_sent() { # expect_sent <label> <calls that match> <extended regex over one call's argv>
  local got; got="$(grep -cE -- "$3" "$ARGV" || true)"
  verdict "$1" "want $2 calls matching $3, got $got: $(cat "$ARGV")" [ "$got" -eq "$2" ]
}

spells_both() { grep -qF -- "$1" "$SCRIPT" && grep -qF -- "$1" "$CONTRACT"; }

echo "=== a healthy cohort: one cold request, one warm request, both timed ==="
run "two 200 answers carrying a bangumi array pass" 0
expect_calls "each request is a curl process of its own, and there are two" 2
expect_sent "both read catalog's public popularity route, with no query" 2 ' https://staging\.example\.test/catalog/public/popular$'
expect_sent "the client id header rides on both" 2 'CF-Access-Client-Id: id\.access'
expect_sent "the client secret header rides on both" 2 'CF-Access-Client-Secret: not-a-real-secret'
expect_sent "curl is never told to retry or to follow a redirect" 0 '--retry|--location| -L( |$)'
expect_line "the cold timing is in the log" "cold request: HTTP 200 in 1.500000 s (first byte 0.400000 s, curl exit 0)"
expect_line "the warm timing is in the log" "warm request: HTTP 200 in 0.250000 s (first byte 0.050000 s, curl exit 0)"
expect_line "their difference is in the log" "cold 1.500000 s, warm 0.250000 s, cold minus warm +1.250000 s"
run "a warm request slower than the cold one still passes" 0 STUB_WARM_TIMING='0.050000 2.000000'
expect_line "and the difference keeps its sign" "cold minus warm -0.500000 s"

echo
echo "=== each answer's Server-Timing, a line of its own beside its timing, decides nothing ==="
run "answers carrying Server-Timing pass" 0
expect_whole_line "the cold answer's is in the log" "cold request Server-Timing: $COLD_SERVER_TIMING"
expect_whole_line "the warm answer's is in the log" "warm request Server-Timing: $WARM_SERVER_TIMING"
run "answers carrying none still pass" 0 STUB_COLD_HEADERS="$NO_SERVER_TIMING" STUB_WARM_HEADERS="$NO_SERVER_TIMING"
expect_whole_line "and the log says the cold one carried none" "cold request Server-Timing: none"
expect_whole_line "and that the warm one carried none" "warm request Server-Timing: none"
run "a field in HTTP/1.1's letter case passes" 0 STUB_COLD_HEADERS="HTTP/1.1 200 OK\r\nServer-Timing: $COLD_SERVER_TIMING\r\n\r\n"
expect_whole_line "and is read all the same" "cold request Server-Timing: $COLD_SERVER_TIMING"
run "an answer with two Server-Timing lines passes" 0 \
  STUB_COLD_HEADERS="HTTP/2 200\r\nserver-timing: db-connect;dur=48.0\r\nserver-timing: edge;dur=3.0\r\n\r\n"
expect_whole_line "and both are in the log, joined as HTTP joins them" "cold request Server-Timing: db-connect;dur=48.0, edge;dur=3.0"

echo
echo "=== a wrong answer fails the step, once both timings are in the log ==="
run "a cold 503 fails" 1 STUB_COLD_STATUS=503
expect_line "and names the cold request" "the cold request failed: HTTP 503"
expect_line "and its timing is still in the log" "cold request: HTTP 503 in 1.500000 s"
expect_whole_line "and so is its Server-Timing" "cold request Server-Timing: $COLD_SERVER_TIMING"
expect_line "and so is the difference" "cold minus warm +1.250000 s"
expect_calls "and the warm request still runs once, which cannot rescue it" 2
run "a cold body with no bangumi array fails" 1 STUB_COLD_BODY='{"bangumi":null}'
expect_line "and says what was wrong with it" "the cold request failed: the body has no bangumi array"
run "a cold body that is not JSON fails" 1 STUB_COLD_BODY='<html>Sign in</html>'
run "a cold request curl gave up on fails" 1 STUB_COLD_STATUS=000 STUB_COLD_EXIT=28 STUB_COLD_TIMING='15.000000 15.000500' \
  STUB_COLD_BODY= STUB_COLD_HEADERS=
expect_line "and its timing is still in the log" "cold request: HTTP 000 in 15.000500 s (first byte 15.000000 s, curl exit 28)"
expect_whole_line "and the log says it carried no Server-Timing" "cold request Server-Timing: none"
expect_whole_line "and the warm answer's is still in the log" "warm request Server-Timing: $WARM_SERVER_TIMING"
run "a warm 503 fails" 1 STUB_WARM_STATUS=503
expect_line "and names the warm request" "the warm request failed: HTTP 503"
expect_line "and both timings are in the log" "cold 1.500000 s, warm 0.250000 s, cold minus warm +1.250000 s"

echo
echo "=== the Cloudflare Access service token ==="
run "an unset client id fails before any request" 1 CF_ACCESS_CLIENT_ID=
expect_calls "and nothing was sent" 0
run "an unset client secret fails before any request" 1 CF_ACCESS_CLIENT_SECRET=
expect_calls "and nothing was sent" 0
# One row per loopback form of `isLoopbackHostname` in the contract.
for origin in http://localhost:8787 http://app.localhost:8787 http://127.0.0.1:8787 \
  http://127.0.0.2:8787 "http://[::1]:8787" "http://[::]:8787" http://0.0.0.0:8787
do
  run_at "$origin" "the token is never sent to $origin" 1
  expect_calls "and $origin was sent nothing" 0
done

echo
echo "=== the script spells what the one TS definition owns ==="
for literal in CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET CF-Access-Client-Id CF-Access-Client-Secret \
  localhost .localhost '[::1]' '[::]' 0.0.0.0 127.
do
  verdict "both files spell $literal" "only one of $SCRIPT and $CONTRACT spells it" spells_both "$literal"
done

echo
if [ "$fail" -ne 0 ]; then
  echo "$fail catalog-first-request test(s) failed." >&2
  exit 1
fi
echo "All catalog-first-request tests passed."
