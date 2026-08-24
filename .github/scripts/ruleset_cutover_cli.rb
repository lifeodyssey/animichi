#!/usr/bin/env ruby
# frozen_string_literal: true

def usage
  <<~TEXT
    usage:
      ruby ruleset_cutover.rb validate RULESET.json
      ruby ruleset_cutover.rb candidate RULESET.json OUTPUT.json
      ruby ruleset_cutover.rb snapshot RULESET.json OUTPUT.json [ENDPOINT]
      ruby ruleset_cutover.rb capture OUTPUT.json REPO RULESET_ID PR_NUMBER MERGE_GROUP_CI_RUN_ID
      ruby ruleset_cutover.rb canary CANARY.json REPO RULESET_ID
      ruby ruleset_cutover.rb apply REPO RULESET_ID EVIDENCE_DIR SNAPSHOT_DIGEST CANARY.json CANARY_DIGEST
  TEXT
end

def require_arguments(arguments, count)
  raise KeyError, "expected #{count} arguments, got #{arguments.length}" if arguments.length < count

  arguments
end

begin
  command, *arguments = ARGV
  case command
  when "validate"
    ruleset = RulesetCutover.parse(arguments.fetch(0))
    RulesetCutover.validate_ruleset!(ruleset, approved: true)
    puts "Ruleset cutover contract: exactly #{RulesetCutover::APPROVED_CONTEXTS.join(", ")}"
  when "candidate"
    input, output = require_arguments(arguments, 2)
    candidate = RulesetCutover.candidate(RulesetCutover.parse(input))
    RulesetCutover.dump(RulesetCutover.payload(candidate), output)
    puts "Wrote candidate payload: #{output}"
  when "snapshot"
    input, output, endpoint = require_arguments(arguments, 2)
    snap = RulesetCutover.snapshot(RulesetCutover.parse(input), endpoint: endpoint)
    RulesetCutover.dump(snap, output)
    puts "Wrote recovery snapshot: #{output} (#{RulesetCutover.snapshot_digest(snap)})"
  when "canary"
    evidence = RulesetCutover.parse(arguments.fetch(0))
    repo, ruleset_id = arguments.fetch(1), arguments.fetch(2)
    RulesetCutover.validate_canary!(evidence, repo: repo, ruleset_id: ruleset_id)
    puts "Ruleset canary evidence: PR and merge_group heads have both exact successful contexts"
    puts "Canary SHA256: #{RulesetCutover.canary_digest(evidence)}"
  when "capture"
    output, repo, ruleset_id, pr_number, merge_run_id = require_arguments(arguments, 5)
    evidence = RulesetCutover.capture_canary(repo: repo, ruleset_id: ruleset_id,
                                             pr_number: Integer(pr_number, 10),
                                             merge_run_id: Integer(merge_run_id, 10))
    RulesetCutover.dump(evidence, output)
    puts "Captured GitHub API canary: #{output}"
    puts "Canary SHA256: #{RulesetCutover.canary_digest(evidence)}"
  when "apply"
    repo, ruleset_id, evidence_dir, digest, canary_path, canary_digest = require_arguments(arguments, 6)
    RulesetCutover.apply(repo: repo, ruleset_id: ruleset_id, evidence_dir: evidence_dir,
                         expected_snapshot_digest: digest, canary_path: canary_path,
                         expected_canary_digest: canary_digest)
    puts "Ruleset cutover applied and verified; evidence retained in #{evidence_dir}"
  else
    warn usage
    exit 2
  end
rescue KeyError, ArgumentError => error
  warn "ruleset cutover: missing argument (#{error.message})\n#{usage}"
  exit 2
rescue RulesetCutover::Error => error
  warn "ruleset cutover: #{error.message}"
  exit 1
end
