#!/usr/bin/env bash
# SUT: scripts/delivery/migrate-through-worker.sh — redact_dsn_passwords
# Rule 2's ambiguous-closer surface (#1912), in its own file so each redaction suite stays
# under the 200-line test cap. Every line here holds two `password` keys, and the second
# key's own opener is a second quote that could close the first value: where the first value
# never closed, the reading the rule took either printed the second secret or swallowed it
# whole. The escaped surface without that second key is
# migrate-through-worker-redaction-escaped.test.sh; the unescaped surfaces live in
# migrate-through-worker-redaction.test.sh.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/delivery/migrate-through-worker.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }

# --- redact_dsn_passwords, ambiguous closer -----------------------------------
#
# The same discipline as the other two redaction suites: the driver is the shipped
# definition lifted verbatim, so these exercise the function the script runs rather than a
# copy of it; every credential is a zero-entropy placeholder, `ab`/`cd` for the shapes that
# need to stay legible and `LEAKME` for the secret the line must not print; and each case
# compares the WHOLE line, both directions, with `cmp`, so a stray byte counts.
#
# The rule-2 comment in the script carries the policy: where two of the line's quotes could
# close the value, the reading that leaves no secret visible wins. The closer is optional,
# so the body runs to the farther quote; the nested `password` key's opener is a body unit
# for the same reason, so the second secret falls inside the first value's redaction
# instead of printing behind it.
#
# The unit's ledger, measured case by case with each case in its own process. Dropping the
# unit turns ten cases red — the six unterminated ones and the four branch witnesses
# below — and leaves the three closed ones green. Dropping the unit's spaces, its colon,
# its plain key quote or its escaped quote turns exactly its own witness red. Dropping the
# unit's raw-quote alternative (#1923) turns exactly the nested-value case below red.
# Replacing the key with a bare `[=:][[:space:]]*\"` turns the two quoted-key witnesses red:
# without the key text the body stops at the `"` or the `\"` that follows `password`, the value
# ends there, and the secret prints behind it.
# No mutation of the unit moves a case in the escaped suite or the main redaction suite;
# the escaped branch's own mutations do move cases here, and that file's header counts its
# own cases.
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

# #1912, inherited. The plain unterminated value: `main` leaked this one too. The body has
# no unit for the second key, stops one character short of its opener, and the optional
# closer takes that opener as its own, printing `LEAKME` behind the redaction. The nested
# opener's unit carries the body over it, so the second value goes with the first.
case_redacts_a_plain_unterminated_value_before_a_second_key() {
  assert_redacts '{"cause":"password=\"ab cd user=u password=\"LEAKME\""}' '{"cause":"password=***"}'
}

# #1912, inherited. The same, with the value's own inner `\"` before the second key. The
# four-backslash unit reads it whole, so the body still arrives at the nested opener.
case_redacts_an_inner_quote_before_a_second_key() {
  assert_redacts '{"cause":"password=\"ab\\\" user=u password=\"LEAKME\""}' '{"cause":"password=***"}'
}

# #1912, new. `\n` is the JSON escape #1911 taught the body to read, and reading it is what
# carries the body into the second key. This is the shape of all 281 lines the round-1
# review measured; `main` stopped at the backslash, so its `g` scan found the second key and
# redacted it, while #1911's body crossed the escape and took the second key's opener.
case_redacts_a_json_escape_before_a_second_key() {
  assert_redacts '{"cause":"password=\"ab\n cd user=u password=\"LEAKME\""}' '{"cause":"password=***"}'
}

# #1912, new. An inner-layer escape, `\\c`: two raw backslashes and a `c`, the unit #1911
# added. Same mechanism as the JSON escape above.
case_redacts_an_inner_escape_before_a_second_key() {
  assert_redacts '{"cause":"password=\"ab\\ cd user=u password=\"LEAKME\""}' '{"cause":"password=***"}'
}

# #1912, new. `\/` read as a JSON escape inside a word, then plain characters to the second
# key — the crossing is longer than the closer is far.
case_redacts_a_json_escape_inside_a_word_before_a_second_key() {
  assert_redacts '{"cause":"password=\"ab\/cd user=u password=\"LEAKME\""}' '{"cause":"password=***"}'
}

