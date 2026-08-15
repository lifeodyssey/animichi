#!/usr/bin/env bash
# #1051 — resolve the expected migration head (the newest committed Neon
# migration basename) for the migrator trigger contract. Staging targets head:
# CI sends this as the expected head and fails unless the migrator's applied
# head equals it, so "the wrong image migrated" is detectable (spec US-13).
#
# Head = the lexicographically-latest revision file under migrations/neon
# (timestamped, append-only), minus the .sql extension. atlas.sum is excluded.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
latest="$(cd "$REPO_ROOT" && ls migrations/neon/*.sql | sort | tail -n 1)"
basename "${latest%.sql}"
