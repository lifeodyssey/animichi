#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
TMP="$(mktemp -d)"
SHA="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
ACCOUNT="021233c1880a43aa68565496100e1f8c"
trap 'rm -rf "$TMP"' EXIT

make_release() {
  local ref="$1" digest
  rm -rf "$TMP/payload" "$TMP/release"; mkdir -p "$TMP/payload" "$TMP/release"
  printf '%s\n' "$ref" > "$TMP/payload/image-ref"
  printf 'sealed image bytes\n' > "$TMP/payload/image.tar"
  tar -C "$TMP/payload" -czf "$TMP/release/artifact.tar.gz" .
  digest="$(python3 -c 'import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$TMP/release/artifact.tar.gz")"
  printf '{"schema_version":1,"unit":"agent","source_sha":"%s","artifact_sha256":"%s"}\n' \
    "$SHA" "$digest" > "$TMP/release/artifact-manifest.json"
}

run_adapter() {
  PATH="$TMP/bin:$PATH" MOCK_IMAGE_REF="$(cat "$TMP/payload/image-ref")" \
    RUNNER_TEMP="$TMP" GITHUB_WORKSPACE="$ROOT" CLOUDFLARE_ACCOUNT_ID="$ACCOUNT" \
    CLOUDFLARE_API_TOKEN=test-token \
    bash "$ROOT/.github/scripts/promote-release-unit.sh" agent production "$SHA" "$TMP/release"
}

mkdir -p "$TMP/bin"
cat > "$TMP/bin/docker" <<'SH'
#!/usr/bin/env bash
if [ "$1" = load ]; then printf 'Loaded image: %s\n' "$MOCK_IMAGE_REF"; exit 0; fi
printf '%s\n' "$*" >> "$RUNNER_TEMP/docker.log"
SH
cat > "$TMP/bin/pnpm" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$RUNNER_TEMP/pnpm.log"
SH
chmod +x "$TMP/bin/docker" "$TMP/bin/pnpm"

make_release "registry.cloudflare.com/wrong/animichi-agent:sha-$SHA"
if run_adapter >"$TMP/out" 2>&1; then
  echo "cross-account image reference was accepted"; exit 1
fi
grep -q "sealed image-ref" "$TMP/out"

make_release "registry.cloudflare.com/$ACCOUNT/animichi-agent:sha-$SHA"
run_adapter
grep -q "containers push registry.cloudflare.com/$ACCOUNT/animichi-agent:prod-$SHA-" "$TMP/pnpm.log"
test -s "$TMP/release-image-refs/agent.ref"
echo "promotion adapter: cross-account rejected; production pushes exact sealed tar to a content-derived tag"
