#!/usr/bin/env bash
# The pre-push gate (#1371). git names the changed files, `pnpm ls` names the
# project directories, and the routing table below names each project's
# buckets: pnpm's own `[<ref>]` selector answers nothing from a worktree nested
# inside the repo (pnpm/pnpm#12626). Table, buckets, whitelist, rationale:
# docs/ops/local-gates.md.
set -euo pipefail
unset "${!GIT_@}"
cd "$(git rev-parse --show-toplevel)"

# Root analyzer configs (`codecov.yml`, `.codacy.yml`, `.sonarcloud.properties`)
# name CI-side scanners with no local gate; `supabase/` is the archived
# historical migration dir (#1000), not a live surface.
NO_PACKAGE='^(docs/|\.claude/|\.github/|\.semgrep|scripts/|test/repo-config/|codecov\.yml$|\.codacy\.yml$|\.sonarcloud\.properties$|supabase/|\.pre-commit-config\.yaml$|commitlint\.config\.js$|Makefile$|\.gitignore$|[^/]+\.md$)'
ROOT_MANIFEST='^(pnpm-lock\.yaml|package\.json|pnpm-workspace\.yaml|\.npmrc)$'
# The spec-reference gate reads these three files, so a change to them has to
# run the docs bucket even though `scripts/**` needs no package.
SPEC_REFERENCES='^scripts/local-gates/(check-spec-references(\.test)?\.sh|spec-reference-exceptions\.txt)$'
# An agent-context document is a documentation change wherever it lives; the
# nested ones a workspace package owns are covered, `migrations/AGENTS.md` is not.
AGENT_CONTEXT='^(.*/)?(AGENTS|CLAUDE|CONTEXT)\.md$'
# The routing table: one row per workspace package, `<directory> <bucket>...`.
# `package` runs the package's own four scripts. A
# workspace package with no row stops the push here — a package that leaves the
# table stops being gated while everything else stays green (#1687), so the
# table's domain is pinned against `pnpm-workspace.yaml` by
# `test/repo-config/pre-push-routing.test.rb`. Bucket rationale:
# docs/ops/local-gates.md.
ROUTES='
apps/web package
e2e package
infra package
packages/agent package
packages/contract package
packages/eval package
packages/pi-session-neon package
packages/prisma-geography package
packages/test-postgres package
workers/catalog package
workers/edge package
workers/migrator package
workers/users package
'
ZERO=0000000000000000000000000000000000000000

# The buckets a package directory's row names; empty when it has no row.
route_for() { awk -v dir="$1" '$1 == dir { sub(/^[^ ]+ +/, ""); print; exit }' <<<"$ROUTES"; }
# Whether a row's bucket list names a bucket exactly.
has_bucket() { case " $1 " in *" $2 "*) return 0 ;; *) return 1 ;; esac; }

# What is gated is HEAD's diff, and the pushed refs are read to prove that is
# the right thing to gate. git feeds the hook one
# `<local ref> <local sha> <remote ref> <remote sha>` record per ref; pre-commit's
# wrapper eats that stdin and re-exports the first pushable one as
# PRE_COMMIT_{TO,FROM}_REF, so read stdin when there is any and fall back to the
# variables (`[ -t 0 ]` keeps a by-hand terminal run from blocking on a read that
# never arrives). Pushing a ref that is not HEAD is refused rather than gated:
# the paths would come from that ref while `pnpm ls` and every package script ran
# against the checked-out tree, so a broken change could pass on someone else's
# green. This repository is one worktree per card, so the rule costs nothing.
head_sha="$(git rev-parse HEAD)"
base="$(git merge-base origin/main HEAD)"
records=""
[ -t 0 ] || records="$(cat)"
[ -n "$records" ] || records="PRE_COMMIT_TO_REF ${PRE_COMMIT_TO_REF:-$head_sha} _ ${PRE_COMMIT_FROM_REF:-$ZERO}"
while read -r local_ref local_sha _ remote_sha; do
  { [ -n "$local_sha" ] && [ "$local_sha" != "$ZERO" ]; } || continue  # a deletion pushes no content
  [ "$local_sha" = "$head_sha" ] || { printf 'pre-push: refs must be pushed from their own worktree (HEAD is %s, pushing %s@%s)\n' "$head_sha" "$local_ref" "$local_sha" >&2; exit 1; }
  # A remote sha already in this history is the tighter base: only what is new.
  ! git merge-base --is-ancestor "${remote_sha:-$ZERO}" HEAD 2>/dev/null || base="$remote_sha"
done <<<"$records"

