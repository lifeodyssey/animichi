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
      { "type" => "required_status_checks", "parameters" => {
        "strict_required_status_checks_policy" => true,
        "required_status_checks" => [{ "context" => "Web / test" }, { "context" => "Security / Semgrep" }]
      } }
    ]
  }
end

expect_rejected("missing Review Gate", "missing approved contexts") do
  RulesetCutover.validate_contexts!(["PR Verification", "Security"])
end

expect_rejected("duplicate Security", "duplicate contexts") do
  RulesetCutover.validate_contexts!(["PR Verification", "Security", "Security", "Review Gate"])
end

expect_rejected("old per-lane context", "unexpected contexts") do
  RulesetCutover.validate_contexts!(["PR Verification", "Security / Semgrep", "Review Gate"])
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

canary = {
  "pr_number" => 999,
  "head_sha" => "a" * 40,
  "failing_context" => "Security",
  "blocked" => true,
  "merged" => false,
  "repaired_head_sha" => "b" * 40,
  "repaired_statuses" => RulesetCutover::APPROVED_CONTEXTS.to_h { |context| [context, "success"] },
  "repaired_eligible" => true
}
expect_rejected("merged canary", "closed without merging") do
  RulesetCutover.validate_canary!(canary.merge("merged" => true))
end
expect_rejected("pending repaired aggregate", "all three aggregators") do
  RulesetCutover.validate_canary!(canary.merge("repaired_statuses" => canary.fetch("repaired_statuses").merge("Review Gate" => "pending")))
end
expect_rejected("non-string canary SHA", "40-hex SHA") do
  RulesetCutover.validate_canary!(canary.merge("head_sha" => nil))
end
RulesetCutover.validate_canary!(canary)
puts "PASS green: complete canary evidence validates"
puts "Ruleset cutover mutation probes passed."
