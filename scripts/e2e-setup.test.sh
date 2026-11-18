#!/usr/bin/env bash
# SUT: scripts/e2e-setup.sh
# The E2E setup installs the e2e package's dependencies once, then the
# Playwright browser. A failed install must end the setup with pnpm's own
# error: a silenced first attempt followed by a second install with other
# arguments can pass and leave a different tree than the one asked for.
#
# Every outside tool is a stub that logs its arguments: pnpm, npx and curl on
# PATH, and the Playwright binary the script calls by path, which lives in the
# throwaway tree the script is copied into and runs from. No case installs,
# downloads or reaches the dev server's port, even when the script is wrong.
set -euo pipefail

SUT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/e2e-setup.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
TREE="$TMP/tree"
BIN="$TMP/bin"
CALLS="$TMP/calls"
mkdir -p "$TREE/scripts" "$TREE/e2e/node_modules/.bin" "$BIN"
cp "$SUT" "$TREE/scripts/e2e-setup.sh"

# One stub behind every tool name. It logs "<tool> <args>"; with
# STUB_INSTALL_FAILS=1 a pnpm install prints an error naming its own
# arguments and fails, so each install's error can be told apart.
cat >"$TMP/stub" <<'STUB'
#!/usr/bin/env bash
printf '%s %s\n' "$(basename "$0")" "$*" >>"$STUB_CALLS"
case "${STUB_INSTALL_FAILS:-}:$(basename "$0"):${1:-}" in
  1:pnpm:install) echo "ERR_PNPM_STUB refused: pnpm $*" >&2; exit 1 ;;
esac
STUB
chmod +x "$TMP/stub"
for tool in pnpm npx curl; do ln -s "$TMP/stub" "$BIN/$tool"; done
ln -s "$TMP/stub" "$TREE/e2e/node_modules/.bin/playwright"

run_setup() {
  local rc=0
  : >"$CALLS"
  PATH="$BIN:$PATH" STUB_CALLS="$CALLS" bash "$TREE/scripts/e2e-setup.sh" >"$TMP/out" 2>&1 || rc=$?
  printf '%s\n' "$rc"
}

fail() {
  echo "FAIL: $1" >&2
  echo "--- setup output:" >&2; cat "$TMP/out" >&2
  echo "--- tool calls:" >&2; cat "$CALLS" >&2
  exit 1
}

test_a_failed_install_ends_the_setup_with_its_error() {
  local rc
  rc="$(STUB_INSTALL_FAILS=1 run_setup)"
  [ "$rc" != 0 ] || fail "a failed install must fail the setup"
  grep -qF "ERR_PNPM_STUB refused: pnpm install --ignore-scripts --filter animichi-e2e" "$TMP/out" ||
    fail "the setup hid the failed install's error"
  [ "$(cat "$CALLS")" = "pnpm install --ignore-scripts --filter animichi-e2e" ] ||
    fail "a failed install must be the setup's last step: no second install, no browser download"
  echo "ok: a failed install ends the setup with pnpm's own error and nothing after it"
}

test_a_passing_install_goes_on_to_the_browser() {
  local rc
  rc="$(run_setup)"
  [ "$rc" = 0 ] || fail "a passing install must let the setup finish (exit $rc)"
  [ "$(head -n 2 "$CALLS")" = "pnpm install --ignore-scripts --filter animichi-e2e
playwright install --with-deps chromium" ] || fail "one install, then the Playwright browser"
  echo "ok: a passing install is followed by the Playwright browser install"
}

test_a_failed_install_ends_the_setup_with_its_error
test_a_passing_install_goes_on_to_the_browser
echo "e2e-setup.test.sh: all green"
