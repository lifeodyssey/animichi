#!/usr/bin/env ruby
# frozen_string_literal: true

# S0-v2 B7 (GOAL B.21): four blocking workflow meta-assertions over
# .github/workflows/*.yml. Owned by CI's static-quality action, the fixed point
# that runs this script against itself.
#
#   timeout     every job that declares `runs-on:` must declare
#               `timeout-minutes:` (a missing timeout lets a hung job burn a
#               runner for hours; values follow the design-CI-1 table)
#   permissions every workflow must declare a top-level `permissions:` block
#               whose default is exactly `contents: read` — anything wider
#               must live at job level (ci.md "Least privilege")
#   concurrency PR-class workflows (pull_request / pull_request_target — each
#               produces one run per PR update and is judged in its own event
#               world) must declare a `concurrency` group with
#               cancel-in-progress for PR runs (CI-quota hygiene); workflows
#               that trigger on push must NOT cancel unconditionally (that
#               kills a deploy mid-flight). The two classes are judged
#               independently.
#   merge queue required-context producers must listen on `merge_group`.
#               Otherwise the merge queue waits forever or accepts fake green.
#               context -> workflow map below is the pinned snapshot of the
#               live ruleset (two PR-level aggregators; see
#               docs/ops/review-gate.md and
#               docs/iterations/s0v2/ruleset-target.json); drift in either
#               direction fails loudly: an owner workflow absent from the
#               directory is reported too.
#
# Every check is blocking: any violation line prints to stdout and the exit
# code is 1. No `continue-on-error` anywhere in the wiring (static-quality
# runs this step without one).
#
# Usage: ruby assert-workflow-invariants.rb [WORKFLOWS_DIR]
#   Defaults to <git root>/.github/workflows. A dir argument makes the
#   behavioral tests drive the real script against throwaway fixtures.
#
# Parsing choice: Ruby's stdlib YAML (Psych), like test_ci_contract.rb. The
# top-level `on:` key is re-quoted before parsing because YAML 1.1 reads the
# bare word `on` as boolean true (Norway-problem family) for every legal
# shorthand — `on:`, `on: pull_request`, `on: [push, pull_request]` all parse
# with key `true` and the trigger map would silently vanish. The re-quote
# below covers all three forms; `triggers` additionally falls back to the
# boolean key so an unreached shorthand can never be misread as "no triggers".
# YAML validity itself is owned by the actionlint step in the static-quality action.

require "yaml"
require_relative "assert-workflow-invariants-expression"

# Branch-protection required contexts -> workflow that produces each one.
# Snapshot of the post-#1180 live ruleset. Update this table whenever the
# ruleset changes, and add a queue-safe producer for any new context. The
# guarded target has one code-CI check-run and one classic review status;
# package/security child jobs remain visible evidence but are not independently
# required.
REQUIRED_CONTEXTS = {
  "PR Verification" => "pr-verification.yml",
  "Security" => "pr-verification.yml"
}.freeze

# Events that produce one run per pull-request update and therefore share the
# same CI-quota hygiene rule. Judged per event in its own world (see
# world_for_pr_event): a cancel expression that only cancels `pull_request`
# runs must not satisfy a workflow that fires on `pull_request_target`.
PR_CLASS_EVENTS = %w[pull_request pull_request_target].freeze

def workflow_dir
  if ARGV[0]
    ARGV[0]
  else
    root = `git rev-parse --show-toplevel`.strip
    File.join(root, ".github", "workflows")
  end
end

