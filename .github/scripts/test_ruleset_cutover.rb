# frozen_string_literal: true

# Unit contract for issue #1180. These tests are hermetic: the live ruleset is
# never read and no GitHub API mutation is attempted.

require "json"
require "yaml"
require_relative "ruleset_cutover"

ROOT = File.expand_path("../..", __dir__)
TARGET = File.join(ROOT, "docs", "iterations", "s0v2", "ruleset-cutover-target.json")

def fail_test(message)
  abort "FAIL: #{message}"
end

def assert(condition, message)
  fail_test(message) unless condition
end

def assert_error(fragment)
  yield
  fail_test "expected #{fragment.inspect}"
rescue RulesetCutover::Error => error
  fail_test "expected #{fragment.inspect}, got #{error.message.inspect}" unless error.message.include?(fragment)
end

def fixture(contexts)
  {
    "id" => 42,
    "name" => "protect main",
    "target" => "branch",
    "source_type" => "Repository",
    "enforcement" => "active",
    "bypass_actors" => [{ "actor_id" => 7, "actor_type" => "User", "bypass_mode" => "always" }],
    "conditions" => { "ref_name" => { "include" => ["~DEFAULT_BRANCH"], "exclude" => [] } },
    "rules" => [
      { "type" => "deletion" },
      { "type" => "required_status_checks", "parameters" => {
        "strict_required_status_checks_policy" => true,
        "required_status_checks" => contexts.map { |context| { "context" => context } }
      } },
      { "type" => "code_quality", "parameters" => { "severity" => "all" } }
    ]
  }
end

def assert_target_contract
  target = JSON.parse(File.read(TARGET))
  assert(target.fetch("required_checks") == RulesetCutover::APPROVED_CONTEXTS,
         "target must list the three approved aggregators in canonical order")
  assert(target.fetch("actions_settings") == "not_requested", "target must forbid Actions settings changes")
  target.fetch("producer_workflows").each_value do |path|
    assert(File.exist?(File.join(ROOT, path)), "producer workflow is missing: #{path}")
  end
  target.fetch("producer_jobs").each do |context, producer|
    workflow = load_workflow(producer.fetch("workflow"))
    job = workflow.fetch("jobs").fetch(producer.fetch("job_id"))
    assert(producer.fetch("name") == context && job.fetch("name") == context,
           "#{context} target must match its producer job name")
  end
  compatibility = target.fetch("pre_cutover_compatibility")
  workflow = load_workflow(compatibility.fetch("workflow"))
  wrapper = workflow.fetch("jobs").fetch(compatibility.fetch("job_id"))
  assert(wrapper.fetch("name") == compatibility.fetch("legacy_required_context"),
         "pre-cutover wrapper must emit the live legacy context")
  assert(Array(wrapper.fetch("needs")) == [compatibility.fetch("needs")],
         "pre-cutover wrapper must mirror the Review Gate job")
end

