#!/usr/bin/env bash
# SUT: scripts/local-gates/repository-contracts.sh
# Behavioral tests for repository-contracts.sh (#1883): the registry it reads
# out of pr-verification.yml's `contracts` job, the two command forms it runs,
# and the lines it refuses. One throwaway git repository per case, each with its
# own workflow and its own probe programs; the real runner, no real contract
# test, no network. `BUNDLE_GEMFILE`, which `run_runner` sets, points the `bundle
# exec ruby` form at the checkout's own Gemfile, so bundler resolves there the
# way it does for the real gate — the form is the runner's subject, not
# bundler's. Only `.ruby-version` is symlinked: an rbenv or mise shim reads it
# from the working directory, and `BUNDLE_GEMFILE` does not choose the Ruby.
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
expect_status() {
  [ "$2" = "$3" ] || { fail "$1" "expected exit $2, got $3"; printf '%s\n' "$OUT" >&2; }
}
expect_ran_nothing() {
  [ -z "$RAN" ] || fail "$1" "expected nothing to run, got: $RAN"
}

# The workflow a case reads: one `contracts` job whose single step runs the
# commands, indented into a `run: |` block.
contracts_workflow() {
  printf 'jobs:\n  contracts:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Verify\n        run: |\n'
  while IFS= read -r line; do printf '          %s\n' "$line"; done <<<"$1"
}

# The two probe programs every case names; each records that it ran, so a case
# can tell "the runner ran it" from "the runner reported green without running".
# `new_repo` seeds them before it commits: the registry check reads HEAD, so an
# uncommitted probe would be refused by the check under test.
seed_probes() {
  printf 'File.write(ENV.fetch("RECORD"), "ruby probe\\n", mode: "a")\n' >"$REPO/probe-one.rb"
  printf '#!/usr/bin/env bash\nprintf "shell probe\\n" >> "$RECORD"\n' >"$REPO/probe-two.sh"
}

new_repo() { # <workflow yaml>
  REPO="$(mktemp -d "$TMPROOT/case.XXXXXX")"
  RECORD="$REPO/record"
  mkdir -p "$REPO/.github/workflows"
  ln -s "$CHECKOUT/.ruby-version" "$REPO/.ruby-version"
  printf '%s\n' "$1" >"$REPO/.github/workflows/pr-verification.yml"
  seed_probes
  git -C "$REPO" init -q -b main
  git -C "$REPO" -c user.email=runner@test.invalid -c user.name=runner add -A
  git -C "$REPO" -c user.email=runner@test.invalid -c user.name=runner commit -qm 'chore(repo): seed the probe registry'
}

# A runner that resolves `bundle exec` from the fixture alone is the CI failure
# this pins: `ruby/setup-ruby` installs the Gemfile's gems under the checkout's
# `vendor/bundle` and records that path in the checkout's `.bundle/config`,
# which a fixture repository never sees — bundler would read the default gem
# path instead and find none of the lockfile's gems. BUNDLE_GEMFILE is the
# checkout's, so the fixture resolves the way the real gate does, on a laptop
# (gems installed globally) and in CI (gems in the checkout) alike.
run_runner() { # ...args — no args runs the registry
  set +e
  OUT="$(cd "$REPO" && env BUNDLE_GEMFILE="$CHECKOUT/Gemfile" RECORD="$RECORD" bash "$RUNNER" "$@" 2>&1)"
  STATUS=$?
  set -e
  RAN="$(cat "$RECORD" 2>/dev/null || true)"
}
OUT="" STATUS=0 RAN=""

# 1. `--list` is the registry, and reading it runs nothing: this is the read
#    that makes CI's contracts job and this gate one list rather than two.
new_repo "$(contracts_workflow $'bundle exec ruby probe-one.rb\nbash probe-two.sh')"
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
run_runner
expect_status "unknown form" 1 "$STATUS"
expect "unknown form" "cannot classify" "$OUT"
expect "unknown form" "pnpm exec something" "$OUT"
expect_ran_nothing "unknown form"
ok "a command the gate cannot classify stops the push before any of it runs"

