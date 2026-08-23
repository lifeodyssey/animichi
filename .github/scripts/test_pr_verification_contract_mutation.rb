# frozen_string_literal: true

# Mutation probes for issue #1176. Each probe edits a temporary workflow copy;
# the checked-in contract must reject the weakened shape and still pass after
# the temporary copy is discarded.
require "tmpdir"
require "open3"
require_relative "test_pr_verification_contract"

CONTRACT_SCRIPT = File.join(REPO_ROOT, ".github", "scripts", "test_pr_verification_contract.rb")

def run_mutation(source, needle, replacement, expected)
  Dir.mktmpdir("pr-verification-contract-") do |dir|
    path = File.join(dir, "workflow.yml")
    mutated = source.sub(needle, replacement)
    abort "mutation needle was not found: #{expected}" if mutated == source
    File.write(path, mutated)
    _stdout, _stderr, status = run_contract(path)
    abort "mutation was accepted: #{expected}" if status.success?
  end
end

def run_dispatcher_mutation(source, env_name, needle, replacement, expected)
  Dir.mktmpdir("pr-verification-dispatcher-") do |dir|
    path = File.join(dir, "dispatcher.sh")
    mutated = source.sub(needle, replacement)
    abort "mutation needle was not found: #{expected}" if mutated == source
    File.write(path, mutated)
    env = { env_name => path }
    _stdout, _stderr, status = Open3.capture3(env, RbConfig.ruby, CONTRACT_SCRIPT)
    abort "mutation was accepted: #{expected}" if status.success?
  end
end

def assert_pr_verification_mutations
  source = File.read(WORKFLOW)
  run_mutation(source, "needs: [route, package-gate]", "needs: [route]", "aggregator no longer waits for package gates")
  run_mutation(source, "fromJSON(needs.route.outputs.packages)", "'[web]'", "matrix no longer follows affected route")
  run_mutation(source, "pull_request:\n    types:", "issue_comment:\n    types: [created]\n  pull_request:\n    types:", "comment events trigger code gates")
  route_source = File.read(ROUTE)
  run_dispatcher_mutation(route_source, "PR_VERIFICATION_ROUTE", "match_workspace_package", "workspace_match_removed", "routed package matcher removed")
  gate_source = File.read(GATE)
  run_dispatcher_mutation(gate_source, "PR_VERIFICATION_GATE", "|web", "", "web package gate removed")
  puts "PR Verification mutation probes: aggregator edges, routed matrix/package gates, and event boundary are rejected"
end

assert_pr_verification_mutations if $PROGRAM_NAME == __FILE__
