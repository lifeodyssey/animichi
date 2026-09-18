#!/usr/bin/env bash
# Shared fixture for the pre-push gate's behavioral tests —
# `pre-push-affected.test.sh` (which packages a diff selects) and
# `pre-push-affected-commitlint.test.sh` (which messages a push carries).
#
# Hermetic: every case builds a throwaway git repository under one temp root
# with its own `origin/main`, a fake `pnpm` / `make` on PATH and the
# four documentation checks stubbed. No real suite, container or network call.
# The fake pnpm does double duty — it answers `ls -r --depth -1 --json` and
# records every `run` asked of it: the selected set, the serial flag and the
# absent `...` closure are read off it — and it forwards `exec commitlint` to
# the workspace's own CLI, because the gate's message check must run the
# repository's real rules, not a stub's reading of them. A case that wants the
# check to fail closed points REAL_COMMITLINT somewhere that is not there.
# GATE_UNDER_TEST points at a mutant; PNPM_FAIL_SCRIPT names a package script
# the fake pnpm must exit 1 on (the gate's failure propagation).
#
# Sourced, not run: the caller keeps `set -euo pipefail`, sources this file, runs
# its cases and ends with `finish`.
REPO_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
cd "$REPO_ROOT"
GATE="${GATE_UNDER_TEST:-$REPO_ROOT/scripts/local-gates/pre-push-affected.sh}"
# The root project is in the list so the cases can prove the gate subtracts it
# by name.
PROJECTS='.:animichi-cloudflare-worker packages/agent:@animichi/agent packages/contract:@animichi/contract apps/web:web workers/catalog:catalog workers/users:users'
# The workspace's own CLI: the message cases assert the repository's real rules,
# and a case that wants the check to fail closed points this somewhere absent.
export REAL_COMMITLINT="$REPO_ROOT/node_modules/.bin/commitlint"
# The remote sha git reports for a branch it has never seen.
export ZERO=0000000000000000000000000000000000000000
TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT
failures=0
reported=0

fail() { printf 'FAIL %s: %s\n' "$1" "$2" >&2; failures=$((failures + 1)); }
# Reports the case just closed: one whose assertions added failures since the
# last report prints `not ok`, so a mutant cannot read as green anywhere.
ok() {
  if [ "$failures" = "$reported" ]; then printf 'ok: %s\n' "$1"; else printf 'not ok: %s\n' "$1"; fi
  reported="$failures"
}
expect() { case "$3" in *"$2"*) ;; *) fail "$1" "expected to see '$2' in: $3" ;; esac; }
refute() { case "$3" in *"$2"*) fail "$1" "did not expect '$2' in: $3" ;; esac; }
expect_status() { [ "$2" = "$3" ] || fail "$1" "expected exit $2, got $3"; }

# The fake tools. `ls` builds the project list from $PWD, which the gate has
# already cd'd to its toplevel, so the paths it strips are the ones it computed.
install_stubs() {
  cat > "$BIN/pnpm" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = ls ]; then
  jq -n --arg root "$PWD" --arg spec "$PNPM_PROJECTS" \
    '$spec | split(" ") | map(select(length > 0) | split(":")) | map({name: .[1], path: ($root + "/" + .[0])})'
  exit 0
fi
if [ "${1:-}" = exec ] && [ "${2:-}" = commitlint ]; then
  printf 'pnpm %s\n' "$*" >> "$INVOCATIONS"
  shift 2
  exec "$REAL_COMMITLINT" "$@"
fi
printf 'pnpm %s\n' "$*" >> "$INVOCATIONS"
# A case that needs a package script to fail — the gate has to propagate a red suite, not report
# green — names that script in PNPM_FAIL_SCRIPT. Unset, the fake records and succeeds as before.
if [ -n "${PNPM_FAIL_SCRIPT:-}" ]; then
  for argument in "$@"; do [ "$argument" = "$PNPM_FAIL_SCRIPT" ] || continue; exit 1; done
