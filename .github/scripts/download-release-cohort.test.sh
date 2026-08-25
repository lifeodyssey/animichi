#!/usr/bin/env bash
# The cohort layout must not depend on how many units the cohort has. A `gh` stub
# stands in for the artifact API so the shape is asserted without a network.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/.github/scripts/download-release-cohort.sh"
SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
mkdir -p "$TMP/bin"
cat > "$TMP/bin/gh" <<'STUB'
#!/usr/bin/env bash
# `gh run download --name <artifact> --dir <dest>`: write the manifest the promotion
# adapter reads, unless the artifact is the one this case wants to come back empty.
set -euo pipefail
dir=""; name=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dir) dir="$2"; shift 2 ;;
    --name) name="$2"; shift 2 ;;
    *) shift ;;
  esac
done
[ "$name" = "${MOCK_EMPTY_ARTIFACT:-}" ] && exit 0
mkdir -p "$dir"
printf '{"unit":"%s"}\n' "${name##*-}" > "$dir/artifact-manifest.json"
STUB
chmod +x "$TMP/bin/gh"

run() { # run <label> <want-exit> <units-json> <dest> [env...]
  local label="$1" want="$2" units="$3" dest="$4"; shift 4
  local rc
  env "$@" GITHUB_REPOSITORY=owner/repo PATH="$TMP/bin:$PATH" \
    bash "$SCRIPT" 99 "$SHA" "$units" "$dest" >/dev/null 2>&1 && rc=0 || rc=$?
  if [ "$rc" -eq "$want" ]; then
    printf 'PASS %-52s exit=%s\n' "$label" "$rc"
  else
    fail=$((fail + 1)); printf 'FAIL %-52s want=%s got=%s\n' "$label" "$want" "$rc"
  fi
}

expect_manifest() { # expect_manifest <label> <path>
  if [ -f "$2" ]; then
    printf 'PASS %-52s\n' "$1"
  else
    fail=$((fail + 1)); printf 'FAIL %-52s missing %s\n' "$1" "$2"
  fi
}

echo "=== a cohort of one gets the same tree as a cohort of five ==="
run "single-unit cohort downloads" 0 '["web"]' "$TMP/one"
expect_manifest "single unit lands under its own directory" "$TMP/one/release-$SHA-web/artifact-manifest.json"

run "five-unit cohort downloads" 0 '["agent","db","edge","migrator","web"]' "$TMP/five"
for unit in agent db edge migrator web; do
  expect_manifest "five-unit cohort keeps $unit separate" "$TMP/five/release-$SHA-$unit/artifact-manifest.json"
done

echo
echo "=== inputs the delivery path must refuse ==="
run "empty unit list fails closed" 2 '[]' "$TMP/empty"
run "non-array units fail closed" 2 '"web"' "$TMP/scalar"
run "an artifact without a manifest fails closed" 2 '["web"]' "$TMP/nomanifest" \
  MOCK_EMPTY_ARTIFACT="release-$SHA-web"

badsha_rc=0
env GITHUB_REPOSITORY=owner/repo PATH="$TMP/bin:$PATH" \
  bash "$SCRIPT" 99 not-a-sha '["web"]' "$TMP/badsha" >/dev/null 2>&1 || badsha_rc=$?
if [ "$badsha_rc" -eq 2 ]; then
  printf 'PASS %-52s exit=2\n' "a malformed source SHA fails closed"
else
  fail=$((fail + 1)); printf 'FAIL %-52s want=2 got=%s\n' "a malformed source SHA fails closed" "$badsha_rc"
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "All download-release-cohort tests passed."
else
  echo "$fail download-release-cohort test(s) failed." >&2
  exit 1
fi