# #1923. The nested value opens with a plain `"` where #1912's rows open with `\"`. The
# escaped body has no unit for a raw quote, so it stops at the `"`, the optional closer
# takes it, and the second secret prints behind the redaction. The unit's raw-quote
# alternative reads the nested opener as a body unit, and the second value goes with the
# first. The quote it reads is the one that ends the JSON string, so this line gives up
# #1909's structure — the accepted cost of ranking no secret visible first.
case_redacts_a_nested_value_opening_with_a_raw_quote() {
  assert_redacts '{"cause":"password=\"ab\n cd user=u password="LEAKME""}' '{"cause":"password=***""}'
}

# The direction the unit must not pay for: a first value that DOES close keeps everything
# behind it, and the second key is redacted under its own key by the rule's `g` flag. The
# nested opener here sits past a closer the body already took, so the unit never fires and
# the second key keeps its own redaction. The three closed cases are this unit's guard: they
# pin the ` user=u ` diagnostic the unit must not eat, and no mutation of the unit turns
# them red — dropping the escaped branch or its plain-character unit does.
case_keeps_the_second_key_when_the_first_value_closes_after_an_inner_escape() {
  assert_redacts '{"cause":"password=\"ab\\cd\" user=u password=\"LEAKME\""}' \
                 '{"cause":"password=*** user=u password=***"}'
}

case_keeps_the_second_key_when_the_first_value_closes_after_a_json_escape() {
  assert_redacts '{"cause":"password=\"ab\/cd\" user=u password=\"LEAKME\""}' \
                 '{"cause":"password=*** user=u password=***"}'
}

# The same direction for the JSON key form: the first value closes at its own `\"`, and
# `"password":"LEAKME"` is matched by the quoted branch on the rescan.
case_keeps_the_second_key_when_the_first_value_closes_before_a_json_key() {
  assert_redacts '{"cause":"password=\"ab\n\",\"user\":\"u\",\"password\":\"LEAKME\""}' \
                 '{"cause":"password=***,\"user\":\"u\",\"password\":***"}'
}

# The nested unit copies rule 2's key shape, so it answers the same four spellings the key
# part does. Each is the card's row with the nested key written the way the key part admits
# it, and each is a leak on #1911's head: `main` redacted the second key on all four.
case_redacts_a_nested_key_written_with_spaces_around_the_separator() {
  assert_redacts '{"cause":"password=\"ab\n cd user=u password = \"LEAKME\""}' '{"cause":"password=***"}'
}

case_redacts_a_nested_key_whose_quote_is_escaped() {
  assert_redacts '{"cause":"password=\"ab\n cd user=u password\"=\"LEAKME\""}' '{"cause":"password=***"}'
}

case_redacts_a_nested_key_whose_quote_is_plain() {
  assert_redacts '{"cause":"password=\"ab\n cd user=u password"=\"LEAKME\""}' '{"cause":"password=***"}'
}

case_redacts_a_nested_key_separated_by_a_colon() {
  assert_redacts '{"cause":"password=\"ab\n cd user=u password:\"LEAKME\""}' '{"cause":"password=***"}'
}

for test_case in \
  case_redacts_a_plain_unterminated_value_before_a_second_key \
  case_redacts_an_inner_quote_before_a_second_key \
  case_redacts_a_json_escape_before_a_second_key \
  case_redacts_an_inner_escape_before_a_second_key \
  case_redacts_a_json_escape_inside_a_word_before_a_second_key \
  case_redacts_a_nested_value_opening_with_a_raw_quote \
  case_keeps_the_second_key_when_the_first_value_closes_after_an_inner_escape \
  case_keeps_the_second_key_when_the_first_value_closes_after_a_json_escape \
  case_keeps_the_second_key_when_the_first_value_closes_before_a_json_key \
  case_redacts_a_nested_key_written_with_spaces_around_the_separator \
  case_redacts_a_nested_key_whose_quote_is_escaped \
  case_redacts_a_nested_key_whose_quote_is_plain \
  case_redacts_a_nested_key_separated_by_a_colon; do
  "$test_case"
done

echo "PASS: migrate-through-worker-redaction-ambiguous-closer.test.sh"
