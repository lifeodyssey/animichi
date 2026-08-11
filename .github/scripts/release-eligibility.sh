#!/usr/bin/env bash
set -euo pipefail

# SAFE-1 Phase B2: judge a candidate SHA against the pinned production manifest.
#
# Reads the manifest content-addressed (pinned Git blob id, fetched via the
# GitHub API — never from the working tree, so a campaign checkout that tampers
# with the manifest cannot influence the verdict), validates it with the
# resolver, and prints the resolver's typed verdict JSON on stdout.
#
# usage: release-eligibility.sh <component> <candidate_sha> [manifest_file]
#   manifest_file  — when given, read the manifest from this local file
#                    (test path); default reads the pinned blob from GitHub.
#   stdout         — resolver verdict JSON (see release-manifest-resolver.rb)
#   exit           — 0 when the manifest is valid and resolvable; 1 otherwise.

PINNED_MANIFEST_BLOB_ID="e25a262562f61246f07f3b08817727ee2b1856ef"
REPOSITORY="${GITHUB_REPOSITORY:-lifeodyssey/animichi}"

component="${1:?component required}"
candidate_sha="${2:?candidate_sha required}"
manifest_file="${3:-}"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

if [[ -n "$manifest_file" ]]; then
  manifest_path="$manifest_file"
else
  manifest_path="$workdir/manifest.json"
  gh api "repos/${REPOSITORY}/git/blobs/${PINNED_MANIFEST_BLOB_ID}" \
    --jq .content | base64 -d > "$manifest_path"
fi

ruby "$(dirname "$0")/release-manifest-resolver.rb" \
  "$manifest_path" "$component" "$candidate_sha"
