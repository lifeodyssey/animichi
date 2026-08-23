# frozen_string_literal: true

# API-shaped integration seam for issue #1180. The GitHub CLI is replaced by a
# deterministic adapter, so this proves the guarded request sequence without
# touching the live repository ruleset.

require "json"
require "open3"
require "tmpdir"
require_relative "ruleset_cutover"

def fail_integration(message)
  abort "FAIL: #{message}"
end

def assert(condition, message)
  fail_integration(message) unless condition
end

def ruleset
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
        "required_status_checks" => [{ "context" => "Web / test" }, { "context" => "Security / Semgrep" }]
      } },
      { "type" => "code_quality", "parameters" => { "severity" => "all" } }
    ]
  }
end

before = ruleset
before_snapshot = RulesetCutover.snapshot(before, endpoint: "repos/example/repo/rulesets/42", captured_at: "2026-08-23T00:00:00Z")
calls = []
put_count = 0
original_capture3 = Open3.method(:capture3)
Open3.define_singleton_method(:capture3) do |*command|
  calls << command
  if command.include?("-X")
    put_count += 1
    payload = JSON.parse(File.read(command.fetch(command.index("--input") + 1)))
    assert(payload.fetch("rules").any? { |rule| rule.dig("parameters", "required_status_checks")&.map { |check| check["context"] } == RulesetCutover::APPROVED_CONTEXTS }, "PUT must carry all three approved contexts")
    ["{}", "", Struct.new(:success?).new(true)]
  else
    response = put_count.zero? ? before : RulesetCutover.candidate(before)
    response["rules"] = response.fetch("rules").reverse if put_count.positive?
    [JSON.generate(response), "", Struct.new(:success?).new(true)]
  end
end

ENV["RULESET_CUTOVER_APPLY"] = "1"
ENV["RULESET_CUTOVER_CONFIRM"] = "REPLACE_REQUIRED_CHECKS_ONCE"
Dir.mktmpdir("ruleset-cutover-integration") do |directory|
  result = RulesetCutover.apply(repo: "example/repo", ruleset_id: 42, evidence_dir: directory,
                                expected_snapshot_digest: RulesetCutover.snapshot_digest(before_snapshot))
  assert(RulesetCutover.contexts(result) == RulesetCutover::APPROVED_CONTEXTS, "after-read must verify exact aggregators")
  RulesetCutover::PRESERVED_KEYS.each do |key|
    assert(result.fetch(key) == before.fetch(key), "after-read must preserve #{key}")
  end
  assert(RulesetCutover.canonical_rules(result) == RulesetCutover.canonical_rules(before), "after-read must preserve unrelated rules")
  assert(put_count == 1, "apply must perform exactly one PUT")
  assert(calls.count { |command| command == ["gh", "api", "repos/example/repo/rulesets/42"] } == 2, "apply must read before and after the PUT")
  assert(calls.none? { |command| command.any? { |argument| argument.include?("actions/") } }, "apply must not touch Actions settings")
  %w[ruleset-before.json ruleset-after.json ruleset-payload.json].each do |name|
    assert(File.exist?(File.join(directory, name)), "evidence must retain #{name}")
  end
  after_evidence = JSON.parse(File.read(File.join(directory, "ruleset-after.json")))
  assert(after_evidence.fetch("required_contexts") == RulesetCutover::APPROVED_CONTEXTS, "after evidence must retain all aggregators")
end

Open3.define_singleton_method(:capture3, original_capture3)
puts "Ruleset cutover integration seam: guarded one-PUT sequence, preservation, and evidence retention passed"
