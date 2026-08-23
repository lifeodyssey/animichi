# frozen_string_literal: true

# Issue #1008 review-gate CI contract (docs/ops/review-gate.md §7): the
# head-bound status contract for pipeline-quality.yml `Review Gate`.
# Usage: ruby test_ci_contract_review_gate.rb [WORKFLOW_PATH]

require "yaml"
require "json"
require_relative "test_ci_contract_review_gate_steps"

QUALITY_YML = ".github/workflows/pipeline-quality.yml"
REVIEW_REFRESH_EVENTS = %w[pull_request_review pull_request_review_comment issue_comment].freeze

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
  assert_producer_name(invariants, quality_yml)
  assert_legacy_wrapper(quality.fetch("jobs"), quality_yml)
  assert_job_permissions(invariants, quality_yml)
  assert_trigger_contract(quality, quality_yml)
  resolve, pending, gate, final = assert_head_status_steps(invariants, quality_yml)
  assert_step_order(invariants.fetch("steps"), resolve, pending, gate, final, quality_yml)
  assert_repo_contract_artifacts
  review_gate_summary(quality_yml)
end

def assert_producer_name(invariants, quality_yml)
  expected = "Review Gate"
  actual = invariants.fetch("name")
  abort "#{quality_yml} invariants job must emit #{expected}, got #{actual.inspect}" unless actual == expected
end

def assert_legacy_wrapper(jobs, quality_yml)
  wrapper = jobs.fetch("legacy-quality")
  abort "#{quality_yml} legacy-quality job must emit Quality / invariants" unless wrapper.fetch("name") == "Quality / invariants"
  abort "#{quality_yml} legacy-quality job must depend on invariants" unless Array(wrapper.fetch("needs")) == ["invariants"]
  abort "#{quality_yml} legacy-quality job must run after cancellation/failure" unless wrapper.fetch("if").include?("always()")
  step = wrapper.fetch("steps").fetch(0)
  abort "#{quality_yml} legacy-quality wrapper must mirror needs.invariants.result" unless step.fetch("run").include?("REVIEW_GATE_RESULT") && step.fetch("env").fetch("REVIEW_GATE_RESULT").include?("needs.invariants.result")
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
  assert_concurrency_group(quality, quality_yml)
  assert_concurrency_cancellation(quality, quality_yml)
  assert_review_refresh_scope(quality_yml)
end

def assert_concurrency_group(quality, quality_yml)
  group = quality.fetch("concurrency").fetch("group")
  expected = "${{ github.workflow }}-${{ github.event.merge_group.head_ref || github.event.pull_request.number || github.event.issue.number || github.head_ref || github.ref }}"
  abort "#{quality_yml} concurrency group must prefer the PR number before branch/ref fallback" unless group == expected
end

def assert_review_refresh_scope(quality_yml)
  workflow_dir = ENV.fetch("REVIEW_GATE_WORKFLOWS_DIR", File.expand_path("../workflows", __dir__))
  offenders = workflow_paths(workflow_dir).reject { |path| File.basename(path) == "pipeline-quality.yml" }.select { |path| review_events?(path) }
  abort "#{quality_yml} review/comment refresh events must stay in pipeline-quality.yml (found #{offenders.map { |path| File.basename(path) }.join(', ')})" unless offenders.empty?
end

def workflow_paths(workflow_dir)
  ["*.yml", "*.yaml"].flat_map { |pattern| Dir[File.join(workflow_dir, pattern)] }
end

def review_events?(path)
  workflow = YAML.safe_load(File.read(path))
  on_declaration = workflow["on"] || workflow[true]
  events = case on_declaration
           when Hash then on_declaration.keys
           when Array then on_declaration
           when String then [on_declaration]
           else []
           end
  events.any? { |event| REVIEW_REFRESH_EVENTS.include?(event.to_s) }
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
  cutover = JSON.parse(File.read("docs/iterations/s0v2/ruleset-cutover-target.json"))
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

def review_gate_summary(quality_yml)
  puts "Review gate: #{quality_yml} `Review Gate` resolves the PR head once, posts pending before the quality steps, runs pr-review-check collect + check against the pinned head (merge-base base, no local verdict), posts final status with if: always(), and mirrors its result to the legacy `Quality / invariants` wrapper until cutover"
end

assert_review_gate_contract(ARGV[0] || QUALITY_YML) if $PROGRAM_NAME == __FILE__
