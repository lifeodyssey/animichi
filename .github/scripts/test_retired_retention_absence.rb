#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"

retired_worker_dir = File.join("workers", "jobs")
abort "retired retention Worker directory must not exist" if Dir.exist?(retired_worker_dir)

manifest = JSON.parse(File.read(".github/ci/components.json"))
components = manifest.fetch("components").map { |component| component.fetch("name") }
abort "retired retention Worker must not be a CI/CD component" unless (components & %w[jobs maintenance doorbell]).empty?

cd_source = File.read(".github/workflows/cd.yml")
[retired_worker_dir, "jobs_svc", "AGENT_DATABASE_URL", "deploy-maintenance"].each do |retired|
  abort "CD must not restore retired retention surface: #{retired}" if cd_source.include?(retired)
end

workflow_files = Dir[".github/workflows/*.yml"]
forbidden = %w[purge-anonymous-sessions purge-anon-quota-counts pipeline-maintenance staging-cutover]
forbidden.each do |name|
  abort "retired workflow must not exist: #{name}" if workflow_files.any? { |path| File.basename(path, ".yml") == name }
end

neon_source = File.read("infra/database-access/index.ts")
abort "staging secret provisioning must not restore jobs_svc" if neon_source.include?("jobs_svc")
abort "staging secret provisioning must not restore AGENT_DATABASE_URL" if neon_source.include?("AGENT_DATABASE_URL")

puts "Retention absence contract: retired staging scheduler has no workflow, component, role, credential path, or worker directory"
