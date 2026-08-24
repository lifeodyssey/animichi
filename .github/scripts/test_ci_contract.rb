# frozen_string_literal: true

# Single-workflow PR CI contract. Component selection and exact-head behavior
# are tested at their public seams by test_change_plan.py and
# test_pr_verification_contract.rb.
require "yaml"

ROOT = File.expand_path("../..", __dir__)
WORKFLOWS = File.join(ROOT, ".github", "workflows")
CI_PATH = File.join(WORKFLOWS, "pr-verification.yml")
LEGACY = %w[
  ci.yml pipeline-agent.yml pipeline-catalog.yml pipeline-contract.yml
  pipeline-db.yml pipeline-doorbell.yml pipeline-edge.yml pipeline-infra.yml
  pipeline-migrator.yml pipeline-users.yml pipeline-web.yml
].freeze

def load_workflow(path)
  YAML.safe_load(File.read(path).sub(/^on:(?=[ \t#]|$)/, '"on":'), aliases: true)
end

ci = load_workflow(CI_PATH)
abort "PR workflow must be named CI" unless ci.fetch("name") == "CI"
events = ci.fetch("on")
abort "CI must run for pull requests" unless events.key?("pull_request")
abort "CI must run for merge queue candidates" unless events.key?("merge_group")
abort "PR CI must not deploy from push" if events.key?("push")

named_ci = Dir[File.join(WORKFLOWS, "*.yml")].select do |path|
  load_workflow(path).fetch("name", nil) == "CI"
end
abort "expected one top-level CI workflow, got #{named_ci.map { |p| File.basename(p) }}" unless named_ci == [CI_PATH]

present = LEGACY.select { |name| File.exist?(File.join(WORKFLOWS, name)) }
abort "legacy CI workflows remain: #{present.join(', ')}" unless present.empty?

require_relative "test_pr_verification_contract"
assert_pr_verification_contract
require_relative "test_ci_contract_security"
assert_security_contract

puts "CI contract: one affected PR/queue workflow, no legacy pipeline workflows"
