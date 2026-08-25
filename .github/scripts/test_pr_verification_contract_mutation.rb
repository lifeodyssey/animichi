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
  full_needs = "needs: [route, static-quality, security, affected, coverage-agent, coverage-web, coverage-catalog, coverage-users, cross-stack]"
  run_mutation(source, full_needs, "needs: [route]", "aggregator no longer waits for all CI lanes")
  run_mutation(source, "    name: PR Verification\n", "    name: Legacy Verification\n", "required PR context no longer names the aggregate")
  run_mutation(source, "fromJSON(needs.route.outputs.components)", "'[web]'", "matrix no longer follows affected route")
  run_mutation(source, '--range "$range"', '--range "$range" --purpose deploy', "PR/queue route drops test triggers")
  run_mutation(source, "pull_request:\n    types:", "issue_comment:\n    types: [created]\n  pull_request:\n    types:", "comment events trigger code gates")
  run_mutation(source, "matrix.component == 'agent' || matrix.component == 'db' || matrix.component == 'catalog'", "matrix.component == 'agent' || matrix.component == 'db'", "catalog gate no longer builds the hermetic Postgres image")
  run_mutation(source, "matrix.component == 'db' || matrix.component == 'catalog'", "matrix.component == 'db'", "catalog gate no longer installs Atlas")
  run_mutation(source, "          PR_VERIFICATION_CHECKOUT_SHA: ${{ github.sha }}\n", "", "synthetic checkout identity removed")
  source_head = "          PR_VERIFICATION_SOURCE_HEAD_SHA: ${{ github.event.pull_request.head.sha || github.event.merge_group.head_sha }}\n"
  run_mutation(source, source_head, "", "PR/queue source-head identity removed")
  route_source = File.read(ROUTE)
  run_dispatcher_mutation(route_source, "PR_VERIFICATION_ROUTE", "change-plan.py", "change-plan-removed.py", "manifest planner removed")
  gate_source = File.read(GATE)
  run_dispatcher_mutation(gate_source, "PR_VERIFICATION_GATE", "|web", "", "web package gate removed")
  run_dispatcher_mutation(gate_source, "PR_VERIFICATION_GATE", 'cd "$ROOT"', "cd /", "dispatcher no longer anchors gates to its repository")
  run_dispatcher_mutation(gate_source, "PR_VERIFICATION_GATE", 'merge-base --is-ancestor "$source_head" "$checkout"', 'merge-base --is-ancestor "$checkout" "$checkout"', "source head ancestry validation removed")
  run_dispatcher_mutation(gate_source, "PR_VERIFICATION_GATE", 'git merge-base "$source_head" "$base"', 'git merge-base "$checkout" "$base"', "baseline switched to synthetic checkout")
  puts "PR Verification mutation probes: aggregator edges, routed matrix/package gates, and event boundary are rejected"
end

assert_pr_verification_mutations if $PROGRAM_NAME == __FILE__
