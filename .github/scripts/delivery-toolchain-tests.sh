#!/usr/bin/env bash
# The delivery toolchain's own test suite (#1776): the behavioral tests of
# everything under .github/lib, .github/scripts, scripts/delivery and
# scripts/local-gates. pr-verification.yml's `delivery` filter selects this
# suite by those paths — the tests run when the toolchain (or the tests
# themselves) change and not otherwise — and this runner is the only thing
# that has to know the files: the suite is enumerated, never listed, so a new
# test joins it by landing in one of the four homes.
#
# The tests are subprocess-bound (real scripts against fixture trees, real
# node origins), so they run in parallel; four at a time is the default and
# what CI uses. TOOLCHAIN_TESTS_PARALLEL overrides the width.
#
# One thing is not parallel-safe, and it is declared rather than listed: a test
# that runs a real gate against the real repo root can hold a path in the
# checkout, and the two Pulumi gate tests share one — `infra-check.sh` creates
# and removes `infra/Pulumi.preflight.yaml` as it goes, so `infra-check.test.sh`'s
# runs were deleting the file `infra-check-unauthorized.test.sh` was asserting
# about (measured 2026-09-18: three rounds of the pair concurrently, three
# failures). A test whose header carries `# EXCLUSIVE:` therefore runs with the
# tree to itself, after the rest; the marker is the test's own declaration, so a
# new test joins that pass by saying so where a reader looks for it.
#
# `--list` prints the suite, one path per line: workflow-invocations.test.rb
# expands the lane's invocation of this runner through it, so a committed test
# nothing runs is still a red contract.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 1

parallel="${TOOLCHAIN_TESTS_PARALLEL:-4}"
EXCLUSIVE_MARK='^# EXCLUSIVE:'

suite() {
  {
    printf '%s\n' .github/test/delivery/*.test.rb \
                  scripts/local-gates/*.test.sh \
                  scripts/delivery/*.test.sh
    find .github/scripts -type f -name '*.test.sh'
  } | sort
}

if [ "${1:-}" = "--list" ]; then
  suite
  exit 0
fi

count=$(suite | wc -l)
if [ "$count" -eq 0 ]; then
  echo 'no delivery-toolchain tests matched the four homes' >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
: >"$work/verdicts.tsv"

# One verdict line per test; logs keyed by the path with its separators
# flattened, so same-named files in different homes cannot overwrite.
run_one() {
  test -f "$1" || { printf '%s\tmissing\t0\n' "$1" >>"$work/verdicts.tsv"; return; }
  tag="${1//\//_}"
  started=$(date +%s)
  if [ "${1%.rb}" != "$1" ]; then
    bundle exec ruby "$1" -v >"$work/$tag.log" 2>&1
  else
    bash "$1" >"$work/$tag.log" 2>&1
  fi
  status=$?
  printf '%s\t%s\t%s\n' "$1" "$status" "$(( $(date +%s) - started ))" >>"$work/verdicts.tsv"
}
export -f run_one
export work

# The suite split by what each test declares: everything without the marker
# runs at $parallel, the declared ones at one. Both passes append to the same
# verdict file, so the report below is the whole suite either way.
partition() {
  suite >"$work/all"
  : >"$work/exclusive"
  while IFS= read -r file; do
    if head -n 20 "$file" | grep -q "$EXCLUSIVE_MARK"; then printf '%s\n' "$file" >>"$work/exclusive"; fi
  done <"$work/all"
  if [ -s "$work/exclusive" ]; then
    grep -vxF -f "$work/exclusive" "$work/all" >"$work/shared" || true
  else
    cp "$work/all" "$work/shared"
  fi
}

run_batch() {
  [ -s "$1" ] || return 0
  xargs -P "$2" -n 1 bash -c 'run_one "$0"' <"$1"
}

suite_start=$(date +%s)
partition
exclusive=$(wc -l <"$work/exclusive")
run_batch "$work/shared" "$parallel"
run_batch "$work/exclusive" 1

failed=0
while IFS=$'\t' read -r file status secs; do
  tag="${file//\//_}"
  if [ "$status" != 0 ]; then
    failed=$((failed + 1))
    printf 'FAIL %s (%ss)\n' "$file" "$secs"
    tail -40 "$work/$tag.log"
  else
    printf 'ok   %s (%ss)\n' "$file" "$secs"
  fi
done <"$work/verdicts.tsv"

echo "delivery toolchain: $count tests, $(($(date +%s) - suite_start))s wall, $parallel at a time" \
     "($exclusive declared exclusive, run one at a time)"
if [ "$failed" -gt 0 ]; then
  echo "$failed failed" >&2
  exit 1
fi
