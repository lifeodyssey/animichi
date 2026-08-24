# frozen_string_literal: true

# Unit contract for issue #1180. These tests are hermetic: the live ruleset is
# never read and no GitHub API mutation is attempted.

require "time"
require_relative "ruleset_cutover"
require_relative "ruleset_cutover_test_support"

include RulesetCutoverTestSupport

abort "FAIL: canary capture must be a GitHub API-backed public seam" unless RulesetCutover.respond_to?(:capture_canary)
abort "FAIL: apply must live-revalidate captured evidence" unless RulesetCutover.respond_to?(:revalidate_canary!)

assert_target_contract
workflow = load_workflow(".github/workflows/pr-verification.yml")
triggers = workflow["on"] || workflow[true]
assert(Array(triggers.fetch("merge_group").fetch("branches")) == ["main"],
       ".github/workflows/pr-verification.yml merge_group must target main")

approved = fixture(RulesetCutover::APPROVED_CONTEXTS)
approved["rules"].reject! { |rule| RulesetCutover::RETIRED_RULE_TYPES.include?(rule["type"]) }
RulesetCutover.required_rule(approved).last.replace(RulesetCutover.deep_copy(RulesetCutover::REQUIRED_CHECKS))
RulesetCutover.enable_review_threads!(approved)
before = fixture(["Web / test", "Security / Semgrep"])
assert(RulesetCutover.validate_ruleset!(approved, approved: true) == RulesetCutover::APPROVED_CONTEXTS,
       "approved candidate must validate")

candidate = RulesetCutover.candidate(before)
assert(RulesetCutover.contexts(candidate) == RulesetCutover::APPROVED_CONTEXTS,
       "candidate must replace every old per-lane context")
assert(candidate.fetch("rules").none? { |rule| %w[code_quality code_coverage].include?(rule["type"]) },
       "candidate must remove unavailable native quality rules")
pull_rule = candidate.fetch("rules").find { |rule| rule["type"] == "pull_request" }
assert(pull_rule.dig("parameters", "required_review_thread_resolution") == true,
       "candidate must enable native review-thread resolution")
checks = RulesetCutover.required_rule(candidate).last
review_check = checks.find { |check| check["context"] == "Review Gate" }
assert(review_check == { "context" => "Review Gate", "integration_id" => RulesetCutover::GITHUB_ACTIONS_INTEGRATION_ID },
       "Review Gate must be source-bound to GitHub Actions")
assert(RulesetCutover.preserved_rules(candidate) == RulesetCutover.preserved_rules(approved),
       "candidate must preserve unrelated effective rules")
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
saved = snapshot.fetch("ruleset")
assert(saved.fetch("id") == 42 && saved.fetch("enforcement") == "active", "snapshot must retain identity and enforcement")
assert(saved.fetch("rules").length == before.fetch("rules").length, "snapshot must retain the complete old ruleset")
assert(saved.fetch("bypass_actors").any? && saved.fetch("target") == "branch", "snapshot must retain bypass and targeting")
assert(saved.fetch("required_contexts") == ["Web / test", "Security / Semgrep"], "snapshot must retain every old context")
assert(snapshot.fetch("actions_settings") == "not_requested", "snapshot must record Actions settings as untouched")
reordered_snapshot = RulesetCutover.deep_copy(snapshot)
reordered_snapshot["ruleset"]["rules"] = reordered_snapshot.fetch("ruleset").fetch("rules").reverse
assert(RulesetCutover.snapshot_digest(snapshot) == RulesetCutover.snapshot_digest(reordered_snapshot),
       "snapshot digest must tolerate API rule-array reordering")

assert_error("missing approved contexts") { RulesetCutover.validate_ruleset!(fixture(["CI / verify"]), approved: true) }
assert_error("unexpected contexts") do
  RulesetCutover.validate_ruleset!(fixture(["CI / verify", "Review Gate", "Security"]), approved: true)
