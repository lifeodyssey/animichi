# frozen_string_literal: true

# API-shaped integration seam for issue #1180. The GitHub CLI is replaced by a
# deterministic adapter, so this proves the guarded request sequence without
# touching the live repository ruleset.

require "json"
require "tmpdir"
require_relative "ruleset_cutover"
require_relative "ruleset_cutover_integration_support"

include RulesetCutoverIntegrationSupport

harness = RulesetCutoverIntegrationSupport::GitHubApiHarness.new(self)
harness.install
before = harness.before
before_snapshot = RulesetCutover.snapshot(before, endpoint: "repos/example/repo/rulesets/42",
                                           captured_at: "2026-08-23T00:00:00Z")
ENV["RULESET_CUTOVER_APPLY"] = "1"
ENV["RULESET_CUTOVER_CONFIRM"] = "REPLACE_REQUIRED_CHECKS_ONCE"

Dir.mktmpdir("ruleset-cutover-integration") do |directory|
  now = Time.parse("2026-08-24T00:30:00Z")
  artifact = RulesetCutover.capture_canary(repo: "example/repo", ruleset_id: 42, pr_number: 999,
                                           merge_run_id: 502, now: Time.parse("2026-08-24T00:00:00Z"))
  canary_path = File.join(directory, "canary.json")
  apply = lambda do |candidate = artifact, digest = RulesetCutover.canary_digest(candidate)|
    File.write(canary_path, JSON.pretty_generate(candidate))
    RulesetCutover.apply(repo: "example/repo", ruleset_id: 42, evidence_dir: directory,
                         expected_snapshot_digest: RulesetCutover.snapshot_digest(before_snapshot),
                         canary_path: canary_path, expected_canary_digest: digest, now: now)
  end

  assert_error("digest mismatch") { apply.call(artifact, "0" * 64) }
  assert(harness.put_count.zero?, "digest mismatch must fail before PUT")
  missing_queue = artifact.reject { |key, _| key == "merge_group" }
  assert_error("merge_group") { apply.call(missing_queue) }
  stale_sha = RulesetCutover.deep_copy(artifact)
  stale_sha["merge_group"]["statuses"]["CI / verify"]["target_sha"] = "c" * 40
  assert_error("target SHA") { apply.call(stale_sha) }
  stale_context = RulesetCutover.deep_copy(artifact)
  stale_context["pull_request"]["statuses"]["Review Gate"]["state"] = "pending"
  assert_error("target SHA") { apply.call(stale_context) }
  assert(harness.put_count.zero?, "invalid PR or merge_group evidence must fail before PUT")

  forged = RulesetCutover.deep_copy(artifact)
  forged["pull_request"]["head_sha"] = "c" * 40
  forged["pull_request"]["statuses"].each_value { |status| status["target_sha"] = "c" * 40 }
  forged["pull_request"]["statuses"]["CI / verify"]["run"]["head_sha"] = "c" * 40
  assert_error("current GitHub API evidence") { apply.call(forged) }
  assert(harness.put_count.zero?, "self-consistent hand-written JSON must never authorize PUT")

  harness.api["repos/example/repo/pulls/999"]["head"]["sha"] = "c" * 40
  assert_error("exactly one CI / verify") { apply.call }
  harness.api["repos/example/repo/pulls/999"]["head"]["sha"] = harness.pr_head
  harness.api["repos/example/repo/actions/runs/501"]["event"] = "push"
  assert_error("workflow run event mismatch") { apply.call }
  harness.api["repos/example/repo/actions/runs/501"]["event"] = "pull_request"
  harness.api["repos/example/repo/actions/runs/602"]["event"] = "issue_comment"
  assert_error("workflow run event mismatch") { apply.call }
  harness.api["repos/example/repo/actions/runs/602"]["event"] = "workflow_run"
  pr_statuses = harness.api["repos/example/repo/commits/#{harness.pr_head}/statuses?per_page=100"]
  pr_statuses.first["target_url"] = "https://github.com/example/repo/actions/runs/501/attempts/1"
  assert_error("workflow run path mismatch") { apply.call }
  pr_statuses.first["target_url"] = "https://github.com/example/repo/actions/runs/601/attempts/1"
  assert(harness.put_count.zero?, "advanced heads or untrusted producer runs must fail before PUT")

  ruleset_path = ["gh", "api", "repos/example/repo/rulesets/42"]
  reads_before = harness.calls.count { |command| command == ruleset_path }
  result = apply.call
  assert(RulesetCutover.contexts(result) == RulesetCutover::APPROVED_CONTEXTS,
         "after-read must verify exact aggregators")
  RulesetCutover::PRESERVED_KEYS.each do |key|
    assert(result.fetch(key) == before.fetch(key), "after-read must preserve #{key}")
  end
  assert(RulesetCutover.canonical_rules(result) == RulesetCutover.canonical_rules(before),
         "after-read must preserve effective unrelated rules")
  assert(RulesetCutover.retired_rules(result).empty?, "after-read must reject native quality residues")
  assert(harness.put_count == 1, "apply must perform exactly one PUT")
  assert(harness.calls.count { |command| command == ruleset_path } - reads_before == 2,
         "successful apply must read the ruleset immediately before and after the PUT")
  actions_api = %r{actions/(permissions|selected-actions|workflow-access-to-repository)}
  assert(harness.calls.none? { |command| command.any? { |argument| argument.match?(actions_api) } },
         "apply must not touch Actions settings")
  %w[ruleset-before.json ruleset-after.json ruleset-canary.json ruleset-payload.json].each do |name|
    assert(File.exist?(File.join(directory, name)), "evidence must retain #{name}")
  end
  after_evidence = JSON.parse(File.read(File.join(directory, "ruleset-after.json")))
  assert(after_evidence.fetch("required_contexts") == RulesetCutover::APPROVED_CONTEXTS,
         "after evidence must retain all aggregators")
  assert(after_evidence.fetch("canary_sha256") == RulesetCutover.canary_digest(artifact),
         "after evidence must bind the exact canary artifact")

  harness.leave_native = true
  assert_error("retired native rules remain") { apply.call }
  assert(harness.put_count == 2, "native residue must be rejected by the after-read following one PUT")
  assert(!File.exist?(File.join(directory, "ruleset-after.json")),
         "failed after-read must not leave stale green evidence")
end

harness.restore
ENV.delete("RULESET_CUTOVER_APPLY")
ENV.delete("RULESET_CUTOVER_CONFIRM")
puts "Ruleset cutover integration seam: guarded one-PUT sequence, preservation, and evidence retention passed"
