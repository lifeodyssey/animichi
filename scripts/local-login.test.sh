#!/usr/bin/env bash
# SUT: scripts/local-login.sh
# The local magic-link login asks the Neon Auth origin for a link, reads the
# token back from the branch database and opens the verify URL. The email is
# data in both conversations: it reaches the origin as one JSON string and the
# database as one psql variable compared whole, so a quote, a backslash, `%` or
# `_` in it can neither break the request nor match another user's row.
#
# Every outside party is a stub that records what it was handed: curl (the
# origin), psql (the database), open (the browser) and sleep. The environment
# names unroutable loopback addresses, and the script runs from a throwaway
# tree that holds no apps/web/.env, so no case reads a credential or reaches a
# service, even when the script under test is wrong.
set -euo pipefail

SUT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/local-login.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/tree/scripts" "$TMP/bin"
cp "$SUT" "$TMP/tree/scripts/local-login.sh"

export NEON_AUTH_BASE_URL="http://127.0.0.1:9/neon-auth"
export LOCAL_WEB_ORIGIN="http://127.0.0.1:9"
export NEON_DATABASE_URL="postgresql://invalid@127.0.0.1:9/none"
export DATABASE_URL="postgresql://invalid@127.0.0.1:9/none"

# curl keeps the body it was handed with -d.
cat >"$TMP/bin/curl" <<'STUB'
#!/usr/bin/env bash
while [ "$#" -gt 0 ]; do
  case "$1" in -d) printf '%s' "$2" >"$STUB_DIR/request-body" ;; esac
  shift
done
STUB
# psql keeps its arguments, one per line, and the SQL it read; it answers one
# token, or with STUB_PSQL_FAILS=1 fails the way psql reports a query error.
cat >"$TMP/bin/psql" <<'STUB'
#!/usr/bin/env bash
echo call >>"$STUB_DIR/psql-calls"
printf '%s\n' "$@" >"$STUB_DIR/psql-args"
cat >"$STUB_DIR/psql-sql"
case "${STUB_PSQL_FAILS:-}" in
  1) echo "psql:<stdin>:5: ERROR:  stub refused the query" >&2; exit 3 ;;
esac
echo "stub-token"
STUB
cat >"$TMP/bin/open" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$STUB_DIR/opened"
STUB
cat >"$TMP/bin/sleep" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$STUB_DIR/slept"
STUB
chmod +x "$TMP/bin/curl" "$TMP/bin/psql" "$TMP/bin/open" "$TMP/bin/sleep"

run_login() {
  local rc=0
  rm -rf "$TMP/stub"
  mkdir "$TMP/stub"
  PATH="$TMP/bin:$PATH" STUB_DIR="$TMP/stub" bash "$TMP/tree/scripts/local-login.sh" "$1" \
    </dev/null >"$TMP/out" 2>&1 || rc=$?
  printf '%s\n' "$rc"
}

fail() {
  echo "FAIL: $1" >&2
  echo "--- login output:" >&2; cat "$TMP/out" >&2
  exit 1
}

test_an_email_with_a_quote_a_backslash_and_a_percent_is_one_json_string() {
  local email='qa"x\y%z@animichi.test' rc
  rc="$(run_login "$email")"
  [ "$rc" = 0 ] || fail "the login must finish against the stubs (exit $rc)"
  jq -e --arg email "$email" --arg callback "http://127.0.0.1:9/auth/callback" \
    '. == {email: $email, callbackURL: $callback}' "$TMP/stub/request-body" >/dev/null ||
    fail "the request body is not one JSON object naming exactly that email: $(cat "$TMP/stub/request-body")"
  echo "ok: an email holding a quote, a backslash and a percent sign is sent as one JSON string"
}

test_the_email_reaches_psql_only_as_a_variable_compared_whole() {
  local email="o'brien_%@animichi.test" rc
  rc="$(run_login "$email")"
  [ "$rc" = 0 ] || fail "the login must finish against the stubs (exit $rc)"
  grep -qxF "email=$email" "$TMP/stub/psql-args" || fail "psql was not handed the email as its variable"
  grep -qxF "ON_ERROR_STOP=1" "$TMP/stub/psql-args" || fail "a query error must stop psql, not read as no token"
  ! grep -qF "$email" "$TMP/stub/psql-sql" || fail "the email was spliced into the SQL text"
  grep -qF "= lower(:'email')" "$TMP/stub/psql-sql" || fail "the SQL does not compare the email whole"
  ! grep -qiE '\bi?like\b' "$TMP/stub/psql-sql" || fail "the SQL matches the email as a pattern"
  echo "ok: the email reaches psql only as a variable the query compares whole"
}

test_the_token_found_is_the_one_the_browser_opens() {
  [ "$(run_login dev@animichi.test)" = 0 ] || fail "the login must finish against the stubs"
  [ "$(cat "$TMP/stub/opened")" = \
    "http://127.0.0.1:9/neon-auth/magic-link/verify?token=stub-token&callbackURL=http://127.0.0.1:9/auth/callback" ] ||
    fail "the browser was not sent to the verify URL for the token psql returned"
  echo "ok: the browser opens the verify URL for the token the query returned"
}

test_a_database_error_stops_the_login_with_that_error() {
  local rc
  rc="$(STUB_PSQL_FAILS=1 run_login dev@animichi.test)"
  [ "$rc" != 0 ] || fail "a query error must fail the login"
  grep -qF "ERROR:  stub refused the query" "$TMP/out" || fail "the login hid psql's error"
  [ "$(wc -l <"$TMP/stub/psql-calls" | tr -d ' ')" = 1 ] || fail "a query error must not be polled again"
  [ ! -e "$TMP/stub/opened" ] || fail "a failed login must not open the browser"
  echo "ok: a database error stops the login with psql's own error, without polling"
}

test_an_email_with_a_quote_a_backslash_and_a_percent_is_one_json_string
test_the_email_reaches_psql_only_as_a_variable_compared_whole
test_the_token_found_is_the_one_the_browser_opens
test_a_database_error_stops_the_login_with_that_error
echo "local-login.test.sh: all green"