def load_workflow(path)
  text = File.read(path).sub(/^on:(?=[ \t#]|$)/, '"on":')
  YAML.safe_load(text, permitted_classes: [], permitted_symbols: [], aliases: true)
end

# Normalize the three legal `on:` shapes into an event-name map:
#   on: pull_request           -> {"pull_request" => nil}
#   on: [push, pull_request]   -> {"push" => nil, "pull_request" => nil}
#   on:\n  pull_request: ...   -> {"pull_request" => ...}
# Falls back to the YAML 1.1 boolean key when the re-quote somehow missed
# (e.g. `on :` with a space before the colon). Returns nil when `on` is
# absent or of an unexpected type — absent means fail-closed, never guess.
def triggers(wf)
  return nil unless wf.is_a?(Hash)

  raw = wf.key?("on") ? wf["on"] : wf[true]
  case raw
  when Hash then raw
  when String then { raw => nil }
  when Array then raw.to_h { |event| [event, nil] }
  end
end

def cancel_in_progress(concurrency)
  concurrency.is_a?(Hash) ? concurrency["cancel-in-progress"] : nil
end

# True/UNKNOWN if the expression is true in the given world; false otherwise.
# Literal YAML booleans short-circuit; expressions are judged semantically
# (see expr_eval), and anything unjudgeable is UNKNOWN so the caller
# fail-closes instead of letting a bypass through.
def cancels_in_world?(value, world)
  return value if value == true || value == false
  return false unless value.is_a?(String)

  verdict = expr_verdict(value, world)
  verdict == UNKNOWN ? UNKNOWN : verdict
end

def cancels_pull_requests?(value, event = "pull_request")
  cancels_in_world?(value, world_for_pr_event(event))
end

def cancels_push?(value)
  cancels_in_world?(value, WORLD_PUSH_MAIN)
end

def job_timeout_violations(file, wf)
  jobs = wf.is_a?(Hash) ? wf["jobs"] : nil
  return [] unless jobs.is_a?(Hash)

  jobs.map do |name, job|
    next nil unless job.is_a?(Hash) && job.key?("runs-on") && !job.key?("timeout-minutes")

    "#{file}:#{name}:missing timeout-minutes"
  end.compact
end

def permissions_violations(file, wf)
  return ["#{file}:top-level:missing permissions"] unless wf.is_a?(Hash) && wf.key?("permissions")

  perms = wf["permissions"]
  if perms.is_a?(String)
    return ["#{file}:top-level:permissions must be contents: read (got: #{perms})"] unless perms == "contents: read"
  elsif perms.is_a?(Hash)
    return ["#{file}:top-level:permissions must be contents: read (got: #{perms.sort.map { |k, v| "#{k}: #{v}" }.join(', ')})"] unless perms == { "contents" => "read" }
  else
    return ["#{file}:top-level:permissions must be contents: read (got: #{perms.inspect})"]
  end
  []
end

def concurrency_violations(file, wf)
  on_map = triggers(wf)
  return [] unless on_map.is_a?(Hash)

  concurrency = wf["concurrency"]
  violations = []
  pr_events = on_map.keys & PR_CLASS_EVENTS
  if pr_events.any?
    if !concurrency.is_a?(Hash)
      violations << "#{file}:top-level:missing concurrency (#{pr_events.join('/')}-triggered)"
    else
      violations << "#{file}:top-level:concurrency must declare a group" unless concurrency["group"]
      pr_events.each do |event|
        verdict = cancels_pull_requests?(cancel_in_progress(concurrency), event)
        case verdict
        when true then nil
        when UNKNOWN then violations << "#{file}:top-level:cannot judge cancel-in-progress for #{event} runs, confirm manually (#{cancel_in_progress(concurrency).inspect})"
        else violations << "#{file}:top-level:concurrency must cancel #{event} runs (cancel-in-progress: #{cancel_in_progress(concurrency).inspect})"
        end
      end
    end
  end
  if on_map.key?("push") && concurrency.is_a?(Hash)
    verdict = cancels_push?(cancel_in_progress(concurrency))
    case verdict
    when false then nil
    when UNKNOWN then violations << "#{file}:top-level:cannot judge cancel-in-progress for push runs, confirm manually (#{cancel_in_progress(concurrency).inspect})"
    else violations << "#{file}:top-level:concurrency must not cancel push runs (would kill a deploy mid-flight)"
    end
  end
  violations
end

# GitHub names a reusable job's check-run "<caller display name> / <callee job
# name>". producer_names expands reusable callers into those names so
# REQUIRED_CONTEXTS entries can be matched against real check-run producers;
# a caller whose reusable file is missing produces nothing (fail-closed).
def producer_names(dir, wf)
  return [] unless wf.is_a?(Hash) && wf["jobs"].is_a?(Hash)

  names = wf["jobs"].flat_map do |job_id, job|
    next [] unless job.is_a?(Hash)

    display = job["name"] || job_id
    callee = job["uses"]
    next [display] unless callee&.start_with?("./.github/workflows/reusable-")

    reusable_path = File.join(dir, File.basename(callee))
    next [] unless File.exist?(reusable_path)

    reusable = load_workflow(reusable_path)
    next [] unless reusable.is_a?(Hash) && reusable["jobs"].is_a?(Hash)

    reusable["jobs"].map do |callee_id, callee_job|
      next nil unless callee_job.is_a?(Hash)

      "#{display} / #{callee_job['name'] || callee_id}"
    end.compact
  end
  names
end

def direct_queue_producer?(on_map)
  merge_group = on_map["merge_group"]
  merge_group.is_a?(Hash) && Array(merge_group["branches"]).include?("main")
end

def queue_producer?(_context, on_map, _wf)
  direct_queue_producer?(on_map)
end

def merge_group_violations(dir, file, wf)
  on_map = triggers(wf)
  return [] unless on_map.is_a?(Hash)

  violations = []
  contexts = REQUIRED_CONTEXTS.select { |_ctx, owner| owner == file }.keys
  missing = contexts.reject { |context| queue_producer?(context, on_map, wf) }
  unless missing.empty?
    violations << "#{file}:top-level:missing queue-safe producer (required contexts: #{missing.join(', ')})"
  end
  if file.start_with?("pipeline-") && !on_map.key?("workflow_call") && !on_map.key?("merge_group")
    violations << "#{file}:top-level:missing merge_group trigger (pipeline fixed point)"
  end
  if contexts.any?
    producer_names(dir, wf).tap do |job_names|
      contexts.each do |ctx|
        next if job_names.include?(ctx)

        violations << "#{file}:top-level:required context not produced by any job (#{ctx})"
      end
    end
  end
  violations
end

def main
  dir = workflow_dir
  abort "assert-workflow-invariants: no such directory: #{dir}" unless Dir.exist?(dir)
  files = Dir.glob(File.join(dir, "*.yml")).sort
  abort "assert-workflow-invariants: no workflow files under #{dir}" if files.empty?

  violations = []
  names = files.map { |path| File.basename(path) }
  REQUIRED_CONTEXTS.values.uniq.each do |owner|
    next if names.include?(owner)

    violations << "#{owner}:top-level:missing required-context owner workflow"
  end
  files.each do |path|
    file = File.basename(path)
    wf = begin
      load_workflow(path)
    rescue StandardError => e
      violations << "#{file}:top-level:unparseable YAML (#{e.message})"
      next
    end
    unless triggers(wf).is_a?(Hash)
      violations << "#{file}:top-level:missing on: triggers (unparseable or absent)"
      next
    end
    violations.concat(job_timeout_violations(file, wf))
    violations.concat(permissions_violations(file, wf))
    violations.concat(concurrency_violations(file, wf))
    violations.concat(merge_group_violations(dir, file, wf))
  end

  if violations.any?
    puts violations
    exit 1
  end
  puts "checked #{files.length} workflow files, all invariants hold"
end

main if $PROGRAM_NAME == __FILE__
