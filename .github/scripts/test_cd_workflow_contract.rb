# frozen_string_literal: true

require "yaml"

def workflow(path)
  YAML.safe_load(File.read(path), aliases: true)
end

def triggers(value)
  value.fetch("on", value.fetch(true, {}))
end

ci = workflow(".github/workflows/pr-verification.yml")
cd = workflow(".github/workflows/cd.yml")
build_source = File.read(".github/actions/build-release-unit/action.yml")
promote_source = File.read(".github/actions/promote-release-phase/action.yml")
adapter_source = File.read(".github/scripts/promote-release-unit.sh")

abort "PR CI must not trigger on push" if triggers(ci).key?("push")
abort "PR CI must not expose deploy jobs" if ci.fetch("jobs").keys.any? { |key| key.include?("deploy") || key.include?("prod") }
abort "legacy deploy fallback must be deleted" if File.exist?(".github/workflows/legacy-cd.yml")
abort "legacy doorbell deploy adapter must be deleted" if File.exist?(".github/workflows/reusable-ring-doorbell.yml")
abort "CD must not route through the retired doorbell" if File.read(".github/workflows/cd.yml").match?(/doorbell|legacy-cd/)

on = triggers(cd)
abort "CD must observe main pushes" unless on.dig("push", "branches") == ["main"]
abort "CD must have no non-main manual entry" unless on.keys == ["push"]
expected_lock = { "group" => "affected-cd-main", "cancel-in-progress" => false }
abort "CD must use only GitHub-native deployment concurrency" unless cd.fetch("concurrency") == expected_lock
abort "CD actions must run on Node 24" unless cd.dig("env", "FORCE_JAVASCRIPT_ACTIONS_TO_NODE24") == true
jobs = cd.fetch("jobs")
route = jobs.fetch("route")
route_source = route.fetch("steps").map { |step| step["run"] }.compact.join("\n")
cd_source = File.read(".github/workflows/cd.yml")
abort "completed CD must not expose a canary switch" if cd_source.match?(/ENABLE_AFFECTED_CD|enable_canary|canary/i)
abort "CD route must use durable successful base through main mode" unless route_source.include?('resolve-cd-base.sh') && route_source.include?('--range main')
resolver_source = File.read(".github/scripts/resolve-cd-base.sh")
abort "CD must reject stale reruns before staging" unless resolver_source.include?("current main") && resolver_source.include?("ref/heads/main")
abort "CD range base must be an ancestor of its source" unless resolver_source.include?("merge-base --is-ancestor")
abort "CD route must consume canonical manifest" unless route_source.include?(".github/ci/components.json")

build = jobs.fetch("build-release-artifacts")
abort "release builds must be affected-matrix only" unless build.dig("strategy", "matrix", "unit").to_s.include?("needs.route.outputs.deploy_units")
abort "release builds must not be feature-gated" if build.fetch("if").match?(/vars\.|enable/i)
abort "release builds must run directly in CD" unless build.fetch("steps").any? { |step| step["uses"] == "./.github/actions/build-release-unit" }

order = %w[stage-foundation stage-migration stage-services stage-edge stage-web post-staging promote-production]
order.each_cons(2) do |before, after|
  needs = Array(jobs.fetch(after).fetch("needs"))
  abort "#{after} must follow #{before}" unless needs.include?(before)
end

staging_names = %w[stage-foundation stage-migration stage-services stage-edge stage-web]
staging_names.each do |name|
  job = jobs.fetch(name)
  abort "#{name} must run directly in CD" if job.key?("uses")
  abort "#{name} must use staging protection" unless job["environment"] == "staging"
  action = job.fetch("steps").find { |step| step["uses"] == "./.github/actions/promote-release-phase" }
  abort "#{name} must use the local promotion action" unless action
end
stage_inputs = {
  "stage-foundation" => %w[
    cloudflare_pulumi_api_token cloudflare_account_id pulumi_config_passphrase
    pulumi_backend_url r2_access_key_id r2_secret_access_key neon_api_key reset_staging_db
  ],
  "stage-migration" => %w[cloudflare_api_token cloudflare_account_id migrator_url],
  "stage-services" => %w[cloudflare_api_token cloudflare_account_id],
  "stage-edge" => %w[
    cloudflare_api_token cloudflare_account_id deepseek_api_key mimo_api_key zen_go_api_key
    supabase_db_url google_maps_api_key logfire_token turnstile_secret anon_id_secret
  ],
  "stage-web" => %w[
    cloudflare_api_token cloudflare_account_id vite_site_origin vite_catalog_url vite_users_url
    vite_agent_url vite_neon_auth_base_url vite_turnstile_site_key vite_cf_beacon_token vite_showcase_mode
  ]
}.freeze
stage_inputs.each do |name, expected|
  action = jobs.fetch(name).fetch("steps").find { |step| step["uses"] == "./.github/actions/promote-release-phase" }
  actual = action.fetch("with").keys - %w[phase units source_sha]
  abort "#{name} must receive only its phase inputs" unless actual.sort == expected.sort