# 4. A line naming a path that is present but untracked is the failure this
#    check exists for: the file is here, so `-f` is satisfied, and CI's checkout
#    of HEAD has no such file, so the same line is green here and red there. It
#    stops the push.
new_repo "$(contracts_workflow $'bash probe-two.sh\nbash probe-untracked.sh')"
printf '#!/usr/bin/env bash\nprintf "untracked probe\\n" >> "$RECORD"\n' >"$REPO/probe-untracked.sh"
run_runner
expect_status "untracked target" 1 "$STATUS"
expect "untracked target" "bash probe-untracked.sh" "$OUT"
expect "untracked target" "is not a regular file" "$OUT"
expect_ran_nothing "untracked target"
ok "a registry line naming an untracked path stops the push"

# 5. Staging is not committing: the index holds this file and HEAD does not, so a
#    check built on `git ls-files` accepts it while CI's checkout of HEAD still
#    has no such file. The predicate reads HEAD, and refuses.
new_repo "$(contracts_workflow $'bash probe-two.sh\nbash probe-staged.sh')"
printf '#!/usr/bin/env bash\nprintf "staged probe\\n" >> "$RECORD"\n' >"$REPO/probe-staged.sh"
git -C "$REPO" add probe-staged.sh
run_runner
expect_status "staged target" 1 "$STATUS"
expect "staged target" "bash probe-staged.sh" "$OUT"
expect "staged target" "is not a regular file" "$OUT"
expect_ran_nothing "staged target"
ok "a staged but uncommitted path stops the push"

# 6. A committed directory is not a program. The path is at HEAD, so a check
#    that asks only whether some object of that name exists clears the line and
#    `bash` on the directory then fails, after the lines above it have already
#    run — running them is the loss of the fail-fast the header promises, not
#    the promise kept. The mode answers whether the entry is a regular file, and
#    the fixture's own `.github` is a committed tree.
new_repo "$(contracts_workflow $'bash probe-two.sh\nbash .github')"
run_runner
expect_status "committed directory" 1 "$STATUS"
expect "committed directory" "bash .github" "$OUT"
expect "committed directory" "is not a regular file" "$OUT"
expect_ran_nothing "committed directory"
ok "a registry line naming a committed directory stops the push"

# 7. A committed symlink is a blob, so a check that asks `git cat-file -t`
#    clears it; `bash` on a link to a directory then fails at exit 126, after
#    the lines above it have run. `git ls-tree` reports the link's own mode,
#    `120000`, and the fixture's link points at its own committed `.github`.
new_repo "$(contracts_workflow $'bash probe-two.sh\nbash probe-link')"
ln -s .github "$REPO/probe-link"
git -C "$REPO" -c user.email=runner@test.invalid -c user.name=runner add -A
git -C "$REPO" -c user.email=runner@test.invalid -c user.name=runner commit -qm 'chore(repo): commit a symlink to a directory'
run_runner
expect_status "committed symlink" 1 "$STATUS"
expect "committed symlink" "bash probe-link" "$OUT"
expect "committed symlink" "is not a regular file" "$OUT"
expect_ran_nothing "committed symlink"
ok "a registry line naming a committed symlink to a directory stops the push"

# 8. The grammar is `<interpreter> <path>` and nothing else, so a workflow line
#    cannot carry a second command past the classifier into the gate.
new_repo "$(contracts_workflow 'bash probe-two.sh; printf pwned > pwned.txt')"
run_runner
expect_status "smuggled command" 1 "$STATUS"
expect "smuggled command" "cannot classify" "$OUT"
[ ! -f "$REPO/pwned.txt" ] || fail "smuggled command" "the smuggled command ran"
expect_ran_nothing "smuggled command"
ok "a line carrying a second command is refused rather than run"

# 9. An empty registry and a missing job both stop the push: a gate that finds
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
