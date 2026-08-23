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
#   RED  prefer branch/ref over the PR number in concurrency   -> contract aborts
#   RED  omit any review refresh event from the scope scan      -> contract aborts
#   RED  drop `edited` from pull_request types                 -> contract aborts
#   RED  rename the producer away from Review Gate             -> contract aborts
#   RED  rename the legacy wrapper away from Quality / invariants -> contract aborts
#   RED  drop the legacy wrapper dependency                      -> contract aborts
#   GREEN pristine pipeline-quality.yml                         -> contract passes

require_relative "test_ci_contract_review_gate_mutation_helpers"

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
  "concurrency group prefers branch/ref over PR identity",
  "concurrency group must prefer the PR number before branch/ref fallback",
  mutated_workflow(concurrency_group: "${{ github.workflow }}-${{ github.event.merge_group.head_ref || github.head_ref || github.event.issue.number || github.event.pull_request.number || github.ref }}")
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

scope_probe
green_probe("pristine pipeline-quality.yml")

puts "All test_ci_contract_review_gate mutation probes passed."
