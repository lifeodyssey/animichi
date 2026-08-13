# frozen_string_literal: true

# Issue #1008 review-gate CI contract (docs/ops/review-gate.md §7): the
# head-bound status contract for pipeline-quality.yml `Quality / invariants`.
# Usage: ruby test_ci_contract_review_gate.rb [WORKFLOW_PATH]

require "yaml"

QUALITY_YML = ".github/workflows/pipeline-quality.yml"

# `on:` is a YAML 1.1 boolean; old psych parses it as the key `true`. Accept both.
def triggers(workflow, file)
  value = workflow["on"] || workflow[true]
  abort "#{file} must declare triggers under on:" unless value.is_a?(Hash)
  value
end

# Quality steps between the pending status and the collect+check gate.
def quality_check_steps(steps)
  gate_names = [
    "Resolve PR review-gate head",
    "Post pending review-gate status on the PR head",
    "Post final review-gate status on the PR head",
  ]
  steps.reject { |step| !step.is_a?(Hash) || step["name"].to_s.empty? || gate_names.include?(step["name"]) }
end

def assert_review_gate_contract(quality_yml)
  quality = YAML.safe_load(File.read(quality_yml))
  invariants = quality.fetch("jobs").fetch("invariants")
  assert_job_permissions(invariants, quality_yml)
  assert_trigger_contract(quality, quality_yml)
  resolve, pending, gate, final = assert_head_status_steps(invariants, quality_yml)
  assert_step_order(invariants.fetch("steps"), resolve, pending, gate, final, quality_yml)
  assert_repo_contract_artifacts
  review_gate_summary(quality_yml)
end

def assert_job_permissions(invariants, quality_yml)
  perms = invariants.fetch("permissions")
  abort "#{quality_yml} invariants job must keep contents: read" unless perms.fetch("contents") == "read"
  abort "#{quality_yml} invariants job must grant pull-requests: read" unless perms.fetch("pull-requests") == "read"
  abort "#{quality_yml} invariants job must grant statuses: write (head-bound status)" unless perms.fetch("statuses") == "write"
end

def assert_trigger_contract(quality, quality_yml)
  assert_event_triggers(quality, quality_yml)
  assert_thread_comment_triggers(quality, quality_yml)
  assert_concurrency_cancellation(quality, quality_yml)
end

def assert_event_triggers(quality, quality_yml)
  on_map = triggers(quality, quality_yml)
  review = on_map["pull_request_review"]
  abort "#{quality_yml} must trigger on pull_request_review covering submitted/edited/dismissed" unless review.is_a?(Hash) && review.fetch("types").sort == %w[dismissed edited submitted].sort
  pr = on_map["pull_request"]
  pr_types = pr.is_a?(Hash) ? Array(pr.fetch("types", [])) : []
  abort "#{quality_yml} pull_request must cover edited and the default activity types" unless pr.is_a?(Hash) && pr_types.include?("edited") && (pr_types & %w[opened synchronize reopened]).sort == %w[opened reopened synchronize].sort
end

def assert_thread_comment_triggers(quality, quality_yml)
  on_map = triggers(quality, quality_yml)
  thread = on_map["pull_request_review_comment"]
  abort "#{quality_yml} must trigger on pull_request_review_comment" unless thread.is_a?(Hash)
  abort "#{quality_yml} pull_request_review_comment must cover created/edited/deleted" unless thread.fetch("types").sort == %w[created deleted edited].sort
  comment = on_map["issue_comment"]
  abort "#{quality_yml} must trigger on issue_comment" unless comment.is_a?(Hash)
  abort "#{quality_yml} issue_comment must cover created/edited/deleted" unless comment.fetch("types").sort == %w[created deleted edited].sort
end

def assert_concurrency_cancellation(quality, quality_yml)
  cancel = quality.fetch("concurrency").fetch("cancel-in-progress")
  missing = %w[pull_request pull_request_review pull_request_review_comment issue_comment].reject { |event| cancel.include?("'#{event}'") }
  abort "#{quality_yml} concurrency must cancel #{missing.join(', ')} runs (finding 2)" unless missing.empty?
  abort "#{quality_yml} concurrency must not cancel merge_group runs" if cancel.include?("'merge_group'")
  abort "#{quality_yml} concurrency must not cancel push runs" if cancel.include?("'push'")
end

def assert_head_status_steps(invariants, quality_yml)
  steps = invariants.fetch("steps").select { |step| step.is_a?(Hash) }
  resolve = assert_resolve_head_step(steps, quality_yml)
  pending = assert_pending_status_step(steps, quality_yml)
  gate = assert_gate_step(steps, quality_yml)
  final = assert_final_status_step(steps, quality_yml)
  [resolve, pending, gate, final]
end

def assert_resolve_head_step(steps, quality_yml)
  resolve = steps.find { |step| step.fetch("id", "") == "review-gate-head" }
  abort "#{quality_yml} must resolve the PR review-gate head early (id: review-gate-head)" if resolve.nil?
  resolve_if = resolve.fetch("if")
  missing = %w[pull_request pull_request_review pull_request_review_comment issue_comment].reject { |event| resolve_if.include?(event) }
  abort "#{quality_yml} head-resolution must run on #{missing.join('/')} events" unless missing.empty?
  resolve_run = resolve.fetch("run")
  abort "#{quality_yml} head-resolution must run pr-review-gate-step.sh resolve-head, pass the event PR number / issue URL, and expose the head via GITHUB_OUTPUT" unless resolve_run.include?("resolve-head") && resolve_run.include?("pull_request.number") && resolve_run.include?("issue.number") && resolve_run.include?("issue.pull_request.url") && resolve_run.include?("GITHUB_OUTPUT")
  resolve
end

