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
build_source = File.read(".github/workflows/reusable-build-release-unit.yml")
promote_source = File.read(".github/workflows/reusable-promote-release-phase.yml")
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

order = %w[stage-foundation stage-migration stage-services stage-edge stage-web post-staging promote-production]
order.each_cons(2) do |before, after|
  needs = Array(jobs.fetch(after).fetch("needs"))
  abort "#{after} must follow #{before}" unless needs.include?(before)
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
abort "production must reuse main-SHA artifacts" unless source.include?("release-${{ github.sha }}-")
abort "production must use the common no-rebuild adapter" unless production.fetch("steps").any? { |step| step["run"].to_s.include?("promote-release-unit.sh") }
abort "production must not rebuild" if production.fetch("steps").any? { |step| step.fetch("name", "").match?(/build/i) }
abort "staging phases must be single jobs, not parallel matrices" if promote_source.include?("matrix:")
abort "staging must use its environment-scoped targets" unless promote_source.match?(/^\s+environment:\s+staging\s*$/)
abort "staging and production must share the same adapter" unless promote_source.include?("promote-release-unit.sh")
abort "phase adapter must preserve unit order" unless promote_source.include?("jq -r '.[]'")
abort "agent and migrator must be sealed as OCI archives" unless build_source.scan(/docker save/).length == 2
abort "workers must be prebuilt with Wrangler dry-runs" unless build_source.include?("wrangler deploy") && build_source.include?("--dry-run")
abort "web release must seal .output" unless build_source.include?("apps/web/.output") && build_source.include?("wrangler.jsonc")
abort "infra release must seal both Pulumi programs" unless build_source.include?('git archive "$SOURCE_SHA" infra') && build_source.include?("rollback")
abort "infra release must generate and seal the Neon SDK once" unless build_source.include?("pulumi package add terraform-provider kislerdm/neon") && build_source.include?("sdks/neon")
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
abort "parked smoke must not return" if cd_source.match?(/post-deploy-test|smoke/i) || promote_source.match?(/post-deploy-test|smoke/i)

puts "CD contract: affected main cohort, one immutable build, ordered staging, one approval, exact production promotion"
