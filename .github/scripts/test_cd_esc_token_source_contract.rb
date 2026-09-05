# frozen_string_literal: true

# ESC is the only source of the Pulumi-plane tokens (#1078). After the
# `pulumi/auth-actions` OIDC login (#1077), the two lanes that run `pulumi up` —
# staging `stage-foundation` through the promotion action, and the production
# infra step in `promote-production` — open the matching Pulumi ESC environment
# and take `CLOUDFLARE_API_TOKEN` (the Pulumi-plane Cloudflare token) and
# `NEON_API_KEY` (what `animichi-neon-secrets` provisions with) from it. Neither
# is read from GitHub Secrets on this lane any more.
#
# Worker publishing keeps its own `secrets.CLOUDFLARE_API_TOKEN`, never opens an
# ESC environment, and never runs `esc run wrangler`. That separation is the
# point: the Pulumi-plane token may not deploy a Worker, and the deploy token may
# not touch Pulumi state. ADR 0003 stands — ESC carries control-plane
# credentials only, so no runtime DSN and no model key is exported out of it.

require "yaml"

ESC_ACTION = "pulumi/esc-action"
ESC_AUTH_ACTION = "pulumi/auth-actions"
ESC_ORGANIZATION = "lifeodyssey"
# Organization-qualified for the same reason #1077 qualifies the stack: an
# unqualified name resolves against whatever organization the token defaults to.
ESC_STAGING_ENVIRONMENT = "${{ inputs.pulumi_organization }}/animichi/staging"
ESC_PRODUCTION_ENVIRONMENT = "#{ESC_ORGANIZATION}/animichi/prod"
ESC_ENVIRONMENTS = [ESC_STAGING_ENVIRONMENT, ESC_PRODUCTION_ENVIRONMENT].freeze
ESC_EXPORTS = %w[CLOUDFLARE_API_TOKEN NEON_API_KEY].freeze
# The GitHub secrets ESC replaces. The repository secrets themselves are #1081;
# this contract only asserts that nothing on the delivery lane reads them.
RETIRED_LANE_SECRETS = %w[CLOUDFLARE_PULUMI_API_TOKEN NEON_API_KEY].freeze
# Runtime credentials from the Live table of docs/ops/secrets.md. ADR 0003 keeps
# every one of them in the Cloudflare Secrets Store or the edge bulk payload, so
# none may ever be projected out of an ESC environment.
RUNTIME_ONLY_NAMES = %w[
  NEON_DATABASE_URL SUPABASE_DB_URL AGENT_DATABASE_URL AGENT_SVC_DATABASE_URL
  CATALOG_DATABASE_URL CATALOG_DATABASE_URL_PROD USERS_DATABASE_URL USERS_DATABASE_URL_PROD
  DEEPSEEK_API_KEY MIMO_API_KEY ZEN_GO_API_KEY ZETA_API_KEY OPENAI_COMPAT_API_KEY
  GEMINI_API_KEY ANTHROPIC_API_KEY GOOGLE_MAPS_API_KEY LOGFIRE_TOKEN
  TURNSTILE_SECRET ANON_ID_SECRET
].freeze
DSN_SHAPED = /_DATABASE_URL\z|_DB_URL\z/.freeze
# Every cd.yml job that publishes a Worker, pinned by name. Cross-checked below
# against the jobs that actually receive the Worker deployment token, so the
# list cannot quietly go stale when a phase is added.
WORKER_PUBLISH_JOBS = %w[stage-migration stage-services stage-edge stage-web].freeze
ROLLBACK_JOBS = %w[rollback].freeze
# The promote-production steps that hand a Worker deploy its token. Each one
# must name `secrets.CLOUDFLARE_API_TOKEN` explicitly: a step-level `env` wins
# over the job environment, so this is what stops the ESC-injected Pulumi-plane
# token from ever being the credential that publishes a Worker.
WORKER_PUBLISH_PRODUCTION_STEPS = [
  "Promote production service payloads",
  "Promote production edge payload",
  "Promote production web payload"
].freeze

def assert(condition, message)
  abort "ESC token source contract: #{message}" unless condition
end