fi
STUB
  # `make` is the one non-pnpm tool a routed bucket still shells out to; it records and succeeds.
  printf '#!/usr/bin/env bash\nprintf "make %%s\\n" "$*" >> "$INVOCATIONS"\n' > "$BIN/make"
  for check in agents-refs docs-paths root-allowlist spec-references; do
    printf '#!/usr/bin/env bash\nprintf "check-%s\\n" >> "$INVOCATIONS"\n' "$check" \
      > "$REPO/scripts/local-gates/check-$check.sh"
  done
  chmod +x "$BIN"/* "$REPO/scripts/local-gates"/*.sh
}

new_repo() { # optional <path>... — extra files seeded before the first commit
  REPO="$(mktemp -d "$TMPROOT/case.XXXXXX")"
  BIN="$REPO/.bin"
  INVOCATIONS="$REPO/.invocations"
  export INVOCATIONS
  export PNPM_PROJECTS="$PROJECTS"
  mkdir -p "$BIN" "$REPO/scripts/local-gates"
  : > "$INVOCATIONS"
  # The real config and a link to the installed workspace (the `extends`
  # resolution below it) make the fixture repo a commitlint-clean checkout.
  cp "$REPO_ROOT/commitlint.config.js" "$REPO/commitlint.config.js"
  ln -s "$REPO_ROOT/node_modules" "$REPO/node_modules"
  install_stubs
  cp "$GATE" "$REPO/scripts/local-gates/pre-push-affected.sh"
  local path
  for path in "$@"; do mkdir -p "$REPO/$(dirname "$path")"; printf 'probe\n' > "$REPO/$path"; done
  (
    cd "$REPO"
    git init -q -b main
    git config user.email gate@test.invalid
    git config user.name gate
    git add -A
    git commit -qm "chore(repo): seed the probe repository"
    git update-ref refs/remotes/origin/main HEAD
  )
}

commit_message() { # <subject> <path>... — one more commit on the current branch
  local subject="$1" path
  shift
  for path in "$@"; do mkdir -p "$REPO/$(dirname "$path")"; printf 'probe\n' > "$REPO/$path"; done
  git -C "$REPO" add -A
  git -C "$REPO" commit -qm "$subject"
}

commit_change() { # <branch> <path>...
  local branch="$1"
  shift
  git -C "$REPO" checkout -q -B "$branch" main
  commit_message 'fix(catalog): probe the gate' "$@"
}

commit_delete() { # <branch> <path>... — commits the deletion of existing paths
  local branch="$1" path
  shift
  git -C "$REPO" checkout -q -B "$branch" main
  for path in "$@"; do git -C "$REPO" rm -qr -- "$path"; done
  git -C "$REPO" commit -qm 'fix(catalog): probe the gate'
}

# The extra environment `run_gate` passes to the gate. Every case starts from
# the probe-only default; one that needs more sets it here, and resets it after.
gate_env() { GATE_ENV=("$@"); }

run_gate() { # stdin is the caller's; GATE_ENV carries any extra environment
  set +e
  OUT="$(cd "$REPO" && PATH="$BIN:$PATH" env "${GATE_ENV[@]}" bash scripts/local-gates/pre-push-affected.sh 2>&1)"
  STATUS=$?
  set -e
  RECORDED="$(cat "$INVOCATIONS")"
}
# Because this file is sourced, the variables it publishes to its caller are
# exported: shellcheck reads each file on its own, and `OUT`, `STATUS` and
# `RECORDED` are read by the cases rather than here.
export OUT="" STATUS=0 RECORDED=""
GATE_ENV=(GATE_PROBE=1)

finish() {
  [ "$failures" = 0 ] || { printf '%s case(s) failed\n' "$failures" >&2; exit 1; }
  printf '%s: all green\n' "$(basename "$0")"
}
