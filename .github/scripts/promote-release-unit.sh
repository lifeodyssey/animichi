#!/usr/bin/env bash
set -euo pipefail

UNIT="${1:?unit required}"
TARGET_ENVIRONMENT="${2:?environment required}"
SOURCE_SHA="${3:?source SHA required}"
RELEASE_DIR="${4:?release directory required}"
PAYLOAD_DIR="$RUNNER_TEMP/promote-$UNIT"

fail() { echo "::error title=immutable promotion::$*"; exit 1; }
required() { [ -n "${!1:-}" ] || fail "$1 is required for $UNIT@$TARGET_ENVIRONMENT"; }

prepare_payload() {
  python3 .github/scripts/verify-release-artifact.py "$RELEASE_DIR" "$UNIT" "$SOURCE_SHA"
  rm -rf "$PAYLOAD_DIR"
  mkdir -p "$PAYLOAD_DIR"
  tar -xzf "$RELEASE_DIR/artifact.tar.gz" -C "$PAYLOAD_DIR"
}

worker_entry() {
  find "$PAYLOAD_DIR/bundle" -maxdepth 1 -type f \( -name '*.js' -o -name '*.mjs' \) -print -quit
}

expected_image_ref() {
  local image=animichi-agent
  [ "$UNIT" = migrator ] && image=animichi-migrator
  printf 'registry.cloudflare.com/%s/%s:sha-%s\n' "$CLOUDFLARE_ACCOUNT_ID" "$image" "$SOURCE_SHA"
}

validate_image_ref() {
  required CLOUDFLARE_ACCOUNT_ID
  local actual expected
  actual="$(cat "$PAYLOAD_DIR/image-ref")"
  expected="$(expected_image_ref)"
  [ "$actual" = "$expected" ] || fail "sealed image-ref $actual does not target $expected"
}

deploy_worker() {
  required CLOUDFLARE_API_TOKEN
  required CLOUDFLARE_ACCOUNT_ID
  local entry
  { [ "$UNIT" != edge ] && [ "$UNIT" != migrator ]; } || validate_image_ref
  pin_production_worker_image
  entry="$(worker_entry)"
  [ -n "$entry" ] || fail "$UNIT artifact has no prebuilt Worker entry"
  preflight_edge_runtime_secrets
  run_worker_deploy "$entry"
  apply_edge_runtime_secrets
}

preflight_edge_runtime_secrets() {
  [ "$UNIT" = edge ] || return 0
  bash .github/scripts/sync-edge-runtime-secrets.sh preflight "$TARGET_ENVIRONMENT" "$PAYLOAD_DIR/config/wrangler.toml"
}

apply_edge_runtime_secrets() {
  [ "$UNIT" = edge ] || return 0
  bash .github/scripts/sync-edge-runtime-secrets.sh apply "$TARGET_ENVIRONMENT" "$PAYLOAD_DIR/config/wrangler.toml"
}

run_worker_deploy() {
  local entry="$1"
  pnpm --dir "$GITHUB_WORKSPACE" exec wrangler deploy "$entry" --no-bundle \
    --config "$PAYLOAD_DIR/config/wrangler.toml" --env "$TARGET_ENVIRONMENT"
}

loaded_image_ref() {
  docker load --input "$PAYLOAD_DIR/image.tar" | sed -n 's/^Loaded image: //p' | tail -n 1
}

promote_image() {
  validate_image_ref
  required CLOUDFLARE_API_TOKEN
  local image_ref loaded_ref
  image_ref="$(cat "$PAYLOAD_DIR/image-ref")"
  loaded_ref="$(loaded_image_ref)"
  [ "$loaded_ref" = "$image_ref" ] || fail "loaded image identity differs from sealed image-ref"
  [ "$TARGET_ENVIRONMENT" != "staging" ] || { push_image "$image_ref"; return 0; }
  promote_production_image "$image_ref"
}

push_image() {
  pnpm --dir "$GITHUB_WORKSPACE" exec wrangler containers push "$1"
}

