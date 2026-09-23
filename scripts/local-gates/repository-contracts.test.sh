#!/usr/bin/env bash
# SUT: scripts/local-gates/repository-contracts.sh
# Behavioral tests for repository-contracts.sh (#1883): the registry it reads
# out of pr-verification.yml's `contracts` job, the two command forms it runs,
# and the lines it refuses. One throwaway git repository per case, each with its
# own workflow and its own probe programs; the real runner, no real contract
# test, no network. `Gemfile`, `Gemfile.lock` and `.ruby-version` are symlinked
# from the checkout so the `bundle exec ruby` form resolves the way it does in
# the workspace — the form is the runner's subject, not bundler's.
set -euo pipefail

CHECKOUT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNNER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/repository-contracts.sh"
TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT
failures=0
reported=0

fail() { printf 'FAIL %s: %s\n' "$1" "$2" >&2; failures=$((failures + 1)); }
ok() {
  if [ "$failures" = "$reported" ]; then printf 'ok: %s\n' "$1"; else printf 'not ok: %s\n' "$1"; fi
  reported="$failures"
}
expect() { case "$3" in *"$2"*) ;; *) fail "$1" "expected to see '$2' in: $3" ;; esac; }
refute() { case "$3" in *"$2"*) fail "$1" "did not expect '$2' in: $3" ;; esac; }
expect_status() { [ "$2" = "$3" ] || fail "$1" "expected exit $2, got $3"; }
expect_ran_nothing() {
  [ -z "$RAN" ] || fail "$1" "expected nothing to run, got: $RAN"
}

# The workflow a case reads: one `contracts` job whose single step runs the
# commands, indented into a `run: |` block.
contracts_workflow() {
  printf 'jobs:\n  contracts:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Verify\n        run: |\n'
  while IFS= read -r line; do printf '          %s\n' "$line"; done <<<"$1"
}

new_repo() { # <workflow yaml>
  REPO="$(mktemp -d "$TMPROOT/case.XXXXXX")"
  RECORD="$REPO/record"
  mkdir -p "$REPO/.github/workflows"
  local link
  for link in Gemfile Gemfile.lock .ruby-version; do ln -s "$CHECKOUT/$link" "$REPO/$link"; done
  printf '%s\n' "$1" >"$REPO/.github/workflows/pr-verification.yml"
  git -C "$REPO" init -q -b main
  git -C "$REPO" -c user.email=runner@test.invalid -c user.name=runner add -A
  git -C "$REPO" -c user.email=runner@test.invalid -c user.name=runner commit -qm 'chore(repo): seed the probe registry'
}

# The two probe programs every case names; each records that it ran, so a case
# can tell "the runner ran it" from "the runner reported green without running".
seed_probes() {
  printf 'File.write(ENV.fetch("RECORD"), "ruby probe\\n", mode: "a")\n' >"$REPO/probe-one.rb"
  printf '#!/usr/bin/env bash\nprintf "shell probe\\n" >> "$RECORD"\n' >"$REPO/probe-two.sh"
}

run_runner() { # ...args — no args runs the registry
  set +e
  OUT="$(cd "$REPO" && env RECORD="$RECORD" bash "$RUNNER" "$@" 2>&1)"
  STATUS=$?
  set -e
  RAN="$(cat "$RECORD" 2>/dev/null || true)"
}
OUT="" STATUS=0 RAN=""

# 1. `--list` is the registry, and reading it runs nothing: this is the read
#    that makes CI's contracts job and this gate one list rather than two.
new_repo "$(contracts_workflow $'bundle exec ruby probe-one.rb\nbash probe-two.sh')"
seed_probes
run_runner --list
expect_status "list" 0 "$STATUS"
expect "list" "bundle exec ruby probe-one.rb" "$OUT"
expect "list" "bash probe-two.sh" "$OUT"
expect_ran_nothing "list"
ok "--list prints the job's registry and runs none of it"

# 2. The default run executes every line, through the interpreter that line
#    names — the registry supplies a path, this script supplies the interpreter.
run_runner
expect_status "run" 0 "$STATUS"
expect "run" "contracts — 2 commands" "$OUT"
expect "run" "ruby probe" "$RAN"
expect "run" "shell probe" "$RAN"
ok "the default run executes every line of the registry"

# 3. A line the classifier cannot run stops the push and names itself. The whole
#    registry is read first, so a refused line cannot leave a green prefix.
new_repo "$(contracts_workflow $'bundle exec ruby probe-one.rb\npnpm exec something')"
seed_probes
run_runner
expect_status "unknown form" 1 "$STATUS"
expect "unknown form" "cannot classify" "$OUT"
expect "unknown form" "pnpm exec something" "$OUT"
expect_ran_nothing "unknown form"
ok "a command the gate cannot classify stops the push before any of it runs"

# 4. A line naming a path that is not committed is a contract that would pass by
#    absence, so it stops the push too.
new_repo "$(contracts_workflow $'bash probe-two.sh\nbash absent.sh')"
seed_probes
run_runner
expect_status "absent target" 1 "$STATUS"
expect "absent target" "bash absent.sh" "$OUT"
expect "absent target" "is not committed" "$OUT"
expect_ran_nothing "absent target"
ok "a registry line naming an uncommitted path stops the push"

# 5. The grammar is `<interpreter> <path>` and nothing else, so a workflow line
#    cannot carry a second command past the classifier into the gate.
new_repo "$(contracts_workflow 'bash probe-two.sh; printf pwned > pwned.txt')"
seed_probes
run_runner
expect_status "smuggled command" 1 "$STATUS"
expect "smuggled command" "cannot classify" "$OUT"
[ ! -f "$REPO/pwned.txt" ] || fail "smuggled command" "the smuggled command ran"
expect_ran_nothing "smuggled command"
ok "a line carrying a second command is refused rather than run"

# 6. An empty registry and a missing job both stop the push: a gate that finds
#    nothing to run has nothing to vouch for, and silence is never the answer.
new_repo "$(contracts_workflow '')"
run_runner
expect_status "empty registry" 1 "$STATUS"
expect "empty registry" "names no commands" "$OUT"
ok "a contracts job with no commands stops the push"

new_repo 'jobs:
  docs:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi'
run_runner
expect_status "missing job" 1 "$STATUS"
expect "missing job" "has no contracts job" "$OUT"
ok "a workflow with no contracts job stops the push"

[ "$failures" = 0 ] || { printf '%s case(s) failed\n' "$failures" >&2; exit 1; }
printf '%s: all green\n' "$(basename "$0")"
