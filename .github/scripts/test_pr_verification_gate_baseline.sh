#!/usr/bin/env bash
# Behavioural cases for the OpenAPI compatibility baseline the contract gate
# vets against (#1341). Three facts, on a real fixture history: a document
# absent from the merge base gets an empty baseline, a document that is there
# but unreadable fails the gate, and a document that is there is compared
# against the merge base's copy — never against the head's own document.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="${PR_VERIFICATION_GATE:-$SCRIPT_DIR/pr-verification-gate.sh}"
REAL_GIT="$(command -v git)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/pr-verification-baseline.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# git hands a hook GIT_DIR and its siblings; an inherited one beats `git -C` and
# every fixture commit below would then write the real repository's index.
unset "${!GIT_@}"

DOCS=(openapi.json users-openapi.json agent-openapi.json)
EMPTY_BASELINE='{
  "paths": {}
}'

document_text() {
  printf '{"paths":{"/v1/%s":{"get":{"responses":{"200":{"description":"ok"}}}}}}\n' "$1"
}

write_documents() {
  local root="$1" route="$2" doc
  mkdir -p "$root/packages/contract"
  for doc in "${DOCS[@]}"; do document_text "$route" > "$root/packages/contract/$doc"; done
}

commit_all() {
  local root="$1" message="$2"
  git -C "$root" add -A
  git -C "$root" commit -qm "$message"
}

# The dispatcher sources the local-gates orchestrator for `gate_<package>`; this
# fixture is about the compatibility baseline, so the package gate is a no-op.
make_fixture() {
  local root="$1"
  mkdir -p "$root/.github/scripts" "$root/scripts/local-gates"
  cp "$GATE" "$root/.github/scripts/pr-verification-gate.sh"
  printf 'gate_contract() { :; }\n' > "$root/scripts/local-gates/pre-push.sh"
  git -C "$root" init -q
  git -C "$root" config user.name test
  git -C "$root" config user.email test@example.com
}

make_stubs() {
  mkdir -p "$TMP/bin"
  cat > "$TMP/bin/node" <<'STUB'
#!/usr/bin/env bash
# Stands in for `node --import tsx .../vet-openapi.ts <baseline> <candidate>`
# and records the baseline the gate resolved, which is what the cases assert on.
cp "$4" "$VET_BASELINE_DIR/$(basename "$4")"
STUB
  cat > "$TMP/bin/git" <<'STUB'
#!/usr/bin/env bash
# Real git, except for the one read a case asks to break: `git show
# <rev>:packages/contract/$BREAK_GIT_SHOW_DOC`. The history stays real, so the
# merge base the gate resolves is the real one.
if [ -n "${BREAK_GIT_SHOW_DOC:-}" ] && [ "$1" = show ] &&
  [ "${2##*:}" = "packages/contract/$BREAK_GIT_SHOW_DOC" ]; then
  echo "fatal: unable to read blob" >&2
  exit 128
fi
exec "$REAL_GIT" "$@"
STUB
  chmod +x "$TMP/bin/node" "$TMP/bin/git"
}

assert_recorded_baselines() {
  local recorded="$1" expected="$2" complaint="$3" doc
  for doc in "${DOCS[@]}"; do
    [ "$(cat "$recorded/$doc")" = "$expected" ] || { echo "FAIL $complaint ($doc)"; exit 1; }
  done
}

run_gate() {
  local root="$1" recorded="$2" break_doc="$3" base head
  base="$(git -C "$root" rev-parse HEAD^)"
  head="$(git -C "$root" rev-parse HEAD)"
  mkdir -p "$recorded"
  PATH="$TMP/bin:$PATH" REAL_GIT="$REAL_GIT" RUNNER_TEMP="$TMP" \
    VET_BASELINE_DIR="$recorded" BREAK_GIT_SHOW_DOC="$break_doc" \
    PR_VERIFICATION_BASE_SHA="$base" PR_VERIFICATION_SOURCE_HEAD_SHA="$head" \
    PR_VERIFICATION_CHECKOUT_SHA="$head" \
    bash "$root/.github/scripts/pr-verification-gate.sh" contract
}

new_document_case() {
  local root="$TMP/new-document" recorded="$TMP/new-document-baselines"
  make_fixture "$root"
  commit_all "$root" base
  write_documents "$root" ping
  commit_all "$root" 'publish the contract'
  run_gate "$root" "$recorded" "" > "$TMP/new-document.out" 2>&1 ||
    { echo "FAIL absent-at-base: the gate rejected a brand-new document"; cat "$TMP/new-document.out"; exit 1; }
  assert_recorded_baselines "$recorded" "$EMPTY_BASELINE" \
    'absent-at-base: a brand-new document was not vetted against an empty baseline'
}

unreadable_document_case() {
  local root="$TMP/unreadable" recorded="$TMP/unreadable-baselines"
  make_fixture "$root"
  write_documents "$root" ping
  commit_all "$root" base
  write_documents "$root" pong
  commit_all "$root" 'change the contract'
  if run_gate "$root" "$recorded" openapi.json > "$TMP/unreadable.out" 2>&1; then
    echo "FAIL unreadable-baseline: an unreadable merge-base document passed the gate"; exit 1
  fi
  grep -q 'cannot read openapi.json from merge base' "$TMP/unreadable.out" ||
    { echo "FAIL unreadable-baseline: the gate did not name the document it could not read"; cat "$TMP/unreadable.out"; exit 1; }
  [ ! -e "$recorded/openapi.json" ] ||
    { echo "FAIL unreadable-baseline: the vet ran on a baseline the gate could not read"; exit 1; }
}

published_document_case() {
  local root="$TMP/published" recorded="$TMP/published-baselines"
  make_fixture "$root"
  write_documents "$root" ping
  commit_all "$root" base
  write_documents "$root" pong
  commit_all "$root" 'change the contract'
  run_gate "$root" "$recorded" "" > "$TMP/published.out" 2>&1 ||
    { echo "FAIL published-document: the gate rejected a routine contract change"; cat "$TMP/published.out"; exit 1; }
  assert_recorded_baselines "$recorded" "$(document_text ping)" \
    "published-document: the baseline was not the merge base's copy"
}

make_stubs
new_document_case
unreadable_document_case
published_document_case
echo "PR Verification compat baseline: absent is empty, unreadable is red, published is the merge base's copy"
