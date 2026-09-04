#!/usr/bin/env bash
# URL-fragment scan regression for the pre-push hygiene tests — sourced by
# pre-push.test.sh (the single entry point); not standalone.
#
# #1003 regression: a `#` glued to a token (URL fragment) is NOT a comment —
# stripping it would hide the forbidden `git push` behind `page#frag`.
test_url_fragment_does_not_hide_forbidden_command() {
  printf '#!/usr/bin/env bash\ncurl '\''https://host/page#frag'\'' && git push origin main\n' > "$GATE_STUB_ROOT/scan-url-fragment.sh"
  if ( assert_script_hygiene "$GATE_STUB_ROOT/scan-url-fragment.sh" ) 2>/dev/null; then
    echo "FAIL: a # inside a URL fragment must not hide a forbidden command" >&2
    exit 1
  fi
  echo "ok: a # glued to a token (URL fragment) is not treated as a comment"
}
