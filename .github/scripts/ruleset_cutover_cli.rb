#!/usr/bin/env ruby
# frozen_string_literal: true

def usage
  <<~TEXT
    usage:
      ruby ruleset_cutover.rb validate RULESET.json
      ruby ruleset_cutover.rb candidate RULESET.json OUTPUT.json
      ruby ruleset_cutover.rb snapshot RULESET.json OUTPUT.json [ENDPOINT]
      ruby ruleset_cutover.rb canary CANARY.json
      ruby ruleset_cutover.rb apply REPO RULESET_ID EVIDENCE_DIR SNAPSHOT_DIGEST
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
    RulesetCutover.validate_canary!(evidence)
    puts "Ruleset canary evidence: blocked failing head, repaired head eligible, canary not merged"
  when "apply"
    repo, ruleset_id, evidence_dir, digest = require_arguments(arguments, 3)
    RulesetCutover.apply(repo: repo, ruleset_id: ruleset_id, evidence_dir: evidence_dir,
                         expected_snapshot_digest: digest)
    puts "Ruleset cutover applied and verified; evidence retained in #{evidence_dir}"
  else
    warn usage
    exit 2
  end
rescue KeyError => error
  warn "ruleset cutover: missing argument (#{error.message})\n#{usage}"
  exit 2
rescue RulesetCutover::Error => error
  warn "ruleset cutover: #{error.message}"
  exit 1
end