promote_production_image() {
  local source_ref="$1" digest target_ref image
  digest="$(jq -r '.artifact_sha256' "$RELEASE_DIR/artifact-manifest.json")"
  image=animichi-agent; [ "$UNIT" = migrator ] && image=animichi-migrator
  target_ref="registry.cloudflare.com/$CLOUDFLARE_ACCOUNT_ID/$image:prod-$SOURCE_SHA-${digest:0:20}"
  docker tag "$source_ref" "$target_ref"
  pnpm --dir "$GITHUB_WORKSPACE" exec wrangler containers push "$target_ref"
  mkdir -p "$RUNNER_TEMP/release-image-refs"
  printf '%s\n' "$target_ref" > "$RUNNER_TEMP/release-image-refs/$UNIT.ref"
}

production_worker_image() {
  local key="$UNIT"
  [ "$UNIT" = edge ] && key=agent
  cat "$RUNNER_TEMP/release-image-refs/$key.ref"
}

pin_production_worker_image() {
  [ "$TARGET_ENVIRONMENT" = production ] || return 0
  { [ "$UNIT" = edge ] || [ "$UNIT" = migrator ]; } || return 0
  local old_ref new_ref config="$PAYLOAD_DIR/config/wrangler.toml"
  old_ref="$(cat "$PAYLOAD_DIR/image-ref")"; new_ref="$(production_worker_image)"
  grep -Fq "$old_ref" "$config" || fail "$UNIT config does not reference its sealed source image"
  sed -i.bak "s#$old_ref#$new_ref#g" "$config"; rm -f "$config.bak"
}

inject_web_runtime_config() {
  required VITE_NEON_AUTH_BASE_URL
  TARGET_ENVIRONMENT="$TARGET_ENVIRONMENT" WEB_CONFIG_PATH="$PAYLOAD_DIR/apps/web/wrangler.jsonc" \
    node .github/scripts/inject-release-web-runtime-config.mjs
}

deploy_web() {
  inject_web_runtime_config
  required CLOUDFLARE_API_TOKEN
  required CLOUDFLARE_ACCOUNT_ID
  pnpm --dir "$GITHUB_WORKSPACE" exec wrangler deploy "$PAYLOAD_DIR/apps/web/.output/server/index.mjs" \
    --no-bundle --config "$PAYLOAD_DIR/apps/web/wrangler.jsonc" --env "$TARGET_ENVIRONMENT"
}

require_infra_env() {
  required PULUMI_BACKEND_URL
  required CLOUDFLARE_ACCOUNT_ID
  required R2_ACCESS_KEY_ID
  required R2_SECRET_ACCESS_KEY
  required PULUMI_CONFIG_PASSPHRASE
  required CLOUDFLARE_PULUMI_API_TOKEN
  required NEON_API_KEY
}

export_pulumi_state() {
  local project="$1" stack="$2" backup="$3"
  (cd "$project" && pulumi login "$PULUMI_BACKEND_URL" && \
    pulumi stack select "$stack" && pulumi stack export --file "$backup")
  [ -s "$backup" ] || fail "empty Pulumi rollback snapshot for $project/$stack"
}

upload_pulumi_state() {
  local backup="$1" stack="$2" label="$3" bucket
  bucket="${PULUMI_BACKEND_URL#s3://}"; bucket="${bucket%%\?*}"
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    AWS_DEFAULT_REGION=auto aws s3 cp \
    --endpoint-url "https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com" \
    "$backup" "s3://$bucket/rollback-backups/pulumi-$label-$stack-$GITHUB_RUN_ID.json"
}

pulumi_backup() {
  local project="$1" stack="$2" label="$3" backup
  backup="$RUNNER_TEMP/pulumi-$label-$stack-$GITHUB_RUN_ID.json"
  export_pulumi_state "$project" "$stack" "$backup"
  upload_pulumi_state "$backup" "$stack" "$label"
}

pulumi_up() {
  local project="$1" stack="$2"
  (cd "$project" && pulumi up --stack "$stack" --non-interactive --yes)
}