end
assert_error("duplicate contexts") do
  RulesetCutover.validate_ruleset!(fixture(["CI / verify", "Review Gate", "Review Gate"]), approved: true)
end
thread_off = RulesetCutover.deep_copy(candidate)
thread_off.fetch("rules").find { |rule| rule["type"] == "pull_request" }.fetch("parameters")["required_review_thread_resolution"] = false
assert_error("review-thread resolution") { RulesetCutover.validate_ruleset!(thread_off, approved: true) }
unbound = RulesetCutover.deep_copy(candidate)
RulesetCutover.required_rule(unbound).last.find { |check| check["context"] == "Review Gate" }.delete("integration_id")
assert_error("integration") { RulesetCutover.validate_ruleset!(unbound, approved: true) }
assert_error("Actions settings") do
  RulesetCutover.payload(candidate.merge("actions_permissions" => { "enabled" => false }))
end

canary = {
  "schema_version" => RulesetCutover::CANARY_SCHEMA, "repository" => "example/repo", "ruleset_id" => 42,
  "observed_at" => "2026-08-24T00:00:00Z", "default_branch" => "main",
  "pull_request" => { "number" => 999, "head_sha" => "a" * 40,
                      "statuses" => status_evidence("a" * 40, "pull_request", 250) },
  "merge_group" => { "ci_run_id" => 300, "head_sha" => "b" * 40,
                     "statuses" => status_evidence("b" * 40, "merge_group", 300) }
}
canary_now = Time.parse("2026-08-24T00:30:00Z")
options = { repo: "example/repo", ruleset_id: 42, now: canary_now }
assert(RulesetCutover.validate_canary!(canary, **options), "complete canary evidence must validate")
assert_error("merge_group") do
  RulesetCutover.validate_canary!(canary.reject { |key, _| key == "merge_group" }, **options)
end
stale_status = RulesetCutover.deep_copy(canary)
stale_status["merge_group"]["statuses"]["Review Gate"]["target_sha"] = "c" * 40
assert_error("target SHA") { RulesetCutover.validate_canary!(stale_status, **options) }
assert_error("stale") do
  RulesetCutover.validate_canary!(canary, repo: "example/repo", ruleset_id: 42, now: Time.parse("2026-08-26T00:00:00Z"))
end
assert_error("workflow path") do
  bad = RulesetCutover.deep_copy(canary)
  bad["pull_request"]["statuses"]["CI / verify"]["run"]["path"] = ".github/workflows/evil.yml"
  RulesetCutover.validate_canary!(bad, **options)
end
digest = RulesetCutover.canary_digest(canary)
assert(RulesetCutover.load_canary!(canary, digest, **options), "content-addressed canary must load")
assert_error("digest mismatch") { RulesetCutover.load_canary!(canary, "0" * 64, **options) }

native_residue = RulesetCutover.candidate(before)
native_residue["rules"] << { "type" => "code_quality", "parameters" => { "severity" => "all" } }
assert_error("native") { RulesetCutover.validate_ruleset!(native_residue, approved: true) }

ENV.delete("RULESET_CUTOVER_APPLY")
assert_error("requires RULESET_CUTOVER_APPLY=1") do
  RulesetCutover.apply(repo: "example/repo", ruleset_id: 42, evidence_dir: "/tmp/ruleset-cutover-test")
end
ENV["RULESET_CUTOVER_APPLY"] = "1"
ENV["RULESET_CUTOVER_CONFIRM"] = "REPLACE_REQUIRED_CHECKS_ONCE"
assert_error("canary artifact path") do
  RulesetCutover.apply(repo: "example/repo", ruleset_id: 42, evidence_dir: "/tmp/ruleset-cutover-test",
                       expected_snapshot_digest: "0" * 64)
end
ENV.delete("RULESET_CUTOVER_APPLY")
ENV.delete("RULESET_CUTOVER_CONFIRM")

puts "Ruleset cutover unit contract: exact aggregators, preservation, snapshot, payload guard, and no live apply"
