#!/usr/bin/env bash
# Shared fixture + helpers for changed-packages.test.sh (the executable
# entrypoint); sourced, not standalone.
#
# Builds a throwaway git repository, seeds a canonical monorepo layout, and
# provides the stage/run/assert helpers plus the fake-git fail-closed seam
# (GATE_GIT_FAIL). Every helper respects the repo's <=10-line function rule.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROUTER="$SCRIPT_DIR/changed-packages.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"

git init -q
git config user.email gate@test.invalid
git config user.name "gate test"
git config commit.gpgsign false

assert_eq() {
  local expected="$1" actual="$2" label="$3"
  if [ "$actual" != "$expected" ]; then
    printf 'FAIL [%s]:\nexpected:\n%s\nactual:\n%s\n' "$label" "$expected" "$actual" >&2
    exit 1
  fi
}

assert_msg() {
  local msg="$1" out="$2"
  grep -qF -- "$msg" "$out" || {
    echo "FAIL: output lacks: $msg" >&2
    cat "$out" >&2
    exit 1
  }
}

reset_tree() {
  if git rev-parse --verify --quiet HEAD >/dev/null; then
    git reset -q --hard HEAD
    git clean -qfd
  fi
}

seed_tree() {
  mkdir -p apps/agent apps/web infra migrations packages/contract \
    workers/catalog workers/users workers/edge docs .github/workflows .github/scripts scripts
  touch \
    apps/agent/a.py apps/web/a.ts apps/web/b.ts infra/i.ts migrations/m.sql \
    packages/contract/c.ts workers/catalog/cat.ts workers/users/u.ts \
    workers/edge/e.ts docs/d.md .github/workflows/w.yml .github/scripts/s.sh scripts/t.sh
}

seed_base() {
  reset_tree
  seed_tree
  git add -A
  if ! git diff --cached --quiet; then
    git commit -qm base
  fi
  git update-ref refs/remotes/origin/main HEAD
}

run_staged() {
  bash "$ROUTER" --staged
}

run_merge_base() {
  bash "$ROUTER"
}

stage_add_modify_rename_delete_untracked() {
  printf 'x' >> apps/agent/a.py
  touch apps/web/new.ts
  git add apps/agent/a.py apps/web/new.ts
  git mv apps/web/a.ts apps/web/renamed.ts
  git rm -q infra/i.ts
  touch docs/untracked.md workers/users/untracked.ts
}

commit_agent_and_users() {
  printf 'x' >> apps/agent/a.py
  printf 'x' >> workers/users/u.ts
  git add apps/agent/a.py workers/users/u.ts
  git commit -qm "agent+users"
}

stage_status_matrix() {
  printf 'x' >> apps/web/b.ts
  touch apps/web/added.ts
  git add apps/web/b.ts apps/web/added.ts
  git rm -q migrations/m.sql
  git mv packages/contract/c.ts packages/contract/moved.ts
}

make_fake_git() {
  local dir real_git
  dir="$(mktemp -d "$TMP/fakegit.XXXXXX")"
  real_git="$(command -v git)"
  printf '#!/usr/bin/env bash\nif [ -n "${GATE_GIT_FAIL:-}" ] && printf "%%s\\n" "$*" | grep -qF -- "$GATE_GIT_FAIL"; then\n  echo "fatal: mocked git failure ($GATE_GIT_FAIL)" >&2\n  exit 128\nfi\nexec %s "$@"\n' "$real_git" > "$dir/git"
  chmod +x "$dir/git"
  printf '%s\n' "$dir"
}
