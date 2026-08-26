#!/usr/bin/env bash
# Materialise a release cohort at a layout that does not depend on how big it is.
#
# `actions/download-artifact` creates a directory per artifact only when more than
# one matches its pattern. A cohort with a single unit therefore landed flat in the
# destination, while `promote-release-unit.sh` reads
# `<dest>/release-<sha>-<unit>/artifact-manifest.json` — a path that then never
# existed. Delivery failed for exactly the pushes that touch one deploy unit, which
# is the common case since CD became affected-only, and was the shape of the change
# that fixed a total staging outage: it merged green and never deployed.
#
# Asking for each unit by name puts a cohort of one and a cohort of five in the same
# tree, so the promotion adapter reads one layout and the size stops mattering.
set -euo pipefail

RUN_ID="${1:-}"
SOURCE_SHA="${2:-}"
UNITS_JSON="${3:-}"
DEST_ROOT="${4:-}"

fail() { # fail <message>
  printf 'download-release-cohort: %s\n' "$1" >&2
  exit 2
}

[ -n "$RUN_ID" ] || fail "run id is required"
[ -n "$SOURCE_SHA" ] || fail "source SHA is required"
[ -n "$UNITS_JSON" ] || fail "units are required"
[ -n "$DEST_ROOT" ] || fail "destination root is required"
[ -n "${GITHUB_REPOSITORY:-}" ] || fail "GITHUB_REPOSITORY is required"

printf '%s' "$RUN_ID" | grep -qE '^[0-9]+$' || fail "invalid run id: $RUN_ID"
printf '%s' "$SOURCE_SHA" | grep -qE '^[0-9a-f]{40}$' || fail "invalid source SHA: $SOURCE_SHA"
jq -e 'type == "array" and length > 0 and all(.[]; type == "string")' <<< "$UNITS_JSON" >/dev/null \
  || fail "units must be a non-empty array of strings"

# A `while read` in a pipeline runs in a subshell, so a failure inside it would not
# leave the loop; read the units into the shell first and let `set -e` do its job.
units="$(jq -r '.[]' <<< "$UNITS_JSON")"
while IFS= read -r unit; do
  [ -n "$unit" ] || continue
  artifact="release-$SOURCE_SHA-$unit"
  dest="$DEST_ROOT/$artifact"
  mkdir -p "$dest"
  gh run download "$RUN_ID" --repo "$GITHUB_REPOSITORY" --name "$artifact" --dir "$dest"
  [ -f "$dest/artifact-manifest.json" ] || fail "$artifact carries no manifest at $dest"
  printf 'download-release-cohort: %s -> %s\n' "$artifact" "$dest"
done <<< "$units"