end
migration_permissions = jobs.fetch("stage-migration").fetch("permissions", {})
abort "only migration may mint the staging OIDC token" unless migration_permissions["id-token"] == "write"
(staging_names - ["stage-migration"]).each do |name|
  abort "#{name} must not mint OIDC" if jobs.fetch(name).fetch("permissions", {}).key?("id-token")
end

production = jobs.fetch("promote-production")
abort "production must have the only approval" unless production.fetch("environment") == "production"
abort "production must be a single sequential job" if production.key?("strategy") || production.key?("uses")
abort "exactly one job may request production approval" unless cd_source.scan(/^\s+environment:\s+production\s*$/).length == 1
production_steps = production.fetch("steps").to_h { |step| [step.fetch("name", ""), step] }
secret_sets = {
  "Promote production foundation payloads" => %w[CLOUDFLARE_PULUMI_API_TOKEN CLOUDFLARE_ACCOUNT_ID PULUMI_CONFIG_PASSPHRASE PULUMI_BACKEND_URL R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY NEON_API_KEY],
  "Promote production database payload" => %w[NEON_DATABASE_URL],
  "Promote production service payloads" => %w[CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID],
  "Promote production edge payload" => %w[
    CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID DEEPSEEK_API_KEY MIMO_API_KEY
    ZEN_GO_API_KEY SUPABASE_DB_URL GOOGLE_MAPS_API_KEY LOGFIRE_TOKEN
    TURNSTILE_SECRET ANON_ID_SECRET
  ]
}
secret_sets.each do |name, expected|
  actual = production_steps.fetch(name).fetch("env").keys - %w[SOURCE_SHA RELEASE_UNITS]
  abort "#{name} must receive only its minimum secrets" unless actual.sort == expected.sort
end
web_env = production_steps.fetch("Promote production web payload").fetch("env")
forbidden_web = web_env.keys.grep(/NEON_DATABASE_URL|PULUMI|R2_|NEON_API_KEY/)
abort "web promotion must not inherit control-plane or database secrets" unless forbidden_web.empty?
source = cd_source
# The cohort is now fetched by unit name through one shared script rather than by
# glob: `actions/download-artifact` only creates per-artifact directories when more
# than one matches, so a single-unit cohort landed at a path the adapter never read.
abort "production must reuse main-SHA artifacts" unless source.include?("SOURCE_SHA: ${{ github.sha }}")
abort "production must use the common no-rebuild adapter" unless production.fetch("steps").any? { |step| step["run"].to_s.include?("promote-release-unit.sh") }
abort "production must not rebuild" if production.fetch("steps").any? { |step| step.fetch("name", "").match?(/build/i) }
abort "staging phases must be single jobs, not parallel matrices" if promote_source.include?("matrix:")
abort "staging must use its environment-scoped targets" unless staging_names.all? { |name| jobs.fetch(name)["environment"] == "staging" }
abort "staging and production must share the same adapter" unless promote_source.include?("promote-release-unit.sh")
abort "phase adapter must preserve unit order" unless promote_source.include?("jq -r '.[]'")
abort "phase adapter must reject unknown or empty phases" unless promote_source.include?("foundation|migration|services|edge|web") && promote_source.include?("length > 0")
abort "agent and migrator must be sealed as OCI archives" unless build_source.scan(/docker save/).length == 2
abort "workers must be prebuilt with Wrangler dry-runs" unless build_source.include?("wrangler deploy") && build_source.include?("--dry-run")
abort "web release must seal .output" unless build_source.include?("apps/web/.output") && build_source.include?("wrangler.jsonc")
abort "infra release must seal both Pulumi programs" unless build_source.include?('git archive "$SOURCE_SHA" infra') && build_source.include?("rollback")
generate_at = build_source.index("pulumi package add terraform-provider kislerdm/neon")
install_at = build_source.index("pnpm install --frozen-lockfile")
built_path_at = build_source.index('built_sdk="infra/database-access/node_modules/@pulumi/neon"')
sealed_path_at = build_source.index('sealed_sdk="$out/infra/database-access/sdks/neon"')
source_check_at = build_source.index('[ -f "$built_sdk/bin/index.js" ] || { echo "::error::built Neon provider SDK entrypoint is missing"; exit 1; }')
copy_at = build_source.index('cp -RL "$built_sdk" "$sealed_sdk"')
sealed_check_at = build_source.index('[ -f "$sealed_sdk/bin/index.js" ] || { echo "::error::sealed Neon provider SDK entrypoint is missing"; exit 1; }')
publish_at = build_source.index("actions/upload-artifact@")

