# frozen_string_literal: true

# Red / restore / green mutation probes for the review-gate workflow contract
# (issue #1008 findings 1-3). Each probe takes the REAL pipeline-quality.yml,
# applies exactly one invariant-breaking reorder / concurrency / trigger change
# to a throwaway copy, and proves the contract rejects it (red); the pristine
# workflow then proves the contract accepts it (green). Mutation is the only
# valid green-light proof (docs/ops/review-gate.md §1.7).
#
#   RED  move the pending status after the quality checks      -> contract aborts
#   RED  move the final status before the actionlint gate      -> contract aborts
#   RED  drop pull_request_review / issue_comment from cancel   -> contract aborts
#   RED  drop pull_request_review_comment from cancel          -> contract aborts
#   RED  drop `edited` from pull_request types                 -> contract aborts
#   RED  rename the producer away from Review Gate             -> contract aborts
#   RED  rename the legacy wrapper away from Quality / invariants -> contract aborts
#   RED  drop the legacy wrapper dependency                      -> contract aborts
#   GREEN pristine pipeline-quality.yml                         -> contract passes

require "stringio"
require "tmpdir"
require_relative "test_ci_contract_review_gate"

REAL = File.expand_path("../workflows/pipeline-quality.yml", __dir__)

ORIGINAL_STDOUT = $stdout
ORIGINAL_STDERR = $stderr

def run_contract(path)
  out, err = redirect_capture
  rc = invoke_contract(path)
  restore_capture
  [rc, out.string + err.string]
end

def redirect_capture
  out = StringIO.new
  err = StringIO.new
  $stdout = out
  $stderr = err
  [out, err]
end

def restore_capture
  $stdout = ORIGINAL_STDOUT
  $stderr = ORIGINAL_STDERR
end

def invoke_contract(path)
  assert_review_gate_contract(path)
  0
rescue SystemExit => e
  e.status
end

def fetch_named(steps, name)
  found = steps.find { |step| step.is_a?(Hash) && step["name"] == name }
  raise "no step named #{name}" unless found
  found
end

def insert_after(steps, found, anchor)
  list = steps.dup
  list.delete(found)
  index = list.index(anchor) + 1
  list.insert(index, found)
end

def reorder_steps(steps, find_name, after_name)
  insert_after(steps, fetch_named(steps, find_name), fetch_named(steps, after_name))
end

def apply_reorder(wf, reorder)
  return wf unless reorder
  job = wf.fetch("jobs").fetch("invariants")
  job["steps"] = reorder_steps(job.fetch("steps"), reorder[:name], reorder[:after])
  wf
end

def apply_cancel(wf, cancel_in_progress)
  return wf unless cancel_in_progress
  wf["concurrency"]["cancel-in-progress"] = cancel_in_progress
  wf
end

def apply_pr_types(wf, pr_types)
  return wf unless pr_types
  on_map = wf["on"] || wf[true]
  on_map["pull_request"]["types"] = pr_types
  wf
end

def apply_job_name(wf, job_name, legacy_name, legacy_needs)
  wf.fetch("jobs").fetch("invariants")["name"] = job_name if job_name
  legacy = wf.fetch("jobs").fetch("legacy-quality")
  legacy["name"] = legacy_name if legacy_name
  legacy["needs"] = legacy_needs if legacy_needs
  wf
end

def mutated_workflow(reorder: nil, cancel_in_progress: nil, pr_types: nil, job_name: nil, legacy_name: nil, legacy_needs: nil)
  wf = YAML.safe_load(File.read(REAL))
  wf = apply_reorder(wf, reorder)
  wf = apply_cancel(wf, cancel_in_progress)
  wf = apply_pr_types(wf, pr_types)
  wf = apply_job_name(wf, job_name, legacy_name, legacy_needs)
  wf
end

def red_probe(label, expected_fragment, wf)
  Dir.mktmpdir("rg-mutation-red") do |dir|
    path = File.join(dir, "pipeline-quality.yml")
    File.write(path, YAML.dump(wf))
    rc, out = run_contract(path)
    abort "FAIL: #{label} must be rejected by the contract, got exit #{rc}:\n#{out}" if rc.zero?
    abort "FAIL: #{label} must fail with #{expected_fragment.inspect} in output:\n#{out}" unless out.include?(expected_fragment)
    puts "PASS: #{label} rejected (#{expected_fragment})"
  end
end

def green_probe(label)
  Dir.mktmpdir("rg-mutation-green") do |dir|
    rc, out = run_contract(REAL)
    abort "FAIL: #{label} must pass the contract, got exit #{rc}:\n#{out}" unless rc.zero?
    abort "FAIL: #{label} must produce the one-line summary:\n#{out}" unless out.include?("Review gate:")
    puts "PASS: #{label} (restore/green)"
  end
end

red_probe(
  "pending moved after the quality checks",
  "pending status must precede every quality check step",
  mutated_workflow(reorder: { name: "Post pending review-gate status on the PR head", after: "Run actionlint" })
)

red_probe(
  "final status moved before the actionlint gate",
  "final status must be posted after the actionlint gate",
  mutated_workflow(reorder: { name: "Post final review-gate status on the PR head", after: "Ruby syntax check workflow meta scripts" })
)

red_probe(
  "cancel-in-progress dropped for pull_request_review and issue_comment",
  "must cancel pull_request_review, pull_request_review_comment, issue_comment runs",
  mutated_workflow(cancel_in_progress: "${{ github.event_name == 'pull_request' }}")
)

red_probe(
  "cancel-in-progress dropped for pull_request_review_comment",
  "must cancel pull_request_review_comment runs",
  mutated_workflow(cancel_in_progress: "${{ github.event_name == 'pull_request' || github.event_name == 'pull_request_review' || github.event_name == 'issue_comment' }}")
)

red_probe(
  "pull_request edited type dropped",
  "pull_request must cover edited",
  mutated_workflow(pr_types: %w[opened synchronize reopened])
)

red_probe(
  "Review Gate producer renamed to legacy name",
  "must emit Review Gate",
  mutated_workflow(job_name: "Quality / invariants")
)

red_probe(
  "legacy wrapper renamed to Review Gate",
  "must emit Quality / invariants",
  mutated_workflow(legacy_name: "Review Gate")
)

red_probe(
  "legacy wrapper loses Review Gate dependency",
  "must depend on invariants",
  mutated_workflow(legacy_needs: [])
)

green_probe("pristine pipeline-quality.yml")

puts "All test_ci_contract_review_gate mutation probes passed."
