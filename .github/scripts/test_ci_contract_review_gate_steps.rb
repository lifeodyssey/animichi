# frozen_string_literal: true

# Step-level assertions for the issue #1008 review-gate CI contract
# (docs/ops/review-gate.md §7). Split from test_ci_contract_review_gate.rb so
# every review-gate test file stays under 200 lines; loaded via require_relative
# by the single entry (test_ci_contract_review_gate.rb) CI already runs.

require "json"
require "yaml"

# CI contract must keep GitHub template expressions in env, never inline in run
# (repo rule: all expressions arrive via env: — zizmor template-injection gate).
def env_mapped?(env, var, expression)
  key = var.sub(/\A\$/, "")
  line = env.split("\n").find { |entry| entry.start_with?("#{key}=${{") }
  !line.nil? && line.include?(expression) && line.end_with?("}}")
end

def assert_env_mapping(step, run, vars, expressions, message_prefix)
  env = Array(step["env"]).map { |name, value| "#{name}=#{value}" }.join("\n")
  abort "#{message_prefix} run must not inline template expressions" if run.include?("${{")
  missing = vars.reject { |var| run.include?(var) }
  abort "#{message_prefix} run must pass #{missing.join(', ')} from env" unless missing.empty?
  pairs = vars.zip(expressions).reject { |var, expression| env_mapped?(env, var, expression) }
  abort "#{message_prefix} env must map #{pairs.map { |var, expression| "#{var} to #{expression}" }.join(', ')}" unless pairs.empty?
end

def assert_resolve_head_step(steps, quality_yml)
  resolve = steps.find { |step| step.fetch("id", "") == "review-gate-head" }
  abort "#{quality_yml} must resolve the PR review-gate head early (id: review-gate-head)" if resolve.nil?
  missing = %w[pull_request pull_request_review pull_request_review_comment issue_comment].reject { |event| resolve.fetch("if").include?(event) }
  abort "#{quality_yml} head-resolution must run on #{missing.join('/')} events" unless missing.empty?
  resolve_run = resolve.fetch("run")
  abort "#{quality_yml} head-resolution run must invoke pr-review-gate-step.sh resolve-head and expose the head via GITHUB_OUTPUT" unless resolve_run.include?("resolve-head") && resolve_run.include?("GITHUB_OUTPUT")
  assert_env_mapping(resolve, resolve_run, %w[$EVENT_NAME $REPO $PR_NUMBER $ISSUE_NUMBER $ISSUE_PULL_URL], %w[github.event_name github.event.repository.full_name github.event.pull_request.number github.event.issue.number github.event.issue.pull_request.url], "#{quality_yml} head-resolution")
  resolve
end

def assert_pending_status_step(steps, quality_yml)
  pending_steps = steps.select { |step| step.fetch("run", "").include?("pending") && step.fetch("run", "").include?("pr-review-check.sh status") }
  abort "#{quality_yml} must post the pending review-gate status on the PR head" if pending_steps.empty?
  pending = pending_steps.fetch(0)
  abort "#{quality_yml} pending status must run only when a PR head was resolved" unless pending.fetch("if").include?("review-gate-head.outputs.has_pr")
  pending_run = pending.fetch("run")
  abort "#{quality_yml} pending status run must use the required ruleset context and pass $REPO / $HEAD_SHA from env" unless pending_run.include?("pending") && pending_run.include?("$REPO") && pending_run.include?("$HEAD_SHA")
  assert_env_mapping(pending, pending_run, %w[$REPO $HEAD_SHA], %w[github.event.repository.full_name review-gate-head.outputs.head_sha], "#{quality_yml} pending status")
  pending
end

