#!/usr/bin/env bash
# Behaviour tests for migrate-through-worker.sh (card C3 / #1365).
#
# The defect this script exists to prevent (#1332) is invisible in its source:
# every line reads correctly whether or not the POST waits for the new bundle,
# and the difference only shows as an ordering of real calls. So these run the
# shipped script against a `curl` stub that records every call in order, and
# assert the ORDER and the failure messages — not the text of the script.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/delivery/migrate-through-worker.sh"
SEALED_REF="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
OTHER_REF="cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
WORKSPACE=""
# Resolved before any test puts the stub on PATH, so the stub can still reach the
# shipped curl. Every URL below is loopback port 1: the real curl either refuses
# the protocol or is refused the connection, both instantly, and no test call
# leaves the machine.
REAL_CURL="$(command -v curl)"
export REAL_CURL

fail() { echo "FAIL: $*" >&2; exit 1; }

# `curl` reaches three endpoints here: the OIDC mint, /healthz and /migrate.
# Each call appends its kind to CALL_LOG; /healthz answers STUB_TARGETS one entry
# per call (the last entry repeats), /migrate answers STUB_CODES the same way.
make_curl_stub() {
  cat > "$WORKSPACE/bin/curl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
args="$*"
# The transport decision is NOT faked: the real curl is handed this call's own
# argv and only its verdict is honoured. Exit 1 is "curl refuses this URL's
# protocol" — the failure the script must not survive — and it is reported with
# curl's own words. Any other exit means curl was willing to carry the call, so
# the canned answer is served.
verdict=0
refusal="$("${REAL_CURL:?}" "$@" 2>&1 >/dev/null)" || verdict=$?
if [ "$verdict" = 1 ]; then
  echo "$refusal" >&2
  exit 1
fi
count_of() { local f="$1" n=0; [ -f "$f" ] && n="$(cat "$f")"; echo $((n + 1)) > "$f"; echo "$n"; }
pick() { local list="$1" index="$2"; awk -v i="$index" '{ print (i + 1 <= NF) ? $(i + 1) : $NF }' <<< "$list"; }
case "$args" in
  *"/healthz"*)
    echo healthz >> "${CALL_LOG:?}"
    printf '{"prismaTarget":"%s"}\n' "$(pick "${STUB_TARGETS:?}" "$(count_of "$STUB_STATE/healthz")")"
    ;;
  *"/migrate"*)
    echo migrate >> "${CALL_LOG:?}"
    out="${args#*-o }"; out="${out%% *}"
    code="$(pick "${STUB_CODES:?}" "$(count_of "$STUB_STATE/migrate")")"
    printf '{"success":true,"prisma":{"markerHash":"%s","migrationsApplied":0}}\n' "${STUB_MARKER:?}" > "$out"
    [ "$code" != 409 ] || printf '{"error":"stale_prisma_bundle"}\n' > "$out"
    printf '%s' "$code"
    ;;
  *)
    echo token >> "${CALL_LOG:?}"
    echo '{"value":"oidc-token"}'
    ;;
esac
STUB
  chmod +x "$WORKSPACE/bin/curl"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$WORKSPACE/bin/sleep"
  chmod +x "$WORKSPACE/bin/sleep"
}

setup() {
  WORKSPACE="$(mktemp -d)"
  mkdir -p "$WORKSPACE/bin" "$WORKSPACE/state"
  make_curl_stub
  printf '{"storage":{"storageHash":"%s"}}\n' "$SEALED_REF" > "$WORKSPACE/contract.json"
  export PATH="$WORKSPACE/bin:$PATH"
  export CALL_LOG="$WORKSPACE/calls" STUB_STATE="$WORKSPACE/state"
  export RUNNER_TEMP="$WORKSPACE" MIGRATOR_URL="https://127.0.0.1:1"
  export ACTIONS_ID_TOKEN_REQUEST_URL="https://127.0.0.1:1/token?a=1"
  export ACTIONS_ID_TOKEN_REQUEST_TOKEN="request-token"
  export BUNDLE_POLL_ATTEMPTS=3 BUNDLE_POLL_SECONDS=0 STALE_BUNDLE_ATTEMPTS=2
  export STUB_TARGETS="$SEALED_REF" STUB_CODES="200" STUB_MARKER="$SEALED_REF"
  : > "$CALL_LOG"
}

teardown() { rm -rf "$WORKSPACE"; }

run_script() { bash "$SCRIPT" production "$WORKSPACE/contract.json" 2>&1; }

calls() { tr '\n' ' ' < "$CALL_LOG"; }

