#!/usr/bin/env ruby
# frozen_string_literal: true

require "yaml"

ROLLBACK_RUNTIME_SECRETS = %w[
  DEEPSEEK_API_KEY MIMO_API_KEY ZEN_GO_API_KEY SUPABASE_DB_URL
  GOOGLE_MAPS_API_KEY LOGFIRE_TOKEN TURNSTILE_SECRET ANON_ID_SECRET
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

def assert_edge_pair(source)
  abort "edge rollback must download the paired agent artifact" unless source.include?('name: release-${{ inputs.source_sha }}-agent')
  steps = workflow_source(source).dig("jobs", "rollback", "steps")
  paired = steps.find { |step| step["name"] == "Download the edge's paired sealed agent image" }
  abort "paired agent must come from the selected release run" unless paired&.dig("with", "run-id") == "${{ inputs.release_run_id }}"
  abort "edge rollback must verify the paired agent artifact" unless source.include?('verify-release-artifact.py "$agent" agent')
  agent = source.index('promote-release-unit.sh agent production')
  edge = source.index('promote-release-unit.sh edge production')
  abort "edge rollback must promote its sealed agent image before edge" unless agent && edge && agent < edge
end

def assert_sealed_rollback(source)
  abort "rollback must not use a dynamic previous platform version" if source.include?("wrangler rollback")
  abort "rollback must validate the trusted production run and sealed digest" unless source.include?("validate-rollback-release.py")
  abort "rollback must download the caller-selected release run" unless source.include?("run-id: ${{ inputs.release_run_id }}")
  abort "rollback must use the forward no-rebuild adapter" unless source.include?("promote-release-unit.sh")
  abort "expired artifacts must have a documented fail-closed recovery" unless source.include?("expired sealed artifact")
end

def assert_rollback_source(source)
  assert_sealed_rollback(source)
  assert_edge_pair(source)
  step = workflow_source(source).dig("jobs", "rollback", "steps").find { |value| value["name"] == "Promote the selected immutable release" }
  env = step.fetch("env")
  ROLLBACK_RUNTIME_SECRETS.each do |name|
    abort "rollback edge promotion must receive #{name}" unless env[name] == "${{ secrets.#{name} }}"
  end
end

cd_path = ".github/workflows/cd.yml"
rollback_path = ".github/workflows/rollback.yml"
cd = workflow(cd_path)
rollback = workflow(rollback_path)
cd_source = File.read(cd_path)
rollback_source = File.read(rollback_path)
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
identity_inputs = %w[component release_run_id source_sha artifact_sha256]
abort "rollback must require an explicit sealed release identity" unless inputs.keys == identity_inputs
components = inputs.dig("component", "options")
abort "rollback surface must contain only deployable Workers" unless components == %w[edge web catalog users]
abort "rollback must share the native CD lock" unless rollback.fetch("concurrency") == deployment_lock
job = rollback.fetch("jobs").fetch("rollback")
abort "rollback must require production approval" unless job.fetch("environment") == "production"
abort "rollback must read only release artifacts" unless job.dig("permissions", "actions") == "read"
abort "rollback must fail closed on an unknown component" unless rollback_source.include?("rollback-ineligible component")
abort "rollback must not alter schema or infrastructure" if rollback_source.match?(/atlas migrate|pulumi (up|destroy)|NEON_DATABASE_URL/)
assert_rollback_source(rollback_source)

puts "Production safety contract: main-only immutable promotion and approved real Worker rollback"
