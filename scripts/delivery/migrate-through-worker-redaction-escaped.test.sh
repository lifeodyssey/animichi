#!/usr/bin/env bash
# SUT: scripts/delivery/migrate-through-worker.sh — redact_dsn_passwords
# The escaped-JSON surface of rule 2 (#1887, #1897), in its own file so each
# redaction suite stays under the 200-line test cap. Every case here feeds rule 2 a
# value whose quotes and backslashes arrive JSON-encoded — the two-layer shape a
# driver echoing a config line takes inside a response body — and asserts the whole
# redacted line back. The other surfaces live in migrate-through-worker-redaction.test.sh.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/delivery/migrate-through-worker.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }

# --- redact_dsn_passwords, escaped surface ------------------------------------
#
# The same discipline as the main redaction suite: the driver is the shipped
# definition lifted verbatim, so these exercise the function the script runs rather
# than a copy of it; every credential is the zero-entropy placeholder `xxxxxxxx`;
# and each case compares the WHOLE line, both directions, with `cmp`, so a stray
# byte counts.
#
# The rule-2 comment in the script carries the layer story: a lone `\"` matches no
# body unit and so can only close the value, while an inner `\\` arrives as four
# backslashes and an inner `\"` as three backslashes and a quote. Removing a rule or
# unit turns its cases red and only those — dropping the escaped branch or the plain
# character unit turns all five red; dropping the four-backslash unit turns only the
# backslash-run witness red; dropping the three-backslash unit turns only the
# quote-in-secret case red; and the pre-tokenizer body `[^"]` turns only the
# backslash-run witness red.
make_redact_driver() {
  { sed -n '/^redact_dsn_passwords()/,/^}/p' "$SCRIPT"; printf 'redact_dsn_passwords "$1"\n'; } > "$1/redact"
}

# One line in, its whole redacted line out. Scratch directory and driver are made per
# assertion, so a case needs neither setup nor teardown and no two cases share a file.
assert_redacts() {
  local work
  work="$(mktemp -d)"
  make_redact_driver "$work"
  printf '%s\n' "$1" > "$work/body"
  printf '%s\n' "$2" > "$work/want"
  bash "$work/redact" "$work/body" > "$work/got"
  cmp "$work/got" "$work/want" || fail "[$1] gave [$(cat "$work/got")]"
  rm -rf "$work"
}

# #1887. A quoted assignment carried inside a JSON string — the encoder's escaped form.
# The bare branch ends at the raw quote and the secret survives; the escaped branch's
# body matches no lone `\"`, so the value closes at its own `\"` and the closing
# quote and brace stay.
case_redacts_an_escaped_quoted_password_in_a_json_string() {
  assert_redacts '{"cause":"password=\"xxxxxxxx\""}' '{"cause":"password=***"}'
}

# The same surface in the direction it is paid: the branch is quote-terminated, not
# whitespace-terminated, so a multi-word secret behind escaped quotes is not left halved —
# leak above lost diagnostic is this pass's own ranking.
case_redacts_an_escaped_quoted_password_with_spaces_inside() {
  assert_redacts 'password=\"xx xx\"' 'password=***'
}

# #1897 (CodeRabbit). A secret that itself holds a quote reaches the body
# JSON-encoded as three backslashes and a quote. A body of bare non-quotes stops
# at that unit's own `\"`, redacts half the value and prints the rest, `cd\"`,
# to the public log; the body admits the unit whole, so only a lone `\"` ends
# the value and the tail behind it survives.
case_redacts_an_escaped_quoted_password_whose_secret_holds_a_quote() {
  assert_redacts '{"cause":"password=\"ab\\\"cd\"","tail":"preserved"}' \
                 '{"cause":"password=***","tail":"preserved"}'
}

# The closing discipline, in the direction it is paid: a normal escaped value keeps
# everything behind it, tail included — a body widened to `.*` would run to the
# line's LAST `\"` and eat `,"tail":"preserved"` with it.
case_keeps_the_tail_behind_a_normal_escaped_quoted_password() {
  assert_redacts '{"cause":"password=\"xxxxxxxx\"","tail":"preserved","op":"\"slow\""}' \
                 '{"cause":"password=***","tail":"preserved","op":"\"slow\""}'
}

# The shape that motivated the tokenizer (#1897): a value whose last character is a
# backslash carries the four backslashes of an inner `\\` right before its closing
# `\"`. A body of bare non-quotes cannot stop there — it eats the closer and runs to
# the LAST `\"` on the line, the second password loses its key, and `zzzzzzzz`
# prints. The four-backslash unit leaves the body one backslash short of the quote,
# the lone `\"` closes, and the second password is redacted under its own key.
case_redacts_a_second_password_behind_a_value_ending_in_a_backslash() {
  assert_redacts '{"cause":"password=\"ab\\\\\" user=u password=\"zzzzzzzz\""}' \
                 '{"cause":"password=*** user=u password=***"}'
}

for test_case in \
  case_redacts_an_escaped_quoted_password_in_a_json_string \
  case_redacts_an_escaped_quoted_password_with_spaces_inside \
  case_redacts_an_escaped_quoted_password_whose_secret_holds_a_quote \
  case_keeps_the_tail_behind_a_normal_escaped_quoted_password \
  case_redacts_a_second_password_behind_a_value_ending_in_a_backslash; do
  "$test_case"
done

echo "PASS: migrate-through-worker-redaction-escaped.test.sh"
