#!/usr/bin/env ruby
# frozen_string_literal: true

require "yaml"

ROLLBACK_ACTION = "./.github/actions/rollback-release"
ROLLBACK_INPUTS = %w[component release_run_id source_sha artifact_sha256].to_h do |name|
  [name, "${{ inputs.#{name} }}"]
end.freeze
ROLLBACK_SECRETS = %w[
  CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
  DEEPSEEK_API_KEY MIMO_API_KEY ZEN_GO_API_KEY SUPABASE_DB_URL
  GOOGLE_MAPS_API_KEY LOGFIRE_TOKEN TURNSTILE_SECRET ANON_ID_SECRET
].freeze
ROLLBACK_VARS = %w[
  VITE_SITE_ORIGIN VITE_CATALOG_URL VITE_USERS_URL VITE_AGENT_URL
  VITE_NEON_AUTH_BASE_URL VITE_TURNSTILE_SITE_KEY VITE_CF_BEACON_TOKEN
  VITE_SHOWCASE_MODE
].freeze

def workflow(path)
  text = File.read(path).sub(/^on:(?=[ \t#]|$)/, '"on":')
  YAML.safe_load(text, aliases: true)
end

def workflow_source(source)
  YAML.safe_load(source.sub(/^on:(?=[ \t#]|$)/, '"on":'), aliases: true)
end

def triggers(value)
  value.fetch("on", value.fetch(true, {}))
end

def action_steps(source)
  workflow_source(source).dig("runs", "steps")
end

def paired_agent_downloads(source)
  steps = action_steps(source)
  steps.select do |step|
    step.dig("with", "name") == "release-${{ inputs.source_sha }}-agent"
  end
end

def rollback_action_step(source)
  steps = workflow_source(source).dig("jobs", "rollback", "steps")
  matches = steps.select { |step| step["uses"] == ROLLBACK_ACTION }
  abort "rollback workflow must call the local action exactly once" unless matches.length == 1
  matches.first
end

def assert_boundary_shape(source)
  steps = workflow_source(source).dig("jobs", "rollback", "steps")
  abort "rollback job must contain checkout then the local action" unless steps.length == 2
  abort "rollback job must checkout trusted main" unless steps.first.dig("with", "ref") == "refs/heads/main"
  abort "rollback checkout must not persist credentials" unless steps.first.dig("with", "persist-credentials") == false
end

def assert_boundary_env(step)
  env = step.fetch("env")
  ROLLBACK_SECRETS.each { |name| abort "rollback action must receive #{name}" unless env[name] == "${{ secrets.#{name} }}" }
  ROLLBACK_VARS.each { |name| abort "rollback action must receive #{name}" unless env[name] == "${{ vars.#{name} }}" }
  abort "rollback action env allowlist drifted" unless env.keys.sort == (ROLLBACK_SECRETS + ROLLBACK_VARS).sort
end

def assert_rollback_workflow_boundary(source)
  assert_boundary_shape(source)
  step = rollback_action_step(source)
  abort "rollback action inputs must preserve caller identity" unless step["with"] == ROLLBACK_INPUTS
  assert_boundary_env(step)
end

def assert_edge_pair(source)
  downloads = paired_agent_downloads(source)
  abort "edge rollback must download the paired agent artifact" if downloads.empty?
  selected_run = downloads.all? do |step|
    step.dig("with", "run-id") == "${{ inputs.release_run_id }}"
  end
  abort "every paired agent download must come from the selected release run" unless selected_run
  abort "edge rollback must verify the paired agent artifact" unless source.include?('verify-release-artifact.py "$agent" agent')
  agent = source.index('promote-release-unit.sh agent production')
  edge = source.index('promote-release-unit.sh edge production')
  abort "edge rollback must promote its sealed agent image before edge" unless agent && edge && agent < edge
end

def assert_child_action_secret_isolation(source)
  child_actions = action_steps(source).select { |step| step.key?("uses") }
  child_actions.each do |step|
    ROLLBACK_SECRETS.each do |name|
      abort "rollback child action must not receive #{name}" unless step.dig("env", name) == ""
    end
  end
end

def assert_sealed_rollback(source)
  abort "rollback must not use a dynamic previous platform version" if source.include?("wrangler rollback")
  abort "rollback must validate the trusted production run and sealed digest" unless source.include?("validate-rollback-release.py")
  abort "rollback must download the caller-selected release run" unless source.include?("run-id: ${{ inputs.release_run_id }}")
  abort "rollback must use the forward no-rebuild adapter" unless source.include?("promote-release-unit.sh")
  abort "expired artifacts must have a documented fail-closed recovery" unless source.include?("expired sealed artifact")
end

def assert_rollback_action_source(source)
  metadata = workflow_source(source)
  abort "rollback implementation must remain composite" unless metadata.dig("runs", "using") == "composite"
  abort "rollback action input surface drifted" unless metadata.fetch("inputs").keys == ROLLBACK_INPUTS.keys
  abort "rollback action inputs must be required" unless metadata.fetch("inputs").values.all? { |input| input["required"] == true }
  assert_sealed_rollback(source)
  assert_edge_pair(source)
  assert_child_action_secret_isolation(source)
  abort "rollback must fail closed on an unknown component" unless source.include?("rollback-ineligible component")
  abort "rollback must not alter schema or infrastructure" if source.match?(/atlas migrate|pulumi (up|destroy)|NEON_DATABASE_URL/)
end

cd_path = ".github/workflows/cd.yml"
rollback_path = ".github/workflows/rollback.yml"
rollback_action_path = ".github/actions/rollback-release/action.yml"
cd = workflow(cd_path)
rollback = workflow(rollback_path)
cd_source = File.read(cd_path)
rollback_source = File.read(rollback_path)
rollback_action_source = File.read(rollback_action_path)
deployment_lock = {
  "group" => "affected-cd-main",
  "cancel-in-progress" => false
}

abort "production CD must be main-push-only" unless triggers(cd) == { "push" => { "branches" => ["main"] } }
abort "CD must use the shared native deployment lock" unless cd.fetch("concurrency") == deployment_lock
abort "production must be protected by exactly one approval job" unless cd_source.scan(/^\s+environment:\s+production\s*$/).length == 1
abort "production must promote the exact main-SHA artifact cohort" unless cd_source.include?("release-${{ github.sha }}-*")
abort "production must use the same no-rebuild adapter as staging" unless cd_source.include?("promote-release-unit.sh")
abort "production promotion must remain fail-closed" unless cd_source.include?("set -euo pipefail")

dispatch = triggers(rollback).fetch("workflow_dispatch")
inputs = dispatch.fetch("inputs")
abort "rollback must require an explicit sealed release identity" unless inputs.keys == ROLLBACK_INPUTS.keys
components = inputs.dig("component", "options")
abort "rollback surface must contain only deployable Workers" unless components == %w[edge web catalog users]
abort "rollback must share the native CD lock" unless rollback.fetch("concurrency") == deployment_lock
job = rollback.fetch("jobs").fetch("rollback")
abort "rollback must require production approval" unless job.fetch("environment") == "production"
abort "rollback must read only release artifacts" unless job.dig("permissions", "actions") == "read"
assert_rollback_workflow_boundary(rollback_source)
assert_rollback_action_source(rollback_action_source)

puts "Production safety contract: main-only immutable promotion and approved real Worker rollback"
