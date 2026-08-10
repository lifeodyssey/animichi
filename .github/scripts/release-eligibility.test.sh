#!/usr/bin/env bash
set -euo pipefail

# Behavioral tests for release-eligibility.sh (SAFE-1 Phase B2), run against
# throwaway manifest copies in the local-file test path (no GitHub API, no
# network). The gh-api path is exercised by the workflows themselves in CI.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/.github/scripts/release-eligibility.sh"
MANIFEST="$ROOT/.github/release-manifests/production-pre-campaign.json"
PINNED_REVISION="b94c30ab6a519f1cce9eb0a3f7885953f8ff54cf"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

# Green: matching candidate → deploy eligible, rollback ineligible, typed fields.
verdict="$(bash "$SCRIPT" root "$PINNED_REVISION" "$MANIFEST")"
echo "$verdict" | grep -q '"deploy":true' || fail "matching revision must be deploy eligible"
echo "$verdict" | grep -q '"rollback":false' || fail "rollback must be ineligible"
test "$(echo "$verdict" | python3 -c 'import json,sys; print(json.load(sys.stdin)["component"]["worker_name"])')" = "animichi" || fail "verdict must carry the resolved worker name"
echo "PASS: matching revision is deploy-eligible"

# Green: stale candidate → deploy ineligible, still exit 0.
verdict="$(bash "$SCRIPT" root "0000000000000000000000000000000000000000" "$MANIFEST")"
echo "$verdict" | grep -q '"deploy":false' || fail "stale revision must be deploy ineligible"
echo "PASS: stale revision is deploy-ineligible"

# Red: tampered manifest copy must fail (pinned identity).
cp "$MANIFEST" "$TMP/tampered.json"
python3 - "$TMP/tampered.json" <<'EOF'
import json, sys
p = sys.argv[1]
m = json.load(open(p))
m["atlas"]["target"] = "20260909000000"
json.dump(m, open(p, "w"))
EOF
if bash "$SCRIPT" root "$PINNED_REVISION" "$TMP/tampered.json" >/dev/null 2>&1; then
  fail "tampered manifest must fail closed"
fi
echo "PASS: tampered manifest fails closed"

# Red: unknown component must fail.
if bash "$SCRIPT" sidecar "$PINNED_REVISION" "$MANIFEST" >/dev/null 2>&1; then
  fail "unknown component must fail"
fi
echo "PASS: unknown component fails closed"

# Red: missing manifest file must fail.
if bash "$SCRIPT" root "$PINNED_REVISION" "$TMP/does-not-exist.json" >/dev/null 2>&1; then
  fail "missing manifest must fail"
fi
echo "PASS: missing manifest fails closed"

# Red: missing args must fail.
if bash "$SCRIPT" root >/dev/null 2>&1; then
  fail "missing args must fail"
fi
echo "PASS: missing args fail closed"

echo "All release-eligibility.sh behavioral tests passed."
