#!/usr/bin/env bash
# Build-once promotion flow driver (#1007, AC2/AC3/AC4).
#
# A single, deterministic CLI that drives the build-once promotion path with a
# throwaway artifact store, so a test can run each stage as a separate process
# without sharing shell state:
#   build   <workdir> <component> <label>           deterministic artifact build
#   digest  <workdir> <component>                   print the artifact SHA-256
#   upload  <workdir> <component> <digest>          store one immutable artifact
#   gendoc  <workdir> <component> <source> <deprev> generate a valid manifest
#   stage   <workdir> <component> <manifest>        consume + report staging evidence
#   version <workdir> <component>                   post-deploy deployed version
#   approve <workdir> <component> <manifest> <source> <digest>
#                                                    production eligibility gate
#
# Behavioral tests: promotion-manifest-e2e.test.sh.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PM_CLI="$REPO_ROOT/.github/scripts/promotion-manifest-cli.py"
SHA888="8888888888888888888888888888888888888888"
D64="2555555555555555555555555555555555555555555555555555555555555555"

fail() {
  echo "promotion-manifest-e2e.sh: $1" >&2
  exit 1
}

cmd_build() {
  local dir="$1" component="$2" label="$3"
  mkdir -p "$dir/src-$component"
  printf '%s\n' "$label" > "$dir/src-$component/version.txt"
  # Deterministic artifact: every archived entry's mtime is pinned (file AND
  # the archived "." directory row) and gzip -n omits the name/timestamp from
  # the gzip header, so identical labels produce identical bytes/digest.
  touch -t 202501010000 "$dir/src-$component/version.txt"
  touch -t 202501010000 "$dir/src-$component"
  tar -C "$dir/src-$component" -cf - . | gzip -n > "$dir/$component.tar.gz"
}

cmd_digest() {
  local dir="$1" component="$2"
  python3 "$PM_CLI" digest "$dir/$component.tar.gz"
}

cmd_upload() {
  local dir="$1" component="$2" digest="$3"
  local key="$dir/store/$digest.tar.gz"
  mkdir -p "$dir/store"
  # The source artifact must actually hash to the requested digest before the
  # store key is examined or written — a lying caller must fail closed.
  [[ "$(shasum -a 256 "$dir/$component.tar.gz" | awk '{print $1}')" = "$digest" ]] \
    || fail "source artifact digest mismatch"
  if [[ -f "$key" ]]; then
    [[ "$(shasum -a 256 "$key" | awk '{print $1}')" = "$digest" ]] \
      || fail "immutable store collision at digest $digest"
    return 0
  fi
  cp "$dir/$component.tar.gz" "$key"
}

cmd_gendoc() {
  local dir="$1" component="$2" source="$3" deprev="$4"
  python3 "$PM_CLI" generate --component "$component" --source-sha "$source" \
    --artifact "$dir/$component.tar.gz" \
    --sbom-format cyclonedx-1.5 --sbom-digest "$D64" \
    --schema-provider atlas --schema-head 20260811000002 --schema-digest "$D64" \
    --config-version 1 --config-commit abcdefabcdefabcdefabcdefabcdefabcdefabcd \
    --dep "catalog=$deprev"
}

cmd_stage() {
  local dir="$1" component="$2" manifest="$3"
  mkdir -p "$dir/evidence"
  python3 - "$component" "$manifest" "$dir" <<'PY'
import json
import os
import sys

component, path, workdir = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, encoding="utf-8") as handle:
    manifest = json.load(handle)
ev = {
    "component": component,
    "source_sha": manifest["source_sha"],
    "artifact_digest": manifest["artifact_digest"],
    "config_schema_version": manifest["config_schema"]["version"],
    "schema_migration_head": manifest["schema_compatibility"]["migration_head"],
}
out = os.path.join(workdir, "evidence", component + "-staging.json")
with open(out, "w", encoding="utf-8") as handle:
    json.dump(ev, handle, sort_keys=True)
PY
}

cmd_version() {
  local dir="$1" component="$2"
  python3 - "$component" "$dir" <<'PY'
import json
import os
import sys

component, workdir = sys.argv[1], sys.argv[2]
path = os.path.join(workdir, "evidence", component + "-staging.json")
with open(path, encoding="utf-8") as handle:
    ev = json.load(handle)
print(ev["artifact_digest"])
PY
}

cmd_approve() {
  local dir="$1" component="$2" manifest="$3" source="$4" digest="$5" manifest_source
  [[ "$(cmd_digest "$dir" "$component")" = "$digest" ]] \
    || fail "rebuild detected: artifact digest differs from approved $digest"
  [[ -f "$dir/evidence/$component-staging.json" ]] \
    || fail "stale/missing staging evidence"
  [[ "$(cmd_version "$dir" "$component")" = "$digest" ]] \
    || fail "deployed version differs from approved $digest"
  manifest_source="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["source_sha"])' "$manifest")"
  [[ "$manifest_source" = "$source" ]] \
    || fail "schema/source mismatch: manifest $manifest_source != approved $source"
  printf '{"component":"%s","source_sha":"%s","artifact_digest":"%s","dependencies":{"catalog":{"revision":"%s"}}}\n' \
    "$component" "$source" "$digest" "$SHA888" > "$dir/expected.json"
  python3 "$PM_CLI" verify "$manifest" --expected "$dir/expected.json" \
    || fail "manifest verification rejected the promoted component"
  echo "approved $component@$digest"
}

case "${1:-}" in
  build)   cmd_build "${@:2}" ;;
  digest)  cmd_digest "${@:2}" ;;
  upload)  cmd_upload "${@:2}" ;;
  gendoc)  cmd_gendoc "${@:2}" ;;
  stage)   cmd_stage "${@:2}" ;;
  version) cmd_version "${@:2}" ;;
  approve) cmd_approve "${@:2}" ;;
  *)       fail "usage: promotion-manifest-e2e.sh build|digest|upload|gendoc|stage|version|approve ..." ;;
esac