setup_infra() {
  require_infra_env
  export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_PULUMI_API_TOKEN"
  export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
  export AWS_DEFAULT_REGION=auto
  pnpm install --dir "$PAYLOAD_DIR" --frozen-lockfile --ignore-scripts
  pnpm install --dir "$PAYLOAD_DIR/infra/database-access" --frozen-lockfile --ignore-scripts
  [ -f "$PAYLOAD_DIR/infra/database-access/sdks/neon/bin/index.js" ] || \
    fail "sealed Neon provider SDK is missing its built entrypoint"
}

apply_pulumi_project() {
  local project="$1" stack="$2" label="$3"
  pulumi_backup "$project" "$stack" "$label"
  pulumi_up "$project" "$stack"
}

reset_staging_baseline() {
  [ "$TARGET_ENVIRONMENT" = staging ] || return 0
  bash "$PAYLOAD_DIR/infra/database-access/reset-staging-baseline.sh"
}

deploy_infra() {
  local stack=staging
  [ "$TARGET_ENVIRONMENT" = production ] && stack=prod
  setup_infra
  apply_pulumi_project "$PAYLOAD_DIR/infra/database-access" "$stack" database-access
  reset_staging_baseline
  apply_pulumi_project "$PAYLOAD_DIR/infra" "$stack" main
}

sealed_migration_head() {
  find "$PAYLOAD_DIR/migrations" -maxdepth 1 -name '*.sql' -print \
    | sort | tail -n 1 | xargs basename | sed 's/\.sql$//'
}

migrator_oidc_token() {
  required ACTIONS_ID_TOKEN_REQUEST_URL
  required ACTIONS_ID_TOKEN_REQUEST_TOKEN
  curl -sSfL -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
    "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=animichi:github-actions:migrator" | jq -r .value
}

trigger_migrator() {
  local expected="$1" token="$2" body code
  body="$(jq -cn --arg expectedHead "$expected" '{expectedHead:$expectedHead}')"
  code="$(curl -sS -o "$RUNNER_TEMP/migrate.json" -w '%{http_code}' -X POST \
    "$MIGRATOR_URL/migrate" -H "Authorization: Bearer $token" \
    -H 'content-type: application/json' --max-time 900 -d "$body")"
  [ "$code" = 200 ] || fail "migrator returned HTTP $code"
}

verify_migrator_result() {
  local expected="$1"
  jq -e --arg head "$expected" '.success == true and .appliedHead == $head' \
    "$RUNNER_TEMP/migrate.json" >/dev/null || fail "migrator did not apply sealed head $expected"
}

migrate_staging() {
  required MIGRATOR_URL
  local expected token
  expected="$(sealed_migration_head)"
  token="$(migrator_oidc_token)"
  trigger_migrator "$expected" "$token"
  verify_migrator_result "$expected"
}

migrate_production() {
  required NEON_DATABASE_URL
  [ ! -f "$PAYLOAD_DIR/migrations/STAGING_ONLY_BASELINE" ] ||
    fail "staging-only baseline requires a separately approved production cutover"
  local scoped_url="$NEON_DATABASE_URL"
  case "$scoped_url" in *\?*) scoped_url="${scoped_url}&search_path=public" ;; *) scoped_url="${scoped_url}?search_path=public" ;; esac
  atlas migrate validate --dir "file://$PAYLOAD_DIR/migrations"
  atlas migrate apply --dir "file://$PAYLOAD_DIR/migrations" --url "$scoped_url" --revisions-schema public
}

prepare_payload
case "$UNIT" in
  infra) deploy_infra ;;
  agent) promote_image ;;
  migrator) promote_image; deploy_worker ;;
  db)
    if [ "$TARGET_ENVIRONMENT" = staging ]; then migrate_staging; else migrate_production; fi
    ;;
  catalog|users|edge) deploy_worker ;;
  web) deploy_web ;;
  *) fail "unknown release unit $UNIT" ;;
esac
