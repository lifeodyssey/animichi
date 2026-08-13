#!/usr/bin/env bash
set -euo pipefail

# Integration tests for the build-once promotion flow (#1007).
#
# Covers:
#   AC2 - a build is reproducible enough to verify its digest and one
#         immutable CI artifact is uploaded for promotion.
#   AC3 - staging consumes and reports the manifest digest; post-deploy
#         evidence reads the platform deployed version metadata.
#   AC4 - production promotion rejects a rebuild, mismatched digest, stale
#         staging evidence, incompatible schema, or changed dependency
#         manifest.
#
# Run: bash scripts/local-gates/promotion-manifest-e2e.test.sh

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DRIVER="$REPO_ROOT/scripts/local-gates/promotion-manifest-e2e.sh"

drv() { bash "$DRIVER" "$@"; }

FAIL_COUNT=0
fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1)); echo "FAIL: $1" >&2;
}

A="$(mktemp -d)"
B="$(mktemp -d)"
C="$(mktemp -d)"
S="$(mktemp -d)"
P="$(mktemp -d)"
R="$(mktemp -d)"
W="$(mktemp -d)"
E="$(mktemp -d)"
trap 'rm -rf "$A" "$B" "$C" "$S" "$P" "$R" "$W" "$E"' EXIT

SHA999="9999999999999999999999999999999999999999"
SHA111="1111111111111111111111111111111111111111"
SHA888="8888888888888888888888888888888888888888"
SHA000="0000000000000000000000000000000000000000"
BAD="ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

echo "== AC2: reproducible build + one immutable artifact =="

drv build "$A" web v1
drv build "$B" web v1
drv build "$C" web v1-new
DA="$(drv digest "$A" web)"
DB="$(drv digest "$B" web)"
DC="$(drv digest "$C" web)"
[ -n "$DA" ] && [ "$DA" = "$DB" ] || fail "AC2: deterministic build must yield the same digest"
[ "$DA" != "$DC" ] || fail "AC2: a changed build must change the digest"
echo "  PASS: deterministic build -> identical digest; changed build -> different digest"

drv upload "$A" web "$DA"
drv upload "$A" web "$DA"
echo "  PASS: one immutable artifact uploaded by digest (idempotent)"

echo "== AC3: staging consumes + reports the manifest digest =="

drv build "$S" web v1
DIGEST_S="$(drv digest "$S" web)"
drv gendoc "$S" web "$SHA999" "$SHA888" > "$S/manifest.json"
drv stage "$S" web "$S/manifest.json"
DEPLOYED="$(drv version "$S" web)"
[ -n "$DEPLOYED" ] && [ "$DEPLOYED" = "$DIGEST_S" ] || fail "AC3: post-deploy evidence must read the deployed digest"
echo "  PASS: staging reports the manifest digest; post-deploy reads the deployed version"

echo "== AC4: production promotion rejection matrix =="

# Baseline: approved promotion passes.
drv build "$P" web v1
DIGEST_P="$(drv digest "$P" web)"
drv upload "$P" web "$DIGEST_P"
drv gendoc "$P" web "$SHA999" "$SHA888" > "$P/manifest.json"
drv stage "$P" web "$P/manifest.json"
if ! drv approve "$P" web "$P/manifest.json" "$SHA999" "$DIGEST_P" >/dev/null 2>&1; then
  fail "AC4 baseline: approved promotion must pass"
fi
echo "  PASS: approved promotion is approved"

# 1) Rebuild: compiler rebuilt a different artifact (v1-new); the approved
#    digest no longer matches the built artifact digest.
drv build "$R" web v1-new
if drv approve "$R" web "$P/manifest.json" "$SHA999" "$DIGEST_P" >/dev/null 2>&1; then
  fail "AC4: production must reject a rebuild (digest mismatch)"
fi
echo "  PASS: rejects a rebuild (approved digest vs recompiled artifact)"

# 2) Mismatched approved digest.
drv build "$W" web v1
if drv approve "$W" web "$P/manifest.json" "$SHA999" "$BAD" >/dev/null 2>&1; then
  fail "AC4: production must reject a mismatched approved digest"
fi
echo "  PASS: rejects mismatched approved digest"

# 3) Stale/missing staging evidence (no evidence file for this component).
drv build "$A" web v1
DA2="$(drv digest "$A" web)"
if drv approve "$A" web "$P/manifest.json" "$SHA999" "$DA2" >/dev/null 2>&1; then
  fail "AC4: production must reject stale/missing staging evidence"
fi
echo "  PASS: rejects stale/missing staging evidence"

# 4) Incompatible schema/source: approved source differs from manifest.
drv gendoc "$S" web "$SHA111" "$SHA888" > "$S/manifest2.json"
if drv approve "$S" web "$S/manifest2.json" "$SHA999" "$DIGEST_S" >/dev/null 2>&1; then
  fail "AC4: production must reject an incompatible schema/source change"
fi
echo "  PASS: rejects incompatible schema/source change"

# 5) Changed dependency manifest: the approval verify expects catalog@SHA888,
#    but the manifest pins a different dependency revision.
drv build "$E" web v1
DIGEST_E="$(drv digest "$E" web)"
drv gendoc "$E" web "$SHA999" "$SHA000" > "$E/manifest.json"
drv stage "$E" web "$E/manifest.json"
drv upload "$E" web "$DIGEST_E"
if drv approve "$E" web "$E/manifest.json" "$SHA999" "$DIGEST_E" >/dev/null 2>&1; then
  fail "AC4: production must reject a changed dependency manifest"
fi
echo "  PASS: rejects changed dependency manifest"

if [ "$FAIL_COUNT" -ne 0 ]; then
  echo "FAILED: $FAIL_COUNT promotion-manifest e2e assertion(s)" >&2
  exit 1
fi
echo "All promotion-manifest e2e behavioral tests passed."