# Absence is asserted over executable content only: the comments that explain
# why a secret is gone necessarily name it, and matching those would make the
# contract fire on its own rationale (same rule as #1077's safety contract).
def executable_lines(text)
  text.lines.reject { |line| line.match?(/\A\s*#/) }.join
end

def step_index(steps, action)
  steps.index { |step| step["uses"].to_s.start_with?("#{action}@") }
end

def esc_step(steps)
  steps.find { |step| step["uses"].to_s.start_with?("#{ESC_ACTION}@") }
end

def exported_names(step)
  step.dig("with", "export-environment-variables").to_s.split(/[,\n]/).map(&:strip).reject(&:empty?)
end

cd_source = File.read(".github/workflows/cd.yml")
phase_source = File.read(".github/actions/promote-release-phase/action.yml")
rollback_source = File.read(".github/workflows/rollback.yml")
rollback_action_source = File.read(".github/actions/rollback-release/action.yml")
adapter = File.read(".github/scripts/promote-release-unit.sh")
cd = YAML.safe_load(cd_source, aliases: true)
phase = YAML.safe_load(phase_source, aliases: true)
rollback = YAML.safe_load(rollback_source, aliases: true)

phase_steps = phase.dig("runs", "steps")
production = cd.dig("jobs", "promote-production")
production_steps = production.fetch("steps")

# ── AC1: both Pulumi lanes open their ESC environment, after the OIDC login ──
staging_esc = esc_step(phase_steps)
production_esc = esc_step(production_steps)
assert(staging_esc, "the foundation phase must open its ESC environment with #{ESC_ACTION}")
assert(production_esc, "production infra promotion must open its ESC environment with #{ESC_ACTION}")
lanes = [
  ["staging", phase_steps, staging_esc, "foundation", ESC_STAGING_ENVIRONMENT],
  ["production", production_steps, production_esc, "'infra'", ESC_PRODUCTION_ENVIRONMENT]
].freeze

lanes.each do |name, steps, esc, gate, environment|
  assert(esc.fetch("if").include?(gate), "the #{name} ESC step must be scoped to #{gate}")
  assert(esc.dig("with", "environment") == environment, "#{name} must open #{environment}")
  # The ESC action reads `PULUMI_ACCESS_TOKEN`, which `pulumi/auth-actions` exports.
  auth_at = step_index(steps, ESC_AUTH_ACTION)
  assert(auth_at, "the #{name} ESC lane must first log into Pulumi Cloud with #{ESC_AUTH_ACTION}")
  assert(auth_at < steps.index(esc), "the #{name} ESC step must run after the Pulumi Cloud OIDC login")
  # Left unpinned the action installs the latest Pulumi CLI and prepends it to
  # PATH, shadowing the `.pulumi.version` one `pulumi/actions` just installed.
  resolver = steps.find { |step| step["run"].to_s.include?(".pulumi.version") }
  assert(resolver, "the #{name} ESC lane must resolve its Pulumi CLI version from .pulumi.version")
  assert(esc.dig("with", "version") == "${{ steps.#{resolver.fetch('id')}.outputs.version }}",
         "the #{name} ESC step must install the .pulumi.version CLI, not the latest release")
end
assert(File.read(".pulumi.version").strip.match?(/\A\d+\.\d+\.\d+\z/), ".pulumi.version must pin an exact version")

# ── AC1: the two Pulumi-plane secrets are gone from the delivery lane ──
lane = {
  "cd.yml" => executable_lines(cd_source),
  "promote-release-phase" => executable_lines(phase_source),
  "rollback.yml" => executable_lines(rollback_source),
  "rollback-release" => executable_lines(rollback_action_source),
  "promote-release-unit.sh" => executable_lines(adapter)
}.freeze
lane.each do |name, code|
  RETIRED_LANE_SECRETS.each do |secret|
    assert(!code.include?("secrets.#{secret}"), "#{name} must take #{secret} from ESC, not GitHub Secrets")
  end
end
assert(
  !lane.fetch("promote-release-phase").match?(/cloudflare_pulumi_api_token|neon_api_key/),
  "the promotion action must no longer accept the Pulumi-plane tokens as inputs"
)

# The adapter fails closed on the values ESC is expected to have exported.
ESC_EXPORTS.each do |name|
  assert(adapter.include?("required #{name}"), "infra promotion must fail closed without #{name}")
end
assert(
  !lane.fetch("promote-release-unit.sh").include?("CLOUDFLARE_PULUMI_API_TOKEN"),
  "the adapter must read the Pulumi-plane Cloudflare token under its ESC name"
)

# ── AC2: Worker publishing and rollback never touch ESC ──
worker_publish = cd.fetch("jobs").select do |_name, job|
  Array(job["steps"]).any? { |step| step.dig("with", "cloudflare_api_token") }
end
assert(
  worker_publish.keys.sort == WORKER_PUBLISH_JOBS.sort,
  "the pinned Worker-publish job list is stale: #{worker_publish.keys.sort.inspect}"
)
assert(rollback.fetch("jobs").keys.sort == ROLLBACK_JOBS.sort, "the pinned rollback job list is stale")

(WORKER_PUBLISH_JOBS + ROLLBACK_JOBS).each do |name|
  job = cd.fetch("jobs")[name] || rollback.fetch("jobs").fetch(name)
  assert(!esc_step(Array(job.fetch("steps"))), "#{name} must not open an ESC environment")
  assert(!Array(job.fetch("steps")).any? { |step| step.dig("with", "phase") == "foundation" },
         "#{name} must not run the foundation phase, which is what opens ESC")
end
lane.each do |name, code|
  assert(!code.match?(/\besc run\b/), "#{name} must not wrap a command in `esc run`")
end
WORKER_PUBLISH_PRODUCTION_STEPS.each do |name|
  step = production_steps.find { |candidate| candidate["name"] == name }
  assert(step, "promote-production must still contain the step #{name.inspect}")
  assert(
    step.dig("env", "CLOUDFLARE_API_TOKEN") == "${{ secrets.CLOUDFLARE_API_TOKEN }}",
    "#{name} must publish with the Worker deploy token, never the ESC-injected Pulumi-plane token"
  )
end

# ── AC3: ADR 0003 — ESC carries control-plane credentials only ──
esc_steps = [staging_esc, production_esc]
assert(
  esc_steps.map { |step| step.dig("with", "environment") }.sort == ESC_ENVIRONMENTS.sort,
  "the delivery lane may open only #{ESC_ENVIRONMENTS.inspect}"
)
esc_steps.each do |step|
  # An omitted or `true` export list projects every key the environment ever grows.
  declared = step.dig("with", "export-environment-variables").to_s.strip
  assert(!declared.empty?, "the ESC export list must be explicit, never the export-everything default")
  assert(!%w[true True TRUE].include?(declared), "the ESC export list must name its keys, not export everything")
  exports = exported_names(step)
  assert(exports.sort == ESC_EXPORTS.sort, "an ESC step must export exactly #{ESC_EXPORTS.inspect}, got #{exports.inspect}")
  forbidden = exports.select { |key| RUNTIME_ONLY_NAMES.include?(key) || key.match?(DSN_SHAPED) }
  assert(forbidden.empty?, "ADR 0003: ESC must not export runtime credentials #{forbidden.inspect}")
end

puts "ESC token source contract: Pulumi-plane tokens from ESC, Worker publish and rollback ESC-free, ADR 0003 intact"
