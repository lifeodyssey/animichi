# frozen_string_literal: true

# CI contract for the S0-v2 B4 end state (CI-1 union method):
#   1. ci.yml is down to verify lanes (credentialed eval/Neon), the security
#      lane, the self-gated cross-stack lane, and the deploy promotion chain —
#      no `changes` aggregation job, no `*-gate` layer.
#   2. Every package owns a pipeline-*.yml with the three-stage naming
#      (lint / test / build; db has lint + build), a pathless pull_request
#      trigger, a merge_group trigger on main, push paths on main, and the
#      template concurrency block.
#   3. Coverage uploads in the pipelines carry the same Codecov guarantees the
#      retired reusable lanes had (OIDC, fail closed).
#   4. Staging deploys gate on the lanes that still live in ci.yml
#      (security + cross-stack e2e); pipeline stages cannot be `needs:`
#      targets across workflows.

require "yaml"

ci = YAML.safe_load(File.read(".github/workflows/ci.yml"))
jobs = ci.fetch("jobs")
ci_source = File.read(".github/workflows/ci.yml")

gates = jobs.keys.grep(/-gate$/)
abort "ci.yml must not contain gate jobs, found: #{gates.join(', ')}" unless gates.empty?
abort "ci.yml must not contain a changes aggregation job" if jobs.key?("changes")
abort "ci.yml must not reference needs.changes" if ci_source.include?("needs.changes")

deploy_needs = Array(jobs.fetch("deploy-staging").fetch("needs"))
expected_lane_needs = %w[security ci-cross-stack-e2e]
missing = expected_lane_needs - deploy_needs
abort "deploy-staging is missing in-file lane dependencies: #{missing.join(', ')}" unless missing.empty?
web_deploy_needs = Array(jobs.fetch("deploy-web-staging").fetch("needs"))
missing = expected_lane_needs - web_deploy_needs
abort "deploy-web-staging is missing in-file lane dependencies: #{missing.join(', ')}" unless missing.empty?

# Staging deploys gate on the lanes that still live in ci.yml via the
# `!failure() && !cancelled()` guard: `failure()` is true when any upstream
# failed, so a failed security/cross-stack run blocks the deploy instead of
# silently skipping it (the bug that kept staging undeployed for three runs).
%w[deploy-staging deploy-web-staging].each do |job_id|
  guard = jobs.fetch(job_id).fetch("if")
  abort "#{job_id} must close the implicit success() with !failure() && !cancelled()" unless guard.include?("!failure()") && guard.include?("!cancelled()")
end

pipelines = {
  "pipeline-web.yml" => ["Web / lint", "Web / test", "Web / build"],
  "pipeline-agent.yml" => ["Agent / lint", "Agent / test", "Agent / build"],
  "pipeline-catalog.yml" => ["Catalog / lint", "Catalog / test", "Catalog / build"],
  "pipeline-users.yml" => ["Users / lint", "Users / test", "Users / build"],
  "pipeline-edge.yml" => ["Edge / lint", "Edge / test", "Edge / build"],
  "pipeline-contract.yml" => ["Contract / lint", "Contract / test", "Contract / build"],
  "pipeline-infra.yml" => ["Infra / lint", "Infra / test", "Infra / build"],
  "pipeline-db.yml" => ["DB / lint", "DB / build"],
  "pipeline-migrator.yml" => ["Migrator / lint", "Migrator / test", "Migrator / build"]
}

# `on:` is a YAML 1.1 boolean, so old psych versions parse it as the key `true`
# instead of the string "on"; accept both spellings.
def triggers(workflow, file)
  value = workflow["on"] || workflow[true]
  abort "#{file} must declare triggers under on:" unless value.is_a?(Hash)
  value
end

