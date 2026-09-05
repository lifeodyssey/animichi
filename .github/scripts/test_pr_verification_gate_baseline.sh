#!/usr/bin/env bash
# Behavioural cases for the OpenAPI compatibility baseline the contract gate
# vets against (#1341). On real fixture histories: a document absent from the
# merge base gets an empty baseline; a document that is there is compared
# against the merge base's copy — including when the head retires a route, which
# is the shape the deleted `checkins|shares` exemption fired in; and a merge base
# the object store cannot answer for — root tree, subtree, or the document blob
# — fails the gate instead of degrading to an empty baseline.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="${PR_VERIFICATION_GATE:-$SCRIPT_DIR/pr-verification-gate.sh}"
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

# A merge base that already publishes the documents and a head that changes
# them — the history every case except the brand-new document needs.
make_changed_contract() {
  local root="$1"
  make_fixture "$root"
  write_documents "$root" ping
  commit_all "$root" base
  write_documents "$root" pong
  commit_all "$root" 'change the contract'
}

# Stands in for `node --import tsx .../vet-openapi.ts <baseline> <candidate>` and
# records the baseline the gate resolved, which is what the cases assert on.
make_vet_stub() {
  mkdir -p "$TMP/bin"
  cat > "$TMP/bin/node" <<'STUB'
#!/usr/bin/env bash
cp "$4" "$VET_BASELINE_DIR/$(basename "$4")"
STUB
  chmod +x "$TMP/bin/node"
}

# Loose objects only: a two-commit fixture is never packed, and a packed object
# would make the case vacuous rather than fail, so the move is checked.
hide_object() {
  local root="$1" object="$2" path
  path="$root/.git/objects/${object:0:2}/${object:2}"
  [ -e "$path" ] || { echo "FAIL fixture: $object is not a loose object"; exit 1; }
  mv "$path" "$path.hidden"
}

assert_recorded_baselines() {
  local recorded="$1" expected="$2" complaint="$3" doc
  for doc in "${DOCS[@]}"; do
    [ "$(cat "$recorded/$doc")" = "$expected" ] || { echo "FAIL $complaint ($doc)"; exit 1; }
  done
}

assert_gate_refused() {
  local label="$1" out="$2" recorded="$3" complaint="$4"
  grep -q "$complaint" "$out" ||
    { echo "FAIL unreadable-$label: the gate did not report '$complaint'"; cat "$out"; exit 1; }
  [ ! -e "$recorded/openapi.json" ] ||
    { echo "FAIL unreadable-$label: the vet ran on a baseline the gate could not read"; exit 1; }
}

run_gate() {
  local root="$1" recorded="$2" base head
  base="$(git -C "$root" rev-parse HEAD^)"
  head="$(git -C "$root" rev-parse HEAD)"
  mkdir -p "$recorded"
  PATH="$TMP/bin:$PATH" RUNNER_TEMP="$TMP" \
    VET_BASELINE_DIR="$recorded" \
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
  run_gate "$root" "$recorded" > "$TMP/new-document.out" 2>&1 ||
    { echo "FAIL absent-at-base: the gate rejected a brand-new document"; cat "$TMP/new-document.out"; exit 1; }
  assert_recorded_baselines "$recorded" "$EMPTY_BASELINE" \
    'absent-at-base: a brand-new document was not vetted against an empty baseline'
}

published_document_case() {
  local root="$TMP/published" recorded="$TMP/published-baselines"
  make_changed_contract "$root"
  run_gate "$root" "$recorded" > "$TMP/published.out" 2>&1 ||
    { echo "FAIL published-document: the gate rejected a routine contract change"; cat "$TMP/published.out"; exit 1; }
  assert_recorded_baselines "$recorded" "$(document_text ping)" \
    "published-document: the baseline was not the merge base's copy"
}

# The deleted exemption's own trigger shape (#1341): a merge base that publishes
# a route the head has retired is exactly when the old `checkins|shares` carve-out
# swapped the baseline for the head's document and compared it with itself. The
# route removal here is the one the exemption was written for.
retired_route_case() {
  local root="$TMP/retired-route" recorded="$TMP/retired-route-baselines"
  make_fixture "$root"
  write_documents "$root" users/checkins
  commit_all "$root" base
  write_documents "$root" users/saved-routes
  commit_all "$root" 'retire the check-in surface'
  run_gate "$root" "$recorded" > "$TMP/retired-route.out" 2>&1 ||
    { echo "FAIL retired-route: the gate rejected a route removal"; cat "$TMP/retired-route.out"; exit 1; }
  assert_recorded_baselines "$recorded" "$(document_text users/checkins)" \
    'retired-route: a retired route was vetted against the head, not the merge base'
}

# Every object the baseline read walks. Hiding any one of them is "the
# repository cannot answer", never "the merge base has no such document".
unreadable_object_case() {
  local label="$1" object_rev="$2" complaint="$3" root recorded
  root="$TMP/unreadable-$label"; recorded="$TMP/unreadable-$label-baselines"
  make_changed_contract "$root"
  hide_object "$root" "$(git -C "$root" rev-parse "$object_rev")"
  if run_gate "$root" "$recorded" > "$TMP/unreadable-$label.out" 2>&1; then
    echo "FAIL unreadable-$label: an unreadable $label passed the gate"; exit 1
  fi
  assert_gate_refused "$label" "$TMP/unreadable-$label.out" "$recorded" "$complaint"
}

make_vet_stub
new_document_case
published_document_case
retired_route_case
unreadable_object_case root-tree 'HEAD^^{tree}' 'cannot read the merge base tree'
unreadable_object_case subtree 'HEAD^:packages/contract' 'cannot read the merge base tree'
unreadable_object_case blob 'HEAD^:packages/contract/openapi.json' 'cannot read openapi.json from merge base'
echo "PR Verification compat baseline: absent is empty, the merge base's copy is the baseline (retired routes included), an unanswerable merge base is red"
