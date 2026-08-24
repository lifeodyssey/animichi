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
  APPROVED_CONTEXTS = ["CI / verify", "Review Gate"].freeze
  GITHUB_ACTIONS_INTEGRATION_ID = 15_368
  REQUIRED_CHECKS = [
    { "context" => "CI / verify" },
    { "context" => "Review Gate", "integration_id" => GITHUB_ACTIONS_INTEGRATION_ID }
  ].freeze
  RULE_TYPE = "required_status_checks"
  PULL_REQUEST_RULE_TYPE = "pull_request"
  RETIRED_RULE_TYPES = %w[code_quality code_coverage].freeze
  PRESERVED_KEYS = %w[id name target source_type enforcement bypass_actors conditions].freeze
  WRITE_KEYS = %w[name target enforcement bypass_actors conditions rules].freeze

  class Error < StandardError; end
  require_relative "ruleset_cutover_canary"
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
    if approved
      validate_contexts!(required)
      validate_required_checks!(required_rule(ruleset).last)
      validate_review_threads!(ruleset)
      residue = retired_rules(ruleset).map { |rule| rule["type"] }.uniq
      raise Error, "retired native rules remain: #{residue.join(", ")}" unless residue.empty?
    end
    required
  end
  def validate_required_checks!(checks)
    raise Error, "required checks must source-bind Review Gate to the GitHub Actions integration" unless checks == REQUIRED_CHECKS
  end
  def pull_request_rule(ruleset)
    matches = Array(ruleset.fetch("rules")).select { |rule| rule.is_a?(Hash) && rule["type"] == PULL_REQUEST_RULE_TYPE }
    raise Error, "ruleset must contain exactly one pull_request rule" unless matches.one?
    matches.first
  end
  def validate_review_threads!(ruleset)
    enabled = pull_request_rule(ruleset).dig("parameters", "required_review_thread_resolution")
    raise Error, "native review-thread resolution must be required" unless enabled == true
  end
  def enable_review_threads!(ruleset)
    parameters = pull_request_rule(ruleset).fetch("parameters")
    raise Error, "pull_request parameters must be an object" unless parameters.is_a?(Hash)
    parameters["required_review_thread_resolution"] = true
  end
  def deep_copy(value)
    JSON.parse(JSON.generate(value))
  end
  def candidate(ruleset)
    validate_ruleset!(ruleset)
    result = deep_copy(ruleset)
    result["rules"] = result.fetch("rules").reject { |rule| retired_rule?(rule) }
    rule, = required_rule(result)
    rule.fetch("parameters")["required_status_checks"] = deep_copy(REQUIRED_CHECKS)
    enable_review_threads!(result)
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
  def retired_rule?(rule)
    rule.is_a?(Hash) && RETIRED_RULE_TYPES.include?(rule["type"])
  end
  def retired_rules(ruleset)
    Array(ruleset.fetch("rules")).select { |rule| retired_rule?(rule) }
  end
  def preserved_rules(ruleset)
    non_required_rules(ruleset).reject do |rule|
      retired_rule?(rule) || (rule.is_a?(Hash) && rule["type"] == PULL_REQUEST_RULE_TYPE)
    end
  end
  def canonical_rules(ruleset)
    preserved_rules(ruleset).sort_by { |rule| JSON.generate(rule) }
  end
  def assert_preserved_fields!(before, after)
    PRESERVED_KEYS.each do |key|
      next unless before.key?(key)
      raise Error, "cutover changed protected ruleset field #{key}" unless before[key] == after[key]
    end
  end
  def assert_preserved!(before, after)
    assert_preserved_fields!(before, after)
    validate_ruleset!(after, approved: true)
    unless canonical_rules(before) == canonical_rules(after)
      raise Error, "cutover changed a non-required-status rule"
    end
    expected_pull = deep_copy(pull_request_rule(before))
    expected_pull.fetch("parameters")["required_review_thread_resolution"] = true
    raise Error, "cutover changed pull_request policy beyond review-thread resolution" unless pull_request_rule(after) == expected_pull
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
      "schema_version" => "ruleset-cutover/v2",
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

  def gh_json(path, *arguments)
    output, error, status = Open3.capture3("gh", "api", path, *arguments)
    raise Error, "gh api #{path} failed: #{error.strip}" unless status.success?

    JSON.parse(output)
  rescue JSON::ParserError => error
    raise Error, "gh api #{path} returned invalid JSON: #{error.message}"
  end

  def after_evidence_metadata(before, endpoint, canary_digest)
    {
      "schema_version" => "ruleset-cutover/v2",
      "endpoint" => endpoint,
      "before_snapshot_sha256" => snapshot_digest(snapshot(before, endpoint: endpoint)),
      "canary_sha256" => canary_digest,
      "actions_settings" => "not_requested",
      "status" => "verified-after-put"
    }
  end
  def after_evidence(before, after, endpoint, canary_digest)
    result = after_evidence_metadata(before, endpoint, canary_digest)
    result["required_contexts"] = contexts(after)
    result["payload_sha256"] = Digest::SHA256.hexdigest(JSON.generate(payload(after)))
    result
  end
  def write_after_evidence(directory, before, after, endpoint, canary_digest)
    FileUtils.mkdir_p(directory)
    dump(after_evidence(before, after, endpoint, canary_digest), File.join(directory, "ruleset-after.json"))
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
  def retain_canary(directory, canary)
    FileUtils.mkdir_p(directory)
    FileUtils.rm_f(File.join(directory, "ruleset-after.json"))
    dump(canary, File.join(directory, "ruleset-canary.json"))
  end

  def put_candidate(endpoint, payload_path)
    _output, error, status = Open3.capture3("gh", "api", "-X", "PUT", endpoint, "--input", payload_path)
    raise Error, "ruleset PUT failed: #{error.strip}" unless status.success?
  end

  def apply(repo:, ruleset_id:, evidence_dir:, expected_snapshot_digest: nil, canary_path: nil,
            expected_canary_digest: nil, now: Time.now.utc)
    assert_apply_authorized!(expected_snapshot_digest)
    raise Error, "live apply requires a canary artifact path" unless canary_path.is_a?(String)
    canary = parse(canary_path)
    load_canary!(canary, expected_canary_digest, repo: repo, ruleset_id: ruleset_id, now: now)
    endpoint = "repos/#{repo}/rulesets/#{ruleset_id}"
    before, before_snapshot = fetch_before(endpoint, expected_snapshot_digest)
    payload_path = write_apply_plan(evidence_dir, before_snapshot, candidate(before))
    revalidate_canary!(canary, repo: repo, ruleset_id: ruleset_id, now: now)
    retain_canary(evidence_dir, canary)
    put_candidate(endpoint, payload_path)
    verify_after(endpoint, before, evidence_dir, expected_canary_digest)
  end
  def verify_after(endpoint, before, evidence_dir, canary_digest)
    after = gh_json(endpoint)
    validate_ruleset!(after, approved: true)
    assert_preserved!(before, after)
    write_after_evidence(evidence_dir, before, after, endpoint, canary_digest)
    after
  end
end

load File.expand_path("ruleset_cutover_cli.rb", __dir__) if $PROGRAM_NAME == __FILE__