def load_workflow(path)
  source = File.read(File.join(ROOT, path)).sub(/^on:(?=[ \t#]|$)/, '"on":')
  YAML.safe_load(source, aliases: true)
end

def assert_merge_group(path)
  workflow = load_workflow(path)
  triggers = workflow["on"] || workflow[true]
  merge_group = triggers.fetch("merge_group")
  assert(Array(merge_group.fetch("branches")) == ["main"], "#{path} merge_group must target main")
end

assert_target_contract
%w[.github/workflows/pr-verification.yml .github/workflows/ci.yml .github/workflows/pipeline-quality.yml].each do |path|
  assert_merge_group(path)
end

approved = fixture(RulesetCutover::APPROVED_CONTEXTS)
before = fixture(["Web / test", "Security / Semgrep"])
assert(RulesetCutover.validate_ruleset!(approved, approved: true) == RulesetCutover::APPROVED_CONTEXTS,
       "approved candidate must validate")

candidate = RulesetCutover.candidate(before)
assert(RulesetCutover.contexts(candidate) == RulesetCutover::APPROVED_CONTEXTS,
       "candidate must replace every old per-lane context")
assert(RulesetCutover.non_required_rules(candidate) == RulesetCutover.non_required_rules(approved),
       "candidate must preserve unrelated rules")
reordered = RulesetCutover.deep_copy(candidate)
reordered["rules"] = reordered.fetch("rules").reverse
assert(RulesetCutover.assert_preserved!(candidate, reordered), "ruleset rule order changes must not look like mutations")
RulesetCutover::PRESERVED_KEYS.each do |key|
  assert(candidate.fetch(key) == approved.fetch(key), "candidate must preserve #{key}")
end
payload = RulesetCutover.payload(candidate)
assert(payload.keys.sort == RulesetCutover::WRITE_KEYS.sort, "payload must use the narrow ruleset write allowlist")
assert(!payload.key?("id"), "payload must not send the read-only ruleset id")

snapshot = RulesetCutover.snapshot(before, endpoint: "repos/example/rulesets/42", captured_at: "2026-08-23T00:00:00Z")
assert(snapshot.fetch("ruleset").fetch("id") == 42, "snapshot must retain identity")
assert(snapshot.fetch("ruleset").fetch("rules").length == before.fetch("rules").length,
       "snapshot must retain the complete old ruleset for recovery")
assert(snapshot.fetch("ruleset").fetch("enforcement") == "active", "snapshot must retain enforcement")
assert(snapshot.fetch("ruleset").fetch("bypass_actors").any?, "snapshot must retain bypass actors")
assert(snapshot.fetch("ruleset").fetch("target") == "branch", "snapshot must retain branch targeting")
assert(snapshot.fetch("ruleset").fetch("required_contexts") == ["Web / test", "Security / Semgrep"], "snapshot must retain every old context")
assert(snapshot.fetch("actions_settings") == "not_requested", "snapshot must record Actions settings as untouched")
reordered_snapshot = RulesetCutover.deep_copy(snapshot)
reordered_snapshot["ruleset"]["rules"] = reordered_snapshot.fetch("ruleset").fetch("rules").reverse
assert(RulesetCutover.snapshot_digest(snapshot) == RulesetCutover.snapshot_digest(reordered_snapshot),
       "snapshot digest must tolerate API rule-array reordering")

assert_error("missing approved contexts") { RulesetCutover.validate_ruleset!(fixture(["PR Verification", "Security"]), approved: true) }
assert_error("unexpected contexts") { RulesetCutover.validate_ruleset!(fixture(["PR Verification", "Security", "Review Gate", "Security / Semgrep"]), approved: true) }
assert_error("duplicate contexts") { RulesetCutover.validate_ruleset!(fixture(["PR Verification", "Security", "Security", "Review Gate"]), approved: true) }
assert_error("Actions settings") { RulesetCutover.payload(candidate.merge("actions_permissions" => { "enabled" => false })) }

canary = {
  "pr_number" => 999,
  "head_sha" => "a" * 40,
  "failing_context" => "PR Verification",
  "blocked" => true,
  "merged" => false,
  "repaired_head_sha" => "b" * 40,
  "repaired_statuses" => RulesetCutover::APPROVED_CONTEXTS.to_h { |context| [context, "success"] },
  "repaired_eligible" => true
}
assert(RulesetCutover.validate_canary!(canary), "complete canary evidence must validate")
assert_error("canary must be blocked") { RulesetCutover.validate_canary!(canary.merge("blocked" => false)) }
assert_error("all three aggregators") { RulesetCutover.validate_canary!(canary.merge("repaired_statuses" => { "Security" => "success" })) }
assert_error("40-hex SHA") { RulesetCutover.validate_canary!(canary.merge("head_sha" => nil)) }
assert_error("all three aggregators") { RulesetCutover.validate_canary!(canary.merge("repaired_statuses" => { Security: "success" })) }

ENV.delete("RULESET_CUTOVER_APPLY")
assert_error("requires RULESET_CUTOVER_APPLY=1") do
  RulesetCutover.apply(repo: "example/repo", ruleset_id: 42, evidence_dir: "/tmp/ruleset-cutover-test")
end

puts "Ruleset cutover unit contract: exact aggregators, preservation, snapshot, payload guard, and no live apply"
