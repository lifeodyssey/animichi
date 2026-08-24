# frozen_string_literal: true

# Red / restore / green probes for issue #1180. Every red probe mutates a
# throwaway candidate and proves the cutover contract refuses the hazard.

require "json"
require_relative "ruleset_cutover"

def fail_probe(message)
  abort "FAIL: #{message}"
end

def expect_rejected(label, fragment)
  yield
  fail_probe "#{label} was accepted"
rescue RulesetCutover::Error => error
  fail_probe "#{label} did not mention #{fragment.inspect}: #{error.message}" unless error.message.include?(fragment)
  puts "PASS red: #{label}"
end

def source_ruleset
  {
    "id" => 42,
    "name" => "protect main",
    "target" => "branch",
    "source_type" => "Repository",
    "enforcement" => "active",
    "bypass_actors" => [],
    "conditions" => { "ref_name" => { "include" => ["~DEFAULT_BRANCH"], "exclude" => [] } },
    "rules" => [
      { "type" => "deletion" },
      { "type" => "pull_request", "parameters" => {
        "dismiss_stale_reviews_on_push" => false, "require_code_owner_review" => false,
        "require_last_push_approval" => false, "required_approving_review_count" => 0,
        "required_review_thread_resolution" => false
      } },
      { "type" => "required_status_checks", "parameters" => {
        "strict_required_status_checks_policy" => true,
        "required_status_checks" => [{ "context" => "Web / test" }, { "context" => "Security / Semgrep" }]
      } }
    ]
  }
end

expect_rejected("missing Review Gate", "missing approved contexts") do
  RulesetCutover.validate_contexts!(["CI / verify"])
end

expect_rejected("duplicate Review Gate", "duplicate contexts") do
  RulesetCutover.validate_contexts!(["CI / verify", "Review Gate", "Review Gate"])
end

expect_rejected("old per-lane context", "unexpected contexts") do
  RulesetCutover.validate_contexts!(["CI / verify", "Security / Semgrep", "Review Gate"])
end

before = source_ruleset
candidate = RulesetCutover.candidate(before)
candidate["enforcement"] = "disabled"
expect_rejected("enforcement drift", "protected ruleset field enforcement") do
  RulesetCutover.assert_preserved!(before, candidate)
end

candidate = RulesetCutover.candidate(before)
candidate["rules"].first["type"] = "non_fast_forward"
expect_rejected("unrelated rule replacement", "non-required-status rule") do
  RulesetCutover.assert_preserved!(before, candidate)
end

candidate = RulesetCutover.candidate(before).merge("actions_permissions" => { "enabled" => false })
expect_rejected("Actions settings mutation", "Actions settings") do
  RulesetCutover.payload(candidate)
end

green = RulesetCutover.candidate(before)
RulesetCutover.validate_ruleset!(green, approved: true)
RulesetCutover.assert_preserved!(before, green)
puts "PASS green: pristine candidate validates and preserves the old ruleset"

expect_rejected("disabled native review-thread resolution", "review-thread resolution") do
  mutation = RulesetCutover.deep_copy(green)
  mutation.fetch("rules").find { |rule| rule["type"] == "pull_request" }.fetch("parameters")["required_review_thread_resolution"] = false
  RulesetCutover.validate_ruleset!(mutation, approved: true)
end

expect_rejected("unbound Review Gate source", "integration") do
  mutation = RulesetCutover.deep_copy(green)
  RulesetCutover.required_rule(mutation).last.find { |check| check["context"] == "Review Gate" }.delete("integration_id")
  RulesetCutover.validate_ruleset!(mutation, approved: true)
end

expect_rejected("native code coverage residue", "retired native rules remain") do
  mutation = RulesetCutover.deep_copy(green)
  mutation["rules"] << { "type" => "code_coverage", "parameters" => { "min_coverage" => 90 } }
  RulesetCutover.validate_ruleset!(mutation, approved: true)
end

