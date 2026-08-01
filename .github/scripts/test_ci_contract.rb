# frozen_string_literal: true

require "yaml"

workflow = YAML.safe_load(File.read(".github/workflows/ci.yml"))
jobs = workflow.fetch("jobs")

expected = {
  "web-ci-gate" => "Web CI",
  "backend-ci-gate" => "Backend CI",
  "agent-ci-gate" => "Agent CI",
  "infra-db-ci-gate" => "Infra & DB CI",
  "cross-stack-e2e-gate" => "Cross-stack E2E",
  "repository-quality-gate" => "Repository Quality",
  "codecov-patch-gate" => "Codecov Patch"
}

expected.each do |job_id, name|
  job = jobs.fetch(job_id)
  abort "#{job_id} must expose '#{name}'" unless job.fetch("name") == name
  abort "#{job_id} must always run to publish a required context" unless job.fetch("if").include?("always()")
end

deploy_needs = Array(jobs.fetch("deploy-staging").fetch("needs"))
missing = expected.keys - deploy_needs
abort "deploy-staging is missing stable lanes: #{missing.join(', ')}" unless missing.empty?

cross_stack = jobs.fetch("changes").fetch("outputs").fetch("cross_stack")
abort "changes must expose cross_stack output" unless cross_stack.include?("cross_stack")

puts "CI contract: seven stable lanes and staging dependencies are present"
