#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
SCRIPT="$ROOT/.github/scripts/resolve-cd-base.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/cd-base.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
SOURCE="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
BEFORE="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
OLDER="cccccccccccccccccccccccccccccccccccccccc"
NEWER="dddddddddddddddddddddddddddddddddddddddd"
ROOT_SHA="eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

cat > "$TMP/gh" <<'SH'
#!/usr/bin/env bash
case "$*" in
  *git/ref/heads/main*) printf '%s\n' "${MOCK_MAIN:?}" ;;
  *actions/workflows/cd.yml/runs*) printf '%s\n' "${MOCK_RUNS:-}" ;;
  *) exit 2 ;;
esac
SH
chmod +x "$TMP/gh"

cat > "$TMP/git" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [ "$1 $2" = "merge-base --is-ancestor" ]; then
  grep -Fxq "$3" <<< "${MOCK_ANCESTORS:-}"
  exit
fi
if [ "$1 $2" = "rev-list --max-parents=0" ]; then
  printf '%s\n' "${MOCK_ROOT:?}"
  exit
fi
exit 2
SH
chmod +x "$TMP/git"

resolved="$(PATH="$TMP:$PATH" GITHUB_REPOSITORY=owner/repo MOCK_MAIN="$SOURCE" MOCK_ANCESTORS="$OLDER" MOCK_ROOT="$ROOT_SHA" MOCK_RUNS="$SOURCE
$OLDER" bash "$SCRIPT" "$BEFORE" "$SOURCE")"
[ "$resolved" = "$OLDER" ] || { echo "expected durable successful base" >&2; exit 1; }
resolved="$(PATH="$TMP:$PATH" GITHUB_REPOSITORY=owner/repo MOCK_MAIN="$SOURCE" MOCK_ANCESTORS="$BEFORE" MOCK_ROOT="$ROOT_SHA" MOCK_RUNS='' bash "$SCRIPT" "$BEFORE" "$SOURCE")"
[ "$resolved" = "$BEFORE" ] || { echo "expected event fallback" >&2; exit 1; }
resolved="$(PATH="$TMP:$PATH" GITHUB_REPOSITORY=owner/repo MOCK_MAIN="$SOURCE" MOCK_ANCESTORS="$BEFORE" MOCK_ROOT="$ROOT_SHA" MOCK_RUNS="$NEWER" bash "$SCRIPT" "$BEFORE" "$SOURCE")"
[ "$resolved" = "$BEFORE" ] || { echo "expected non-ancestor successful run to be ignored" >&2; exit 1; }
resolved="$(PATH="$TMP:$PATH" GITHUB_REPOSITORY=owner/repo MOCK_MAIN="$SOURCE" MOCK_ANCESTORS='' MOCK_ROOT="$ROOT_SHA" MOCK_RUNS="$NEWER" bash "$SCRIPT" "$BEFORE" "$SOURCE")"
[ "$resolved" = "$ROOT_SHA" ] || { echo "expected source root fallback" >&2; exit 1; }
if PATH="$TMP:$PATH" GITHUB_REPOSITORY=owner/repo MOCK_MAIN="$NEWER" MOCK_ROOT="$ROOT_SHA" bash "$SCRIPT" "$BEFORE" "$SOURCE"; then
  echo "stale CD rerun must fail closed" >&2
  exit 1
fi
echo "CD base resolver: cumulative range is ancestral and stale reruns fail closed"