# A message CI's `commits` job rejects must not leave the laptop, so the message
# check runs here — before any package gate — over exactly the commits this push
# adds (#1467). That is the same narrowed `base` the diff uses: the merge base on
# a first push (a new branch's remote sha arrives as zero), the remote sha once
# it is an ancestor of HEAD. commitlint's history mode names no sha, so a
# rejected range is replayed one commit at a time to report which messages it
# rejected. An empty range (the remote already has HEAD) is skipped rather than
# failed: `--from X --to X` is a commitlint usage error (exit 9), not a pass.
# Anything but 0 or 1 means commitlint never ran — an uninstalled workspace exits
# 254 — and that fails closed with no attribution.
lint_pushed_commits() {
  [ "$base" != "$head_sha" ] || return 0
  local status=0 sha
  pnpm exec commitlint --from "$base" --to HEAD || status=$?
  [ "$status" = 1 ] || return "$status"
  while read -r sha; do
    pnpm exec commitlint --from "$sha^" --to "$sha" >/dev/null 2>&1 ||
      printf 'pre-push: commitlint rejected %s\n' "$(git log -1 --format='%h %s' "$sha")" >&2
  done < <(git rev-list --reverse "$base"..HEAD)
  return 1
}
lint_pushed_commits || exit 1

changed="$(git diff --name-only --no-renames "$base"...HEAD)"
[ -n "$changed" ] || exit 0
# A path the diff deletes has nothing left to gate; what remains is gated by the
# surviving packages and the repo contracts, which already run.
deleted="$(git diff --name-only --diff-filter=D --no-renames "$base"...HEAD)"

deps=$(grep -cE "$ROOT_MANIFEST" <<<"$changed" || true)
projects="$(pnpm ls -r --depth -1 --json | jq -r --arg root "$PWD/" '
  .[] | select(.name != "animichi-cloudflare-worker")
      | "\(.path | ltrimstr($root))/ \(.name)"')"
# Selection by row: `package` runs the package's own scripts.
packages=""; covered="$NO_PACKAGE"
while read -r dir name; do
  [ -n "$dir" ] || continue  # an empty $projects still yields one blank line
  # pnpm prints the directory with a trailing slash; the table names it bare.
  buckets="$(route_for "${dir%/}")"
  [ -n "$buckets" ] || { printf 'pre-push: %s is a workspace package with no routing row\n' "${dir%/}" >&2; exit 1; }
  if grep -q "^$dir" <<<"$changed"; then
    covered="$covered|^$dir"
  fi
  if [ "$deps" != 0 ] || grep -q "^$dir" <<<"$changed"; then
    if has_bucket "$buckets" package; then packages="$packages $name"; fi
  fi
done <<<"$projects"
schema=$(grep -cE '^packages/pi-session-neon/migrations/' <<<"$changed" || true)
docs=$(grep -cE "^(docs/|\.claude/|[^/]+\.md$)|$SPEC_REFERENCES|$AGENT_CONTEXT" <<<"$changed" || true)
printf 'pre-push: packages:%s | schema=%s deps=%s docs=%s\n' "${packages:- (none)}" "$schema" "$deps" "$docs"

# Every surviving changed path must be owned by a selected package, a bucket
# that fired or the whitelist. Checked over the whole diff, so a mixed one
# cannot carry an unowned path through on the strength of its other half. A
# deleted path is covered by definition — `pnpm ls` answers from the surviving
# tree, so a deleted package could never cover its own deleted files (#1607) —
# and is waived here only: above, deletions still select packages and buckets.
[ "$deps" = 0 ] || covered="$covered|$ROOT_MANIFEST"
[ "$schema" = 0 ] || covered="$covered|^packages/pi-session-neon/migrations/"
[ "$docs" = 0 ] || covered="$covered|$AGENT_CONTEXT"
surviving="$changed"
[ -z "$deleted" ] || surviving="$(grep -vxF -f <(printf '%s\n' "$deleted") <<<"$changed" || true)"
loose="$(grep -vE "$covered" <<<"$surviving" || true)"
[ -z "$loose" ] || { printf 'pre-push: no gate covers:\n%s\n' "$loose" >&2; exit 1; }
closure="..."; [ "$deps" = 0 ] || closure=""  # every package is already selected
for name in $packages; do
  for script in lint typecheck test test:integration; do
    pnpm -r --workspace-concurrency=1 --filter "$closure$name" run --if-present "$script"
  done
done
[ "$schema" = 0 ] || pnpm --filter @animichi/pi-session-neon exec prisma migration check
[ "$docs" = 0 ] || for c in agents-refs docs-paths root-allowlist spec-references; do bash "scripts/local-gates/check-$c.sh"; done
