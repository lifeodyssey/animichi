#!/usr/bin/env bash
# Compatibility adapter for the manifest-backed PR change planner.
set -euo pipefail

BASE_SHA="${1:-}"
HEAD_SHA="${2:-}"
ROOT="${PR_VERIFICATION_ROOT:-$(git rev-parse --show-toplevel)}"
MANIFEST="${PR_VERIFICATION_MANIFEST:-$ROOT/.github/ci/components.json}"
PLANNER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/change-plan.py"

usage() {
  printf 'usage: %s <base-sha> <head-sha>\n' "${BASH_SOURCE[0]}" >&2
  exit 2
}

is_sha() {
  [[ "$1" =~ ^[0-9a-fA-F]{40}$ ]]
}

[ "$#" -eq 2 ] || usage
is_sha "$BASE_SHA" || { printf 'pr-verification-route: invalid base SHA\n' >&2; exit 2; }
is_sha "$HEAD_SHA" || { printf 'pr-verification-route: invalid head SHA\n' >&2; exit 2; }
python3 "$PLANNER" \
  --root "$ROOT" \
  --manifest "$MANIFEST" \
  --base "$BASE_SHA" \
  --head "$HEAD_SHA" \
  --range pr \
  --format names
