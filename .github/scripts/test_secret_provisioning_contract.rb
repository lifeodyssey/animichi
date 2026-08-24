# frozen_string_literal: true

require "yaml"

RUNTIME = %w[
  DEEPSEEK_API_KEY MIMO_API_KEY ZEN_GO_API_KEY SUPABASE_DB_URL
  GOOGLE_MAPS_API_KEY LOGFIRE_TOKEN TURNSTILE_SECRET ANON_ID_SECRET
].freeze
CONTROL = %w[CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID].freeze
LEGACY = %w[
  post-deploy-assert.sh post-deploy-assert.test.sh post-deploy-assert-probes.test.sh
  edge-showcase-mode.sh mock-origin.sh resolve-worker-url.sh resolve-worker-url.test.sh
  vite-env-preflight.sh vite-env-preflight.test.sh wrangler-secret-put.sh wrangler-secret-put.test.sh
].freeze

def load_yaml(path)
  YAML.safe_load(File.read(path), aliases: true)
end

def assert(condition, message)
  abort "secret provisioning contract: #{message}" unless condition
end

cd = load_yaml(ENV.fetch("SECRET_CONTRACT_CD", ".github/workflows/cd.yml"))
phase = load_yaml(ENV.fetch("SECRET_CONTRACT_PHASE", ".github/workflows/reusable-promote-release-phase.yml"))
adapter = File.read(ENV.fetch("SECRET_CONTRACT_ADAPTER", ".github/scripts/promote-release-unit.sh"))
sync = File.read(ENV.fetch("SECRET_CONTRACT_SYNC", ".github/scripts/sync-edge-runtime-secrets.sh"))
renderer = File.read(ENV.fetch("SECRET_CONTRACT_RENDERER", ".github/scripts/edge-runtime-secrets.py"))

stage = cd.dig("jobs", "stage-edge", "secrets").keys
assert(stage.sort == (CONTROL + RUNTIME).sort, "stage edge must receive only control and runtime secrets")
production = cd.dig("jobs", "promote-production", "steps").find { |step| step["name"] == "Promote production edge payload" }
prod_names = production.fetch("env").keys - ["SOURCE_SHA"]
assert(prod_names.sort == (CONTROL + RUNTIME).sort, "production edge must receive the same exact secret set")

phase_step = phase.dig("jobs", "promote", "steps").find { |step| step["name"] == "Promote edge payloads" }
phase_names = phase_step.fetch("env").keys - %w[RELEASE_UNITS SOURCE_SHA]
assert(phase_names.sort == (CONTROL + RUNTIME).sort, "staging edge step must receive the exact secret set")

body = adapter.match(/deploy_worker\(\) \{(.*?)^\}/m).to_a.fetch(1)
assert(body.index("preflight_edge_runtime_secrets") < body.index("run_worker_deploy"), "preflight must precede deploy")
assert(body.index("run_worker_deploy") < body.index("apply_edge_runtime_secrets"), "secret bulk must follow deploy")
assert(sync.include?("wrangler secret bulk") && !sync.include?("secret put"), "promotion must use one bulk stdin write")
assert(sync.match?(/render.*\\\n\s+\| pnpm/m), "secret values must reach Wrangler through stdin")
flag_read = 'config["env"][environment]["vars"]["ANON_ACCESS_ENABLED"]'
assert(renderer.include?("CORE_NAMES") && renderer.include?(flag_read), "renderer must derive conditional names")

LEGACY.each { |name| assert(!File.exist?(".github/scripts/#{name}"), "retired #{name} must be deleted") }
assert(!File.exist?("apps/web/scripts/builds-staging.sh"), "retired web Workers Builds script must be deleted")
assert(!File.exist?("workers/edge/scripts/builds-staging.sh"), "retired edge Workers Builds script must be deleted")
assert(!File.exist?(".github/scripts/inject-web-runtime-config.mjs"), "retired build injector must be deleted")

puts "Secret provisioning contract: exact env-scoped allowlist, preflight, deploy, single stdin bulk write"