case_applies_after_the_bundle_is_serving() {
  setup
  run_script > "$WORKSPACE/out" || fail "a serving bundle must migrate"
  grep -q "migrator applied $SEALED_REF" "$WORKSPACE/out" || fail "must report the applied identity"
  [ "$(calls)" = "token healthz migrate " ] || fail "polled: $(calls)"
  teardown
}

case_waits_for_the_new_bundle_before_posting() {
  setup
  STUB_TARGETS="$OTHER_REF $OTHER_REF $SEALED_REF"
  run_script > /dev/null || fail "must migrate once the new bundle serves"
  [ "$(calls)" = "token healthz healthz healthz migrate " ] || fail "did not wait: $(calls)"
  teardown
}

case_fails_when_the_new_bundle_never_serves() {
  setup
  STUB_TARGETS="$OTHER_REF"
  run_script > "$WORKSPACE/out" && fail "a bundle that never updates must fail the release"
  grep -q "never served schema identity $SEALED_REF" "$WORKSPACE/out" || fail "wrong message: $(cat "$WORKSPACE/out")"
  grep -q migrate "$CALL_LOG" && fail "must never POST to a stale bundle"
  teardown
}

case_retries_a_409_stale_bundle() {
  setup
  STUB_CODES="409 200"
  run_script > "$WORKSPACE/out" || fail "a 409 must be retried, not fail the release"
  grep -q "409 stale_prisma_bundle" "$WORKSPACE/out" || fail "must say why it retried"
  [ "$(calls)" = "token healthz migrate healthz migrate " ] || fail "did not re-poll: $(calls)"
  teardown
}

case_gives_up_on_an_endless_409() {
  setup
  STUB_CODES="409"
  run_script > "$WORKSPACE/out" && fail "an endless 409 must fail the release"
  grep -q "still served a stale bundle after 2 attempts" "$WORKSPACE/out" || fail "wrong message"
  teardown
}

# The marker the migrator reports IS the release's identity claim: a success naming another
# graph must fail the release rather than be reported as applied.
case_refuses_a_receipt_for_another_identity() {
  setup
  STUB_MARKER="$OTHER_REF"
  run_script > "$WORKSPACE/out" && fail "a receipt for another identity must fail the release"
  grep -q "did not apply schema identity $SEALED_REF" "$WORKSPACE/out" || fail "wrong message: $(cat "$WORKSPACE/out")"
  teardown
}

case_fails_on_any_other_status() {
  setup
  STUB_CODES="500"
  run_script > "$WORKSPACE/out" && fail "an HTTP 500 must fail the release"
  grep -q "migrator returned HTTP 500" "$WORKSPACE/out" || fail "wrong message"
  teardown
}

# CWE-319 (CodeRabbit on #1471): the OIDC request token and the minted token
# both ride on these calls, so a plain-http endpoint must stop the release
# instead of being dialled. Both cases assert the refusal the SHIPPED curl
# raises, and that no credential-bearing call follows it.
case_refuses_a_plaintext_token_endpoint() {
  setup
  ACTIONS_ID_TOKEN_REQUEST_URL="http://127.0.0.1:1/token?a=1"
  run_script > "$WORKSPACE/out" && fail "a plain-http token endpoint must fail the release"
  grep -q 'Protocol "http"' "$WORKSPACE/out" || fail "wrong refusal: $(cat "$WORKSPACE/out")"
  [ -z "$(calls)" ] || fail "nothing may be dialled after the refusal: $(calls)"
  teardown
}

case_refuses_a_plaintext_migrator_url() {
  setup
  MIGRATOR_URL="http://127.0.0.1:1"
  run_script > "$WORKSPACE/out" && fail "a plain-http migrator must fail the release"
  grep -q 'Protocol "http"' "$WORKSPACE/out" || fail "wrong refusal: $(cat "$WORKSPACE/out")"
  grep -q migrate "$CALL_LOG" && fail "must never POST the token over plain http"
  teardown
}

for test_case in \
  case_applies_after_the_bundle_is_serving \
  case_waits_for_the_new_bundle_before_posting \
  case_fails_when_the_new_bundle_never_serves \
  case_retries_a_409_stale_bundle \
  case_gives_up_on_an_endless_409 \
  case_refuses_a_receipt_for_another_identity \
  case_fails_on_any_other_status \
  case_refuses_a_plaintext_token_endpoint \
  case_refuses_a_plaintext_migrator_url; do
  "$test_case"
done

echo "PASS: migrate-through-worker.sh"