abort "infra release must generate the Neon SDK once" unless generate_at
abort "infra release must run the generated SDK lifecycle" unless install_at
abort "infra release must not disable SDK lifecycle scripts" if build_source.match?(/pnpm install[^\n]*--ignore-scripts/)
abort "infra release must read the built Neon SDK" unless built_path_at
abort "infra release must define the sealed Neon SDK destination" unless sealed_path_at
abort "infra release must fail closed when the built SDK entrypoint is missing" unless source_check_at
abort "infra release must dereference and seal the built Neon SDK" unless copy_at
abort "infra release must fail closed when the sealed SDK entrypoint is missing" unless sealed_check_at
abort "infra release must publish an immutable artifact" unless publish_at
abort "infra release must install the generated SDK" unless generate_at < install_at
abort "infra release must publish only after the SDK lifecycle runs" unless install_at < source_check_at
abort "infra release must check the built SDK before copying it" unless source_check_at < copy_at
abort "infra release must check the sealed SDK after copying it" unless copy_at < sealed_check_at
abort "infra release must verify the sealed SDK before publication" unless sealed_check_at < publish_at
abort "infra release must not seal the unbuilt Neon SDK source" if build_source.include?('cp -R infra/database-access/sdks/neon')
abort "production/staging Worker deploys must be no-bundle" unless adapter_source.include?("--no-bundle")
abort "promotion must use the pinned workspace Wrangler" unless adapter_source.scan(/pnpm --dir "\$GITHUB_WORKSPACE" exec wrangler/).length == 4
abort "promotion must reject a cross-account image reference" unless adapter_source.include?("sealed image-ref") && adapter_source.include?("registry.cloudflare.com/%s/%s:sha-%s")
abort "promotion adapter behavior probe must exist" unless File.exist?(".github/scripts/test_promote_release_unit.sh")
abort "OCI archives must load before every registry promotion" unless adapter_source.include?("docker load")
abort "production must push the sealed tar to a content-derived tag" unless adapter_source.include?("prod-$SOURCE_SHA-${digest:0:20}")
abort "production edge must consume the promoted agent reference" unless adapter_source.include?("release-image-refs/$key.ref")
abort "promotion must reject an unbuilt sealed Neon SDK" unless adapter_source.include?("sealed Neon provider SDK is missing")
abort "staging schema must use OIDC migrator" unless adapter_source.include?("ACTIONS_ID_TOKEN_REQUEST_URL") && adapter_source.include?("animichi:github-actions:migrator")
abort "staging migration failure must never fall through to production" if adapter_source.include?("&& migrate_staging ||")
abort "production schema must use sealed Atlas migrations" unless adapter_source.include?("atlas migrate apply") && adapter_source.include?("$PAYLOAD_DIR/migrations")
abort "infra must snapshot rollback state before Pulumi" unless adapter_source.index("pulumi stack export") < adapter_source.index("pulumi up")
abort "infra must upload its rollback state before Pulumi" unless adapter_source.index("aws s3 cp") < adapter_source.index("pulumi up")
abort "infra must fail closed without a rollback snapshot" unless adapter_source.include?("empty Pulumi rollback snapshot")
# #1198's park guard used to abort if "smoke" ever reappeared in cd.yml. Owner decision
# 2026-08-26 (docs/specs/2026-08-26-system-health-audit.md §6.3/§7 W4) lifted that park:
# staging deploys were verified only by exit code, never by an actual request, and that gap
# is exactly what let a broken staging deploy reach promote-production undetected. The
# guard now asserts the opposite — post-staging must actually run the smoke check, not
# merely echo a cohort id.
abort "post-staging must run the staging smoke check (park #1198 lifted 2026-08-26)" \
  unless jobs.fetch("post-staging").fetch("steps").any? { |step| step["run"].to_s.include?("staging-smoke-check.sh") }

# The smoke must probe workers.dev, not the zone hostname: the zone front door
# answers GitHub-runner IPs with a Bot Fight Mode managed challenge that the
# Free plan cannot exempt per hostname or rule (owner decision 2026-08-27).
abort "the staging smoke check must probe workers.dev, not the zone front door" \
  unless jobs.fetch("post-staging").fetch("steps").any? { |step| step["run"].to_s.include?("staging-smoke-check.sh https://animichi-staging.") && step["run"].to_s.include?("workers.dev") }
abort "reusable build workflow must be deleted" if File.exist?(".github/workflows/reusable-build-release-unit.yml")
abort "reusable promotion workflow must be deleted" if File.exist?(".github/workflows/reusable-promote-release-phase.yml")

puts "CD contract: affected main cohort, one immutable build, ordered staging, one approval, exact production promotion"
