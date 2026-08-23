#!/usr/bin/env ruby
# frozen_string_literal: true
# One-shot required-check cutover contract for issue #1180.
#
# The live mutation is intentionally guarded. This file owns the pure ruleset
# transform and the small GitHub API adapter used by the operator runbook:
# snapshot first, validate a candidate, then PUT exactly the ruleset payload.
# It never reads or writes Actions notification settings.
require "digest"
require "fileutils"
require "json"
require "open3"
require "time"
module RulesetCutover
  APPROVED_CONTEXTS = ["PR Verification", "Security", "Review Gate"].freeze
  RULE_TYPE = "required_status_checks"
  PRESERVED_KEYS = %w[id name target source_type enforcement bypass_actors conditions].freeze
  WRITE_KEYS = %w[name target enforcement bypass_actors conditions rules].freeze

  class Error < StandardError; end
  module_function

  def parse(path)
    JSON.parse(File.read(path))
  rescue Errno::ENOENT, JSON::ParserError => error
    raise Error, "cannot read JSON #{path}: #{error.message}"
  end
  def dump(object, path)
    File.write(path, "#{JSON.pretty_generate(object)}\n")
  end
  def required_rules(ruleset)
    rules = Array(ruleset.fetch("rules"))
    matches = rules.select { |rule| rule.is_a?(Hash) && rule["type"] == RULE_TYPE }
    raise Error, "ruleset must contain exactly one #{RULE_TYPE} rule" unless matches.one?
    matches
  rescue KeyError, TypeError => error
    raise Error, "malformed ruleset rules: #{error.message}"
  end
  def required_rule(ruleset)
    rule = required_rules(ruleset).first
    parameters = rule.fetch("parameters")
    raise Error, "required-status rule parameters must be an object" unless parameters.is_a?(Hash)
    checks = parameters.fetch("required_status_checks")
    raise Error, "required_status_checks must be an array" unless checks.is_a?(Array)
    [rule, checks]
  rescue KeyError, TypeError => error
    raise Error, "malformed required-status rule: #{error.message}"
  end
  def context_value(check)
    raise Error, "required status entry must be an object" unless check.is_a?(Hash)
    context = check["context"]
    raise Error, "required status entry must contain a string context" unless context.is_a?(String) && !context.empty?
    context
  end
  def contexts(ruleset)
    _rule, checks = required_rule(ruleset)
    checks.map { |check| context_value(check) }
  end
  def context_problems(values)
    duplicates = values.group_by(&:itself).select { |_context, entries| entries.length > 1 }.keys
    missing = APPROVED_CONTEXTS - values
    unexpected = values.uniq - APPROVED_CONTEXTS
    problems = []
    problems << "duplicate contexts: #{duplicates.join(", ")}" unless duplicates.empty?
    problems << "missing approved contexts: #{missing.join(", ")}" unless missing.empty?
    problems << "unexpected contexts: #{unexpected.join(", ")}" unless unexpected.empty?
    problems
  end
  def validate_contexts!(values)
    raise Error, "required contexts must be an array" unless values.is_a?(Array)
    problems = context_problems(values)
    raise Error, problems.join("; ") unless problems.empty?

    true
  end
  def validate_ruleset!(ruleset, approved: false)
    raise Error, "ruleset must be an object" unless ruleset.is_a?(Hash)

    required = contexts(ruleset)
    validate_contexts!(required) if approved
    required
  end
  def deep_copy(value)
    JSON.parse(JSON.generate(value))
  end
  def candidate(ruleset)
    validate_ruleset!(ruleset)
    result = deep_copy(ruleset)
    rule, = required_rule(result)
    rule.fetch("parameters")["required_status_checks"] = APPROVED_CONTEXTS.map { |context| { "context" => context } }
    validate_ruleset!(result, approved: true)
    result
  end
  def payload(ruleset)
    validate_ruleset!(ruleset, approved: true)
    assert_payload_safe!(ruleset)
    WRITE_KEYS.to_h { |key| [key, ruleset.fetch(key)] }
  rescue KeyError => error
    raise Error, "ruleset is missing writable field #{error.key}"
  end
  def assert_payload_safe!(ruleset)
    forbidden = ruleset.keys.grep(/^actions(?:_|$)/)
    return if forbidden.empty?
    raise Error, "ruleset payload cannot contain Actions settings: #{forbidden.join(", ")}"
  end
  def non_required_rules(ruleset)
    Array(ruleset.fetch("rules")).reject { |rule| rule.is_a?(Hash) && rule["type"] == RULE_TYPE }
  end
  def canonical_rules(ruleset)
    non_required_rules(ruleset).sort_by { |rule| JSON.generate(rule) }
  end
  def assert_preserved_fields!(before, after)
    PRESERVED_KEYS.each do |key|
      next unless before.key?(key)
      raise Error, "cutover changed protected ruleset field #{key}" unless before[key] == after[key]
    end
  end
  def assert_preserved!(before, after)
    assert_preserved_fields!(before, after)
    unless canonical_rules(before) == canonical_rules(after)
      raise Error, "cutover changed a non-required-status rule"
    end
    true
  end

  def snapshot_ruleset(ruleset)
    result = PRESERVED_KEYS.to_h { |key| [key, ruleset[key]] }
    result["rules"] = deep_copy(ruleset.fetch("rules"))
    result["required_contexts"] = contexts(ruleset)
    result["required_status_rule"] = deep_copy(required_rule(ruleset).first)
    result
  end
  def snapshot_metadata(captured_at, endpoint)
    {
      "schema_version" => "ruleset-cutover/v1",
      "captured_at" => captured_at,
      "endpoint" => endpoint,
      "actions_settings" => "not_requested",
      "recovery" => "retain-before-put"
    }
  end
  def snapshot(ruleset, endpoint: nil, captured_at: Time.now.utc.iso8601)
    validate_ruleset!(ruleset)
    result = snapshot_metadata(captured_at, endpoint)
    result["ruleset"] = snapshot_ruleset(ruleset)
    result
  end

  def canonical_snapshot(snapshot)
    stable = deep_copy(snapshot)
    stable.delete("captured_at")
    ruleset = stable["ruleset"]
    ruleset["rules"] = Array(ruleset["rules"]).sort_by { |rule| JSON.generate(rule) } if ruleset.is_a?(Hash)
    stable
  end
  def snapshot_digest(snapshot)
    stable = canonical_snapshot(snapshot)
    Digest::SHA256.hexdigest(JSON.generate(stable))
  end

  def validate_canary_shape!(evidence)
    required = %w[pr_number head_sha failing_context blocked merged repaired_head_sha repaired_statuses repaired_eligible]
    missing = required.reject { |key| evidence.is_a?(Hash) && evidence.key?(key) }
    raise Error, "canary evidence is missing: #{missing.join(", ")}" unless missing.empty?
  end

  def validate_canary_shas!(evidence)
    raise Error, "canary PR number must be positive" unless evidence.fetch("pr_number").is_a?(Integer) && evidence.fetch("pr_number").positive?
    %w[head_sha repaired_head_sha].each do |key|
      sha = evidence.fetch(key)
      raise Error, "canary #{key} must be a 40-hex SHA" unless sha.is_a?(String) && sha.match?(/\A[0-9a-f]{40}\z/)
    end
  end

  def validate_canary_statuses!(evidence)
    statuses = evidence.fetch("repaired_statuses")
    expected = APPROVED_CONTEXTS.sort
    valid = statuses.is_a?(Hash) && statuses.keys.all? { |key| key.is_a?(String) } && statuses.keys.sort == expected && statuses.values.all? { |state| state == "success" }
    unless valid
      raise Error, "repaired canary must have successful current-head statuses for all three aggregators"
    end
  end
  def validate_canary_flags!(evidence)
    raise Error, "canary failing_context must be an approved aggregator" unless APPROVED_CONTEXTS.include?(evidence.fetch("failing_context"))
    raise Error, "canary must be blocked" unless evidence.fetch("blocked") == true
    raise Error, "canary must be closed without merging" unless evidence.fetch("merged") == false
    raise Error, "repaired canary must be eligible" unless evidence.fetch("repaired_eligible") == true
  end

  def validate_canary!(evidence)
    validate_canary_shape!(evidence)
    validate_canary_shas!(evidence)
    validate_canary_statuses!(evidence)
    validate_canary_flags!(evidence)
    true
  rescue KeyError, TypeError => error
    raise Error, "malformed canary evidence: #{error.message}"
  end

  def gh_json(path, *arguments)
    output, error, status = Open3.capture3("gh", "api", path, *arguments)
    raise Error, "gh api #{path} failed: #{error.strip}" unless status.success?

    JSON.parse(output)
  rescue JSON::ParserError => error
    raise Error, "gh api #{path} returned invalid JSON: #{error.message}"
  end

  def after_evidence_metadata(before, endpoint)
    {
      "schema_version" => "ruleset-cutover/v1",
      "endpoint" => endpoint,
      "before_snapshot_sha256" => snapshot_digest(snapshot(before, endpoint: endpoint)),
      "actions_settings" => "not_requested",
      "status" => "verified-after-put"
    }
  end
  def after_evidence(before, after, endpoint)
    result = after_evidence_metadata(before, endpoint)
    result["required_contexts"] = contexts(after)
    result["payload_sha256"] = Digest::SHA256.hexdigest(JSON.generate(payload(after)))
    result
  end
  def write_after_evidence(directory, before, after, endpoint)
    FileUtils.mkdir_p(directory)
    dump(after_evidence(before, after, endpoint), File.join(directory, "ruleset-after.json"))
  end

  def assert_apply_authorized!(digest)
    raise Error, "live apply requires RULESET_CUTOVER_APPLY=1" unless ENV["RULESET_CUTOVER_APPLY"] == "1"
    raise Error, "live apply requires RULESET_CUTOVER_CONFIRM=REPLACE_REQUIRED_CHECKS_ONCE" unless ENV["RULESET_CUTOVER_CONFIRM"] == "REPLACE_REQUIRED_CHECKS_ONCE"
    unless digest.is_a?(String) && digest.match?(/\A[0-9a-f]{64}\z/)
      raise Error, "live apply requires the 64-hex recovery snapshot digest"
    end
  end

  def fetch_before(endpoint, expected_digest)
    before = gh_json(endpoint)
    before_snapshot = snapshot(before, endpoint: endpoint)
    if snapshot_digest(before_snapshot) != expected_digest
      raise Error, "live ruleset changed since the recovery snapshot; refusing PUT"
    end
    [before, before_snapshot]
  end

  def write_apply_plan(directory, before_snapshot, candidate_ruleset)
    FileUtils.mkdir_p(directory)
    dump(before_snapshot, File.join(directory, "ruleset-before.json"))
    payload_path = File.join(directory, "ruleset-payload.json")
    dump(payload(candidate_ruleset), payload_path)
    payload_path
  end

  def put_candidate(endpoint, payload_path)
    _output, error, status = Open3.capture3("gh", "api", "-X", "PUT", endpoint, "--input", payload_path)
    raise Error, "ruleset PUT failed: #{error.strip}" unless status.success?
  end

  def apply(repo:, ruleset_id:, evidence_dir:, expected_snapshot_digest: nil)
    assert_apply_authorized!(expected_snapshot_digest)
    endpoint = "repos/#{repo}/rulesets/#{ruleset_id}"
    before, before_snapshot = fetch_before(endpoint, expected_snapshot_digest)
    payload_path = write_apply_plan(evidence_dir, before_snapshot, candidate(before))
    put_candidate(endpoint, payload_path)
    verify_after(endpoint, before, evidence_dir)
  end
  def verify_after(endpoint, before, evidence_dir)
    after = gh_json(endpoint)
    validate_ruleset!(after, approved: true)
    assert_preserved!(before, after)
    write_after_evidence(evidence_dir, before, after, endpoint)
    after
  end
end

load File.expand_path("ruleset_cutover_cli.rb", __dir__) if $PROGRAM_NAME == __FILE__
