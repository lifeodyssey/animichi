# frozen_string_literal: true
#
# Ruleset migration contract (issue #679 AC6): a component/security required
# status check must be ADDED and producible on merge_group BEFORE it can
# REPLACE/REMOVE an old one, so the merge queue never hangs on a context that
# never fires (bypass_actors: [] means nobody can clear it either).
#
# Asserts, all statically against the current snapshot without touching the
# live ruleset:
#   A. add-before-remove bookkeeping: `_retired_contexts` is disjoint from
#      `required_checks` — a context cannot be both live and retired, and a
#      removal must be recorded (never a silent drop).
#   B. every required check has a producing job (no orphan required context).
#   C. every required check's producing workflow declares merge_group on main,
#      so queue runs stay green (the old -> new transition never strands a check).
#   D. snapshot discipline: assert-workflow-invariants.rb REQUIRED_CONTEXTS table
#      equals ruleset-target.json required_checks — a new required name MUST be
#      mirrored in that table (and its workflow merge_group trigger) before old
#      names are retired; drift fails loudly.
#
# Pattern: test_ci_contract*.rb (YAML/JSON safe_load, abort on violation).

require "json"
require "yaml"

REPO_ROOT = File.expand_path("../..", __dir__)
DEFAULT_RULESET = File.join(REPO_ROOT, "docs", "iterations", "s0v2", "ruleset-target.json")
DEFAULT_WORKFLOWS = File.join(REPO_ROOT, ".github", "workflows")

# Reusable-callee producer expansion: a reusable job check-run is named
# "<caller display name> / <callee job name>" (mirrors test_ci_contract.rb).
def producer_contexts(workflows_dir, wf)
  return [] unless wf.is_a?(Hash) && wf["jobs"].is_a?(Hash)

  wf["jobs"].flat_map do |job_id, job|
    next [] unless job.is_a?(Hash)

    display = job["name"] || job_id
    uses = job["uses"]
    next [display] unless uses&.start_with?("./.github/workflows/reusable-")

    reusable_path = File.join(workflows_dir, File.basename(uses))
    next [] unless File.exist?(reusable_path)

    reusable = YAML.safe_load(File.read(reusable_path))
    next [] unless reusable.is_a?(Hash) && reusable["jobs"].is_a?(Hash)

    reusable["jobs"].map do |callee_id, callee_job|
      next nil unless callee_job.is_a?(Hash)

      "#{display} / #{callee_job["name"] || callee_id}"
    end.compact
  end.flatten
end

# Also returns the set of workflow FILES that produce each context (for the
# merge_group assertion).
def producer_map(workflows_dir)
  map = {}
  Dir.glob(File.join(workflows_dir, "*.yml")).sort.each do |path|
    file = File.basename(path)
    next if file.start_with?("reusable-")

    wf = begin
      text = File.read(path).sub(/^on:(?=[ \t#]|$)/, '"on":')
      YAML.safe_load(text, aliases: true)
    rescue StandardError
      next
    end
    producer_contexts(workflows_dir, wf).each { |ctx| (map[ctx] ||= []) << File.join(workflows_dir, file) }
  end
  map
end

# True when the workflow declares a merge_group trigger targeting main.
def declares_merge_group_main?(path)
  text = File.read(path).sub(/^on:(?=[ \t#]|$)/, '"on":')
  wf = YAML.safe_load(text, aliases: true)
  on_map = wf.is_a?(Hash) ? (wf["on"] || wf[true]) : nil
  return false unless on_map.is_a?(Hash)

  mg = on_map["merge_group"]
  mg.is_a?(Hash) && Array(mg["branches"]).include?("main")
end

def assert_ruleset_migration_contract(ruleset_path: DEFAULT_RULESET, workflows_dir: DEFAULT_WORKFLOWS)
  ruleset = JSON.parse(File.read(ruleset_path))
  required = Array(ruleset.fetch("required_checks"))
  retired = Array(ruleset.fetch("_retired_contexts"))

  # A. add-before-remove bookkeeping.
  overlap = required & retired
  abort "ruleset migration: a context cannot be both required and retired: #{overlap.join(", ")}" unless overlap.empty?

  map = producer_map(workflows_dir)
  missing = required - map.keys
  abort "ruleset migration: required check with no producing job (ADD before REMOVE): #{missing.join(", ")}" unless missing.empty?

  # B + C. every producer workflow must fire on merge_group so the queue stays green.
  not_on_queue = required.reject { |ctx| (map[ctx] || []).any? { |p| declares_merge_group_main?(p) } }
  abort "ruleset migration: required check not produced on merge_group (queue would hang): #{not_on_queue.join(", ")}" unless not_on_queue.empty?

  # D. snapshot discipline with assert-workflow-invariants.rb REQUIRED_CONTEXTS.
  invariants = File.read(File.join(__dir__, "assert-workflow-invariants.rb"))
  declared = invariants.scan(/^\s+"([^"]+\/ [^"]+)"\s*=>\s*"([^"]+)"/).map(&:first)
  drift = required.sort - declared.sort
  abort "ruleset migration: required checks missing from assert-workflow-invariants.rb REQUIRED_CONTEXTS (update it in the same change): #{drift.join(", ")}" unless drift.empty?
  extra = declared.sort - required.sort
  abort "ruleset migration: assert-workflow-invariants.rb REQUIRED_CONTEXTS lists a non-required check (retire it or delete old name first): #{extra.join(", ")}" unless extra.empty?

  puts "Ruleset migration: #{required.size} required checks, #{retired.size} retired, disjoint; all covered on merge_group; invariant table in sync"
end

if $PROGRAM_NAME == __FILE__
  ruleset_path = ARGV[0] || DEFAULT_RULESET
  workflows_dir = ARGV[1] || DEFAULT_WORKFLOWS
  assert_ruleset_migration_contract(ruleset_path: ruleset_path, workflows_dir: workflows_dir)
end