def assert_pending_status_step(steps, quality_yml)
  pending_steps = steps.select { |step| step.fetch("run", "").include?("pending") && step.fetch("run", "").include?("pr-review-check.sh status") }
  abort "#{quality_yml} must post the pending review-gate status on the PR head" if pending_steps.empty?
  pending = pending_steps.fetch(0)
  abort "#{quality_yml} pending status must run only when a PR head was resolved" unless pending.fetch("if").include?("review-gate-head.outputs.has_pr")
  pending_run = pending.fetch("run")
  abort "#{quality_yml} pending status must target the pinned head_sha" unless pending_run.include?("review-gate-head.outputs.head_sha")
  abort "#{quality_yml} pending status must use the required ruleset context" unless pending_run.include?("pending")
  pending
end

def assert_gate_step(steps, quality_yml)
  gate_steps = steps.select { |step| step.fetch("run", "").include?("collect-check") }
  gate = gate_steps.fetch(0, {})
  abort "#{quality_yml} invariants job must run the required PR review gate step without continue-on-error" if gate_steps.empty? || gate["continue-on-error"] == true
  abort "#{quality_yml} PR gate step must run only when a PR head was resolved and provide GH_TOKEN" unless gate.fetch("if").include?("review-gate-head.outputs.has_pr") && gate.fetch("env").fetch("GH_TOKEN") == "${{ github.token }}"
  gate_run = gate.fetch("run")
  abort "#{quality_yml} PR gate step must delegate collect-check with the pinned head_sha, passing the event PR number / issue URL / event name" unless gate_run.include?("collect-check") && gate_run.include?("review-gate-head.outputs.head_sha") && gate_run.include?("pull_request.number") && gate_run.include?("issue.number") && gate_run.include?("issue.pull_request.url") && gate_run.include?("github.event_name")
  abort "#{quality_yml} PR gate step must not read the local verdict artifact" if gate_run.include?("--verdict")
  gate
end

def assert_final_status_step(steps, quality_yml)
  final_steps = steps.select { |step| step.fetch("run", "").include?("final-status") }
  abort "#{quality_yml} must post the final review-gate status on the PR head" if final_steps.empty?
  final = final_steps.fetch(0)
  abort "#{quality_yml} final status must use if: always() semantics" unless final.fetch("if").include?("always()")
  final_run = final.fetch("run")
  abort "#{quality_yml} final status must derive from the whole-job outcome (job.status), not just the gate step (finding 1)" unless final_run.include?("job.status")
  abort "#{quality_yml} final status must target the pinned head_sha" unless final_run.include?("review-gate-head.outputs.head_sha")
  final
end

def assert_step_order(step_list, resolve, pending, gate, final, quality_yml)
  assert_pending_before_gate(step_list, resolve, pending, gate, quality_yml)
  assert_final_is_last(step_list, final, quality_yml)
end

def assert_pending_before_gate(step_list, resolve, pending, gate, quality_yml)
  abort "#{quality_yml} pending status must be posted after head resolution" unless step_list.index(resolve) < step_list.index(pending)
  steps = step_list.select { |step| step.is_a?(Hash) }
  first_quality = quality_check_steps(steps).first
  first_index = first_quality.nil? ? step_list.index(gate) : step_list.index(first_quality)
  abort "#{quality_yml} pending status must precede every quality check step (finding 3)" unless step_list.index(pending) < first_index
  abort "#{quality_yml} pending status must precede the gate collect+check step" unless step_list.index(pending) < step_list.index(gate)
end

def assert_final_is_last(step_list, final, quality_yml)
  actionlint_index = last_actionlint_index(step_list)
  if actionlint_index
    abort "#{quality_yml} final status must be posted after the actionlint gate (finding 1)" unless actionlint_index < step_list.index(final)
  end
  abort "#{quality_yml} final status must be the last step of the job (finding 1)" unless step_list.index(final) == step_list.length - 1
end

def last_actionlint_index(step_list)
  steps = step_list.select { |step| step.is_a?(Hash) }
  actionlint_steps = steps.select { |step| step.fetch("run", "").include?("actionlint") }
  return nil if actionlint_steps.empty?
  step_list.index(actionlint_steps.last)
end

def assert_repo_contract_artifacts
  ruleset = YAML.safe_load(File.read("docs/iterations/s0v2/ruleset-target.json"))
  required = Array(ruleset.fetch("required_checks"))
  abort "ruleset-target.json must require Quality / invariants (the status context)" unless required.include?("Quality / invariants")
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
  abort "pr-review-check.sh status must post the required ruleset context on the resolved head" unless gate_source.include?("/statuses/$2") && gate_source.include?("STATUS_CONTEXT='Quality / invariants'")
  abort "pr-review-check.sh collect must accept the pinned head and resolve the real merge-base" unless gate_source.include?("--pinned-head") && gate_source.include?("/compare/")
  abort "pr-review-check.sh collect must read the PR body for the canonical brief-digest record" unless gate_source.include?("--json body") && gate_source.include?("brief_digest.json")
  brief_source = File.read("scripts/local-gates/brief_record.py")
  abort "brief_record.py must extract and fail closed on duplicate review-gate brief records" unless brief_source.include?("review-gate") && brief_source.include?("multiple review-gate brief records")
end

def review_gate_summary(quality_yml)
  puts "Review gate: #{quality_yml} `Quality / invariants` resolves the PR head once, posts pending before the quality steps, runs pr-review-check collect + check against the pinned head (merge-base base, no local verdict), and posts the final success/failure with if: always() as the last step on pull_request / review / thread-comment / issue-comment events"
end

assert_review_gate_contract(ARGV[0] || QUALITY_YML) if $PROGRAM_NAME == __FILE__
