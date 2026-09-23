#!/usr/bin/env bash
# SUT: scripts/delivery/migrate-through-worker.sh — redact_dsn_passwords
# The escaped-JSON surface of rule 2 (#1887, #1897, #1905), in its own file so each
# redaction suite stays under the 200-line test cap. Every case here feeds rule 2 a
# value whose quotes and backslashes arrive JSON-encoded — the two-layer shape a
# driver echoing a config line takes inside a response body — and asserts the whole
# redacted line back. The unescaped surfaces live in migrate-through-worker-redaction.test.sh,
# and the shape where a second key's opener is the other `\"` that could close the value —
# the ambiguous closer — in migrate-through-worker-redaction-ambiguous-closer.test.sh.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/delivery/migrate-through-worker.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }

# --- redact_dsn_passwords, escaped surface ------------------------------------
#
# The same discipline as the main redaction suite: the driver is the shipped
# definition lifted verbatim, so these exercise the function the script runs rather
# than a copy of it; every credential is a zero-entropy placeholder, `xxxxxxxx` or the
# short `ab`/`cd` a shape needs to stay legible; and each case compares the WHOLE line,
# both directions, with `cmp`, so a stray byte counts.
#
# The rule-2 comment in the script carries the layer story: the escaped body is read one
# JSON token at a time — a plain character, a JSON escape such as `\/`, or an inner-layer
# escape of two raw backslashes plus one token — while a lone `\"` matches no body unit, so
# it can only close the value, and the trailing unit takes the two raw backslashes of a
# value ending in an inner backslash and stops before the quote, so the JSON string's own
# quote survives. Removing a unit turns its own witnesses red and no other case: no case in
# the main redaction suite moves for any mutation of the escaped branch, and every count
# below is this file's cases — the same units also carry the ambiguous-closer suite's, which
# that file's header counts. Dropping the escaped branch or the plain-character unit turns
# all thirteen escaped cases red; dropping the JSON-escape unit turns only the `\/` witness
# here red; dropping the inner-escape unit turns six red — the inner-quote, backslash-run,
# truncated inner-quote and closed `\\cd` cases, plus the truncated `\\cd` case and the one
# ending at its closer, added for #1909 — and each branch of that unit has its own witness:
# `[^"\\]` dropped takes the closed `\\cd`, truncated `\\cd` and closer-ending cases, `\\.`
# dropped the inner-quote, backslash-run and truncated inner-quote cases; the pre-tokenizer
# body `[^"]` turns the inner-quote, truncated inner-quote and structural cases red;
# dropping the new trailing unit turns only the structural case red; dropping the key's
# plain-quote option turns only the main suite's plain JSON key case red, its escaped-quote
# option only the escaped-key case here; requiring the closer turns the three truncated
# cases and the structural case red; and the rejected guard that admits a quote,
# `\\\\([^\\]|$)`, turns the inner-quote, backslash-run, truncated inner-quote and structural
# cases red (#1909).
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

# #1905 (F5). A JSON object carried inside a JSON string, so the KEY arrives escaped
# too: `\"password\"`. Rule 2's optional quote met the backslash and its `[=:]` never
# matched, so the whole assignment printed. A key quote admits the escaped form, and
# the value's own escaped quotes go with the value, as in the case above.
case_redacts_a_password_whose_key_is_escaped_in_a_json_string() {
  assert_redacts '{"cause":"{\"password\":\"xxxxxxxx\"}"}' '{"cause":"{\"password\":***}"}'
}

# #1905 (F6). A truncated cause: the value opens escaped and its closer never arrives.
# The escaped branch's closer is optional, so the branch ends where its body units stop
# rather than falling through to the bare branch, which took the lone `\` and stopped
# at the next `"`.
case_redacts_a_truncated_escaped_password() {
  assert_redacts '{"cause":"password=\"xxxxxxxx"}' '{"cause":"password=***"}'
}