def statuses(sha, event, ci_run_id)
  RulesetCutover::APPROVED_CONTEXTS.each_with_index.to_h do |context, index|
    type = context == RulesetCutover::CI_CONTEXT ? "check_run" : "commit_status"
    [context, { "type" => type, "id" => 100 + index, "state" => "success", "target_sha" => sha,
                "integration_id" => context == RulesetCutover::REVIEW_CONTEXT ? RulesetCutover::GITHUB_ACTIONS_INTEGRATION_ID : nil,
                "run" => { "id" => context == RulesetCutover::CI_CONTEXT ? ci_run_id : 200 + index,
                           "path" => RulesetCutover::PRODUCER_PATHS.fetch(context),
                           "event" => context == RulesetCutover::CI_CONTEXT ? event : "workflow_run",
                           "head_sha" => context == RulesetCutover::CI_CONTEXT ? sha : "d" * 40,
                           "head_branch" => context == RulesetCutover::CI_CONTEXT ? "feature" : "main" } }]
  end
end

canary = {
  "schema_version" => RulesetCutover::CANARY_SCHEMA, "repository" => "example/repo", "ruleset_id" => 42,
  "observed_at" => "2026-08-24T00:00:00Z", "default_branch" => "main",
  "pull_request" => { "number" => 999, "head_sha" => "a" * 40, "statuses" => statuses("a" * 40, "pull_request", 250) },
  "merge_group" => { "ci_run_id" => 300, "head_sha" => "b" * 40, "statuses" => statuses("b" * 40, "merge_group", 300) }
}
options = { repo: "example/repo", ruleset_id: 42, now: Time.parse("2026-08-24T00:30:00Z") }
expect_rejected("missing merge_group proof", "merge_group") do
  RulesetCutover.validate_canary!(canary.reject { |key, _| key == "merge_group" }, **options)
end
expect_rejected("stale PR status SHA", "target SHA") do
  mutation = RulesetCutover.deep_copy(canary)
  mutation["pull_request"]["statuses"]["CI / verify"]["target_sha"] = "c" * 40
  RulesetCutover.validate_canary!(mutation, **options)
end
expect_rejected("pending merge_group context", "target SHA") do
  mutation = RulesetCutover.deep_copy(canary)
  mutation["merge_group"]["statuses"]["Review Gate"]["state"] = "pending"
  RulesetCutover.validate_canary!(mutation, **options)
end
expect_rejected("producer revision drift", "workflow path") do
  mutation = RulesetCutover.deep_copy(canary)
  mutation["merge_group"]["statuses"]["Review Gate"]["run"]["path"] = ".github/workflows/evil.yml"
  RulesetCutover.validate_canary!(mutation, **options)
end
expect_rejected("merge-group producer event drift", "not bound") do
  mutation = RulesetCutover.deep_copy(canary)
  mutation["merge_group"]["statuses"]["CI / verify"]["run"]["event"] = "pull_request"
  RulesetCutover.validate_canary!(mutation, **options)
end
expect_rejected("merge-group run identity drift", "run identity") do
  mutation = RulesetCutover.deep_copy(canary)
  mutation["merge_group"]["statuses"]["CI / verify"]["run"]["id"] = 301
  RulesetCutover.validate_canary!(mutation, **options)
end
expect_rejected("untrusted Review Gate branch", "trusted default-branch") do
  mutation = RulesetCutover.deep_copy(canary)
  mutation["pull_request"]["statuses"]["Review Gate"]["run"]["head_branch"] = "feature"
  RulesetCutover.validate_canary!(mutation, **options)
end
expect_rejected("unbound Review Gate canary source", "integration source") do
  mutation = RulesetCutover.deep_copy(canary)
  mutation["pull_request"]["statuses"]["Review Gate"].delete("integration_id")
  RulesetCutover.validate_canary!(mutation, **options)
end
expect_rejected("merge-group comment Review Gate", "trusted default-branch") do
  mutation = RulesetCutover.deep_copy(canary)
  mutation["merge_group"]["statuses"]["Review Gate"]["run"]["event"] = "issue_comment"
  RulesetCutover.validate_canary!(mutation, **options)
end
expect_rejected("artifact digest mutation", "digest mismatch") do
  RulesetCutover.load_canary!(canary, "0" * 64, **options)
end
RulesetCutover.load_canary!(canary, RulesetCutover.canary_digest(canary), **options)
puts "PASS green: content-addressed PR and merge_group canary validates"
puts "Ruleset cutover mutation probes passed."