pipelines.each do |file, contexts|
  path = ".github/workflows/#{file}"
  workflow = YAML.safe_load(File.read(path))
  on = triggers(workflow, file)
  abort "#{file} must declare a pull_request trigger" unless on.key?("pull_request")
  pull_request = on.fetch("pull_request")
  abort "#{file} must not path-filter pull_request (merge_group compat)" if pull_request.is_a?(Hash) && pull_request.key?("paths")
  abort "#{file} must trigger on merge_group" unless on.key?("merge_group")
  merge_group = on.fetch("merge_group")
  abort "#{file} merge_group must target main" unless merge_group.is_a?(Hash) && Array(merge_group.fetch("branches")) == ["main"]
  abort "#{file} must declare a push trigger" unless on.key?("push")
  push = on.fetch("push")
  abort "#{file} push must target main with paths" unless push.is_a?(Hash) && Array(push.fetch("branches")) == ["main"] && push.key?("paths")
  abort "#{file} must declare top-level permissions" unless workflow.key?("permissions")
  abort "#{file} must declare concurrency" unless workflow.key?("concurrency")

  names = workflow.fetch("jobs").map { |job_id, job| job.fetch("name", job_id) }
  missing = contexts - names
  abort "#{file} is missing stage contexts: #{missing.join(', ')}" unless missing.empty?
end

puts "CI contract: #{pipelines.size} pipelines with #{pipelines.values.sum(&:size)} stage contexts; ci.yml gate-free"

%w[pipeline-agent.yml pipeline-catalog.yml pipeline-users.yml].each do |workflow_name|
  source = File.read(".github/workflows/#{workflow_name}")
  abort "#{workflow_name} must grant Codecov OIDC" unless source.include?("id-token: write")
  abort "#{workflow_name} must fail when Codecov upload fails" unless source.include?("fail_ci_if_error: true")
  abort "#{workflow_name} must use Codecov OIDC" unless source.include?("use_oidc: true")
end

# The web suite moved first (CI-1 union method, 688bfacc); its Codecov upload
# must carry the same guarantees as the retired reusable lane.
web_ci = File.read(".github/workflows/pipeline-web.yml")
abort "pipeline-web.yml must grant Codecov OIDC" unless web_ci.include?("id-token: write")
abort "pipeline-web.yml must fail when Codecov upload fails" unless web_ci.include?("fail_ci_if_error: true")
abort "pipeline-web.yml must use Codecov OIDC" unless web_ci.include?("use_oidc: true")

# ruleset-target producers (S0-v2 B4 fix round 2): every name in
# docs/iterations/s0v2/ruleset-target.json required_checks must be produced by
# some job's check-run, or the merge queue hangs forever on a context that
# never appears (bypass_actors: [] means nobody can clear it either). Reusable
# workflows are producers only through their callers: GitHub names a reusable
# job's check-run "<caller display name> / <callee job name>" (display name =
# job `name:`, else the job id). This assertion is what caught the unprefixed
# security contexts of the first ruleset draft.
def producer_contexts(workflow_file)
  workflow = YAML.safe_load(File.read(workflow_file))
  workflow.fetch("jobs").map do |job_id, job|
    display = job.fetch("name", job_id)
    callee = job["uses"]
    next [display] unless callee&.start_with?("./.github/workflows/reusable-")

    reusable = YAML.safe_load(File.read(callee.delete_prefix("./")))
    reusable.fetch("jobs").map do |callee_id, callee_job|
      "#{display} / #{callee_job.fetch("name", callee_id)}"
    end
  end.flatten
end

ruleset = YAML.safe_load(File.read("docs/iterations/s0v2/ruleset-target.json"))
required = Array(ruleset.fetch("required_checks"))
producers = Dir[".github/workflows/*.yml"]
  .reject { |file| File.basename(file).start_with?("reusable-") }
  .flat_map { |file| producer_contexts(file) }
orphans = required - producers
abort "ruleset-target.json required checks with no producing job: #{orphans.join(', ')}" unless orphans.empty?

puts "Ruleset target: #{required.size} required checks all have a producing job (#{producers.size} producer contexts)"

require_relative "test_ci_contract_infra_split"

# Issue #1008 (review gate, docs/ops/review-gate.md §7): the PR comment gate is
# wired into the already-required `Quality / invariants` job. The workflow
# independently checks the current PR's active unresolved review threads,
# top-level managed findings, snapshot-bound acknowledgement, and the
# head/base/brief-bound human review-approval marker — check runs WITHOUT
# --verdict, and the head-bound status contract (resolve once -> pending before
# the quality steps -> collect/check against the pinned head -> final status
# with if: always() as the last step, whole-job outcome) is asserted in
# test_ci_contract_review_gate.rb, whose red/restore/green mutation probes live
# in test_ci_contract_review_gate_mutation.rb.
require_relative "test_ci_contract_review_gate"
require_relative "test_ci_contract_review_gate_mutation"