# #1905. The same truncation carrying an inner `\"` of its own. A branch that stops at
# the first raw quote ends inside the value and prints the rest of the secret — which is
# what the earlier truncated branch did here; the units take that quote as part of the
# body, so the redaction runs to where the units stop.
case_redacts_a_truncated_escaped_password_with_an_inner_quote() {
  assert_redacts '{"cause":"password=\"ab\\\" more text here"}' '{"cause":"password=***"}'
}

# #1909 (unit 2). A JSON escape of a character that is neither quote nor backslash,
# `\/`. The old body named no such unit, stopped at the backslash, and printed `\/cd`
# and the closing `\"` with it; the tokenizer reads `\/` whole, so the value redacts
# to its closer and the ` tail` behind that closer survives.
case_redacts_an_escaped_quoted_password_carrying_a_json_escape() {
  assert_redacts '{"cause":"password=\"ab\/cd\" tail"}' '{"cause":"password=*** tail"}'
}

# #1909 (unit 3's `[^"\\]` branch). An inner-layer escape whose character is plain: an
# inner `\c` arrives as two raw backslashes and a `c`. The old body named only the
# four-backslash and three-backslash-and-quote shapes, so it stopped inside the value
# and printed `\\cd\"","tail":"preserved"}`; the unit takes `\\c` whole and the value
# redacts to its closer, tail intact.
case_redacts_an_escaped_quoted_password_carrying_an_inner_escape() {
  assert_redacts '{"cause":"password=\"ab\\cd\"","tail":"preserved"}' \
                 '{"cause":"password=***","tail":"preserved"}'
}

# #1909 (the same unit, value never closed). The card's first input: `\\c` arrives and the
# closer never does. The unit reads it whole, so the body stops where the units stop rather
# than at the backslash — without it the branch ends at `ab` and prints `\\cd"}`.
case_redacts_a_truncated_escaped_password_carrying_an_inner_escape() {
  assert_redacts '{"cause":"password=\"ab\\cd"}' '{"cause":"password=***"}'
}

# #1909 (the same unit, the closer right behind it). The card's second input: the value ends
# at its own closer, which the branch takes with it, so the JSON string's closing quote and
# brace stay.
case_redacts_an_escaped_quoted_password_carrying_an_inner_escape_ending_at_its_closer() {
  assert_redacts '{"cause":"password=\"ab\\ncd\""}' '{"cause":"password=***"}'
}

# #1909 (the JSON structure the unit must keep). A value that ends in a backslash carries
# the two raw backslashes of that backslash's encoding right before the quote that ends
# the JSON string. A unit that admits a quote — `\\\\([^\\]|$)`, the guard #1909
# rejected — takes that quote and then the comma behind it, leaving
# `{"cause":"password=***"tail":…`. The trailing unit takes exactly those two
# backslashes and stops before the quote, so it still closes the JSON string and
# `","tail":"preserved"}` is byte-identical.
case_keeps_the_json_structure_when_a_value_ends_in_a_backslash() {
  assert_redacts '{"cause":"password=\"ab\\","tail":"preserved"}' \
                 '{"cause":"password=***","tail":"preserved"}'
}

for test_case in \
  case_redacts_a_password_whose_key_is_escaped_in_a_json_string \
  case_redacts_a_truncated_escaped_password \
  case_redacts_a_truncated_escaped_password_with_an_inner_quote \
  case_redacts_an_escaped_quoted_password_in_a_json_string \
  case_redacts_an_escaped_quoted_password_with_spaces_inside \
  case_redacts_an_escaped_quoted_password_whose_secret_holds_a_quote \
  case_keeps_the_tail_behind_a_normal_escaped_quoted_password \
  case_redacts_a_second_password_behind_a_value_ending_in_a_backslash \
  case_redacts_an_escaped_quoted_password_carrying_a_json_escape \
  case_redacts_an_escaped_quoted_password_carrying_an_inner_escape \
  case_redacts_a_truncated_escaped_password_carrying_an_inner_escape \
  case_redacts_an_escaped_quoted_password_carrying_an_inner_escape_ending_at_its_closer \
  case_keeps_the_json_structure_when_a_value_ends_in_a_backslash; do
  "$test_case"
done

echo "PASS: migrate-through-worker-redaction-escaped.test.sh"
