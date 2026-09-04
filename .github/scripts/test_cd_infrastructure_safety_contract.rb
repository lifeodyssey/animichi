# frozen_string_literal: true

# Pulumi identity + state contract (#1077). State and stack encryption live in
# Pulumi Cloud; the two Pulumi projects (`seichijunrei-infra` and
# `animichi-neon-secrets`) authenticate with the official GitHub OIDC action.
# The pre-apply `pulumi stack export` -> `aws s3 cp` rollback snapshot is
# retired in favour of Pulumi Cloud history, so the R2 state credentials, the
# backend URL, and the config passphrase leave the delivery lane entirely.

require "yaml"

# The Pulumi Cloud organization recorded on #1072 (names only, no values).
PULUMI_ORGANIZATION = "lifeodyssey"
PULUMI_CLOUD_BACKEND = "https://api.pulumi.com"
PULUMI_AUTH_ACTION = "pulumi/auth-actions"
# Retired with the R2 backend: nothing on the delivery lane may name these.
RETIRED_STATE_NAMES = %w[
  PULUMI_BACKEND_URL PULUMI_CONFIG_PASSPHRASE R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY
].freeze

def assert(condition, message)
  abort "infrastructure safety contract: #{message}" unless condition
end

# Absence is asserted over executable content only. Both shells and YAML use
# `#` line comments, and the comments that explain *why* the R2 backend is gone
# necessarily name the thing that is gone — matching them would make the
# contract fire on its own rationale.
def executable_lines(text)
  text.lines.reject { |line| line.match?(/\A\s*#/) }.join
end

adapter = File.read(".github/scripts/promote-release-unit.sh")
cd_source = File.read(".github/workflows/cd.yml")
phase_source = File.read(".github/actions/promote-release-phase/action.yml")
cd = YAML.safe_load(cd_source, aliases: true)
phase = YAML.safe_load(phase_source, aliases: true)

# ── AC1: the infra/neon-secrets lane logs in with the official OIDC action ──
def auth_step(steps)
  steps.find { |step| step["uses"].to_s.start_with?("#{PULUMI_AUTH_ACTION}@") }
end

staging_auth = auth_step(phase.dig("runs", "steps"))
assert(staging_auth, "the foundation phase must log into Pulumi Cloud with #{PULUMI_AUTH_ACTION}")
assert(staging_auth.fetch("if").include?("foundation"), "Pulumi Cloud login must be scoped to the foundation phase")
assert(
  staging_auth.dig("with", "organization") == "${{ inputs.pulumi_organization }}",
  "the foundation login must exchange for the organization the caller declares"
)

production = cd.dig("jobs", "promote-production")
production_auth = auth_step(production.fetch("steps"))
assert(production_auth, "production infra promotion must log into Pulumi Cloud with #{PULUMI_AUTH_ACTION}")
assert(production_auth.fetch("if").include?("'infra'"), "the production Pulumi login must be scoped to the infra unit")
assert(
  production_auth.dig("with", "organization") == PULUMI_ORGANIZATION,
  "the production login must exchange for the #{PULUMI_ORGANIZATION} organization"
)

foundation = cd.dig("jobs", "stage-foundation")
assert(foundation.dig("permissions", "id-token") == "write", "stage-foundation must mint the OIDC token its Pulumi login needs")
assert(production.dig("permissions", "id-token") == "write", "promote-production must mint the OIDC token its Pulumi login needs")

lane = {
  "promote-release-unit.sh" => executable_lines(adapter),
  "cd.yml" => executable_lines(cd_source),
  "promote-release-phase" => executable_lines(phase_source)
}.freeze

# ── AC1: no R2/S3 backend login survives anywhere on that lane ──
lane.each do |name, code|
  assert(!code.include?("pulumi login"), "#{name} must not log Pulumi into an explicit backend URL")
  assert(!code.match?(%r{s3://}), "#{name} must not reference an S3/R2 state backend")
end

# ── AC2: the retired state credentials are named nowhere on the lane ──
lane.each do |name, code|
  RETIRED_STATE_NAMES.each do |secret|
    assert(!code.include?(secret), "#{name} must not reference #{secret}")
    assert(!code.include?(secret.downcase), "#{name} must not reference #{secret.downcase}")
  end
end

# ── The pre-apply R2 export/upload backup is retired in favour of Cloud history ──
adapter_code = lane.fetch("promote-release-unit.sh")
assert(!adapter_code.include?("pulumi stack export"), "the pre-apply R2 stack export must be retired for Pulumi Cloud history")
assert(!adapter_code.include?("aws s3 cp"), "the pre-apply rollback upload must be retired for Pulumi Cloud history")
assert(!adapter_code.include?("AWS_ACCESS_KEY_ID"), "the adapter must not hand S3 credentials to Pulumi")

# ── Both Pulumi projects point their backend at Pulumi Cloud ──
%w[infra/Pulumi.yaml infra/database-access/Pulumi.yaml].each do |path|
  project = YAML.safe_load(File.read(path))
  assert(project.dig("backend", "url") == PULUMI_CLOUD_BACKEND, "#{path} must declare the Pulumi Cloud backend")
end

# ── Stacks are organization-qualified, from the same org the login requested ──
assert(adapter.include?("required PULUMI_ACCESS_TOKEN"), "infra promotion must fail closed without a Pulumi Cloud login")
assert(adapter.include?('--stack "$PULUMI_ORG/$stack"'), "infra promotion must apply an organization-qualified stack")
phase_promotion = phase.dig("runs", "steps").find { |step| step["name"] == "Promote foundation payloads" }
assert(
  phase_promotion.dig("env", "PULUMI_ORG") == "${{ inputs.pulumi_organization }}",
  "the foundation promotion step must receive the organization it logged into"
)
[staging_auth, production_auth].each do |step|
  assert(
    step.dig("with", "requested-token-type") == "urn:pulumi:token-type:access_token:organization",
    "the Pulumi login must request an organization token, not a personal or team one"
  )
end
declared_orgs = [
  cd.dig("jobs", "stage-foundation", "steps")
    .find { |step| step["uses"] == "./.github/actions/promote-release-phase" }
    .dig("with", "pulumi_organization"),
  production.fetch("steps").find { |step| step["name"] == "Promote production foundation payloads" }.dig("env", "PULUMI_ORG"),
  production_auth.dig("with", "organization")
]
assert(declared_orgs.uniq == [PULUMI_ORGANIZATION], "every Pulumi lane must name the same organization: #{declared_orgs.inspect}")

assert(adapter.include?("sealed Neon provider SDK is missing"), "infra promotion must use the sealed Neon SDK")
assert(cd_source.index("stage-foundation:") < cd_source.index("stage-migration:"), "foundation must precede migration")
assert(foundation["environment"] == "staging", "foundation must use staging protection")

puts "Infrastructure safety contract: Pulumi Cloud OIDC login, sealed provider, no R2 state credentials"
