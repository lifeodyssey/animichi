#!/usr/bin/env bash
# Recidivism gate for the #1013 runtime-config payloads (P0): every
# RUNTIME_CONFIG JSON the workflows embed must be well-formed and carry the
# versioned contract's required keys. A missing comma made invalid JSON that
# the fail-closed loader rejected. Future copy/edit drift fails here instead
# of shipping a lane that reads the env-neutral default.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
SOURCES=(
  ".github/workflows/reusable-cross-stack-e2e.yml"
  ".github/scripts/pr-verification-gate.sh"
)

extract_payload() {
  grep -Eo "RUNTIME_CONFIG='[^']*'" "$1" | sed "s/^RUNTIME_CONFIG='//; s/'$//"
}

is_valid() {
  python3 -c 'import json,sys; json.load(sys.stdin)' 2>/dev/null
}

check_contract() {
  python3 -c '
import json,sys
p = json.load(sys.stdin)
ok = p.get("schemaVersion") == 1
for key in ("api", "showcaseMode", "featureFlags"):
    ok = ok and key in p
sys.exit(0 if ok else 1)
' 2>/dev/null
}

main() {
  local file payload failures=0
  for file in "${SOURCES[@]}"; do
    [ -f "${REPO_ROOT}/${file}" ] || { echo "missing workflow: ${file}"; failures=$((failures + 1)); continue; }
    while IFS= read -r payload; do
      [ -n "${payload}" ] || continue
      if ! printf '%s' "${payload}" | is_valid; then
        echo "RUNTIME_CONFIG payload is not valid JSON in ${file}"
        failures=$((failures + 1))
        continue
      fi
      if ! printf '%s' "${payload}" | check_contract; then
        echo "RUNTIME_CONFIG payload missing schemaVersion:1 / required keys in ${file}"
        failures=$((failures + 1))
      fi
    done < <(extract_payload "${REPO_ROOT}/${file}")
  done
  if [ "${failures}" -ne 0 ]; then
    echo "found ${failures} invalid RUNTIME_CONFIG payload(s); fix the workflow YAML"
    exit 1
  fi
  echo "all RUNTIME_CONFIG payloads are valid versioned JSON"
}

main
