#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"

jobs_toml = File.read("workers/jobs/wrangler.toml")
abort "retired retention Worker must not have a staging environment" if jobs_toml.include?("[env.staging]")

manifest = JSON.parse(File.read(".github/ci/components.json"))
components = manifest.fetch("components").map { |component| component.fetch("name") }
abort "retired retention Worker must not be a CI/CD component" unless (components & %w[jobs maintenance doorbell]).empty?

cd_source = File.read(".github/workflows/cd.yml")
%w[workers/jobs jobs_svc AGENT_DATABASE_URL deploy-maintenance].each do |retired|
  abort "CD must not restore retired retention surface: #{retired}" if cd_source.include?(retired)
end

workflow_files = Dir[".github/workflows/*.yml"]
forbidden = %w[purge-anonymous-sessions purge-anon-quota-counts pipeline-maintenance staging-cutover]
forbidden.each do |name|
  abort "retired workflow must not exist: #{name}" if workflow_files.any? { |path| File.basename(path, ".yml") == name }
end

neon_source = File.read("infra/neon-secrets/index.ts")
abort "staging secret provisioning must not restore jobs_svc" if neon_source.include?("jobs_svc")
abort "staging secret provisioning must not restore AGENT_DATABASE_URL" if neon_source.include?("AGENT_DATABASE_URL")

puts "Retention absence contract: retired staging scheduler has no workflow, component, role, or credential path"