def assert_gate_step(steps, quality_yml)
  gate = steps.select { |step| step.fetch("run", "").include?("collect-check") }.first
  abort "#{quality_yml} invariants job must run the required PR review gate step without continue-on-error" if gate.nil? || gate["continue-on-error"] == true
  abort "#{quality_yml} PR gate step must run only when a PR head was resolved and provide GH_TOKEN" unless gate.fetch("if").include?("review-gate-head.outputs.has_pr") && gate.fetch("env").fetch("GH_TOKEN") == "${{ github.token }}"
  gate_run = gate.fetch("run")
  abort "#{quality_yml} PR gate step run must delegate collect-check" unless gate_run.include?("collect-check")
  abort "#{quality_yml} PR gate step must not read the local verdict artifact" if gate_run.include?("--verdict")
  assert_env_mapping(gate, gate_run, %w[$REPO $HEAD_SHA $EVENT_NAME $PR_NUMBER $ISSUE_NUMBER $ISSUE_PULL_URL], %w[github.event.repository.full_name review-gate-head.outputs.head_sha github.event_name github.event.pull_request.number github.event.issue.number github.event.issue.pull_request.url], "#{quality_yml} PR gate step")
  gate
end

def assert_final_status_step(steps, quality_yml)
  final_steps = steps.select { |step| step.fetch("run", "").include?("final-status") }
  abort "#{quality_yml} must post the final review-gate status on the PR head" if final_steps.empty?
  final = final_steps.fetch(0)
  abort "#{quality_yml} final status must use if: always() semantics" unless final.fetch("if").include?("always()")
  final_run = final.fetch("run")
  abort "#{quality_yml} final status run must pass $REPO / $HEAD_SHA / $JOB_STATUS / $GATE_STATE from env" unless final_run.include?("$REPO") && final_run.include?("$HEAD_SHA") && final_run.include?("$JOB_STATUS") && final_run.include?("$GATE_STATE")
  assert_env_mapping(final, final_run, %w[$REPO $HEAD_SHA $JOB_STATUS $GATE_STATE], %w[github.event.repository.full_name review-gate-head.outputs.head_sha job.status steps.review-gate.outputs.gate_state], "#{quality_yml} final status")
  final
end

def assert_repo_contract_artifacts
  ruleset = YAML.safe_load(File.read("docs/iterations/s0v2/ruleset-target.json"))
  required = Array(ruleset.fetch("required_checks"))
  cutover = JSON.parse(File.read("docs/iterations/s0v2/ruleset-cutover-target.json"))
  abort "ruleset-target.json must match the three post-cutover contexts" unless required == cutover.fetch("required_checks")
  abort "ruleset-target.json must require Review Gate" unless required.include?("Review Gate")
  abort "ruleset-target.json must retire Quality / invariants" if required.include?("Quality / invariants")
  producer = cutover.fetch("producer_jobs").fetch("Review Gate")
  abort "ruleset-cutover target must name Review Gate as the producer" unless producer.fetch("name") == "Review Gate"
  abort "ruleset-cutover target must point Review Gate at invariants" unless producer.fetch("job_id") == "invariants"
  assert_step_source_contract
  assert_check_source_contract
end

def assert_step_source_contract
  source = File.read("scripts/local-gates/pr-review-gate-step.sh")
  abort "pr-review-gate-step.sh must resolve the exact PR head (headRefOid)" unless source.include?("--json headRefOid")
  abort "pr-review-gate-step.sh must expose resolve-head / collect-check / final-status" unless source.include?("resolve-head") && source.include?("collect-check") && source.include?("final-status")
  abort "pr-review-gate-step.sh must reject an advanced PR head (finding 2)" unless source.include?("PR head advanced since resolution")
  abort "pr-review-gate-step.sh must never reference GITHUB_SHA" if source.include?("GITHUB_SHA")
  abort "pr-review-gate-step.sh must skip events without a PR" unless source.include?("skipping review gate")
end

def assert_check_source_contract
  gate_source = File.read("scripts/local-gates/pr-review-check.sh")
  abort "pr-review-check.sh must post Review Gate on the resolved head" unless gate_source.include?("/statuses/$2") && gate_source.include?("STATUS_CONTEXT='Review Gate'")
  abort "pr-review-check.sh collect must accept the pinned head and resolve the real merge-base" unless gate_source.include?("--pinned-head") && gate_source.include?("/compare/")
  abort "pr-review-check.sh collect must read the PR body for the canonical brief-digest record" unless gate_source.include?("--json body") && gate_source.include?("brief_digest.json")
  brief_source = File.read("scripts/local-gates/brief_record.py")
  abort "brief_record.py must extract and fail closed on duplicate review-gate brief records" unless brief_source.include?("review-gate") && brief_source.include?("multiple review-gate brief records")
end
