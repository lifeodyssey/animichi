#!/usr/bin/env ruby
# frozen_string_literal: true

# S0-v2 B7 (GOAL B.21): four blocking workflow meta-assertions over
# .github/workflows/*.yml. Owned by the Quality lane (pipeline-quality.yml,
# the fixed point that runs this script against itself).
#
#   timeout     every job that declares `runs-on:` must declare
#               `timeout-minutes:` (a missing timeout lets a hung job burn a
#               runner for hours; values follow the design-CI-1 table)
#   permissions every workflow must declare a top-level `permissions:` block
#               whose default is exactly `contents: read` — anything wider
#               must live at job level (ci.md "Least privilege")
#   concurrency PR-triggered workflows must declare a `concurrency` group with
#               cancel-in-progress for PR runs (CI-quota hygiene); workflows
#               that trigger on push must NOT cancel unconditionally (that
#               kills a deploy mid-flight). The two classes are judged
#               independently.
#   merge_group workflows whose jobs produce branch-protection required
#               contexts must listen on `merge_group` — otherwise the merge
#               queue waits forever on a check that never runs. The required
#               context -> workflow map below is the pinned snapshot of the
#               current ruleset (9 contexts; docs/ops/deployment.md "Main
#               promotion path"); drift in either direction fails loudly.
#
# Every check is blocking: any violation line prints to stdout and the exit
# code is 1. No `continue-on-error` anywhere in the wiring (pipeline-quality
# runs this step without one).
#
# Usage: ruby assert-workflow-invariants.rb [WORKFLOWS_DIR]
#   Defaults to <git root>/.github/workflows. A dir argument makes the
#   behavioral tests drive the real script against throwaway fixtures.
#
# Parsing choice: Ruby's stdlib YAML (Psych), like test_ci_contract.rb. The
# top-level `on:` key is re-quoted before parsing because YAML 1.1 reads the
# bare word `on` as boolean true — without the re-quote the trigger map would
# silently vanish and every event-dependent check would misjudge. YAML
# validity itself is owned by the actionlint step in pipeline-quality.yml.

require "yaml"

# Branch-protection required contexts -> workflow that produces each one.
# Snapshot of the current ruleset (9 contexts). Update this table whenever
# the ruleset changes (e.g. the planned 7 -> ~26 per-package stage split),
# and add merge_group to any newly-required workflow.
REQUIRED_CONTEXTS = {
  "Backend CI" => "ci.yml",
  "Agent CI" => "ci.yml",
  "Infra & DB CI" => "ci.yml",
  "Cross-stack E2E" => "ci.yml",
  "Repository Quality" => "ci.yml",
  "Codecov Patch" => "ci.yml",
  "Web / lint" => "pipeline-web.yml",
  "Web / test" => "pipeline-web.yml",
  "Web / build" => "pipeline-web.yml"
}.freeze

def workflow_dir
  if ARGV[0]
    ARGV[0]
  else
    root = `git rev-parse --show-toplevel`.strip
    File.join(root, ".github", "workflows")
  end
end

def load_workflow(path)
  text = File.read(path).gsub(/^on:[ \t]*(#.*)?$/, '"on":')
  YAML.safe_load(text, permitted_classes: [], permitted_symbols: [], aliases: true)
end

def triggers(wf)
  wf.is_a?(Hash) ? wf["on"] : nil
end

def cancel_in_progress(concurrency)
  concurrency.is_a?(Hash) ? concurrency["cancel-in-progress"] : nil
end

# `true`, or any expression the template family uses for PR-scoped cancels
# (design CI-1: `${{ github.event_name == 'pull_request' }}`).
def cancels_pull_requests?(value)
  value == true || (value.is_a?(String) && value.include?("pull_request"))
end

# Literal `true` unconditionally cancels push-to-main runs; an expression
# matching `== 'push'` cancels them too. The sanctioned template is false on
# push, so only these two shapes are flagged.
def cancels_push?(value)
  value == true || (value.is_a?(String) && (value.include?("'push'") || value.include?('"push"')))
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
  if on_map.key?("pull_request")
    if !concurrency.is_a?(Hash)
      violations << "#{file}:top-level:missing concurrency (pull_request-triggered)"
    else
      violations << "#{file}:top-level:concurrency must declare a group" unless concurrency["group"]
      cancel = cancel_in_progress(concurrency)
      unless cancels_pull_requests?(cancel)
        violations << "#{file}:top-level:concurrency must cancel pull_request runs (cancel-in-progress: #{cancel.inspect})"
      end
    end
  end
  if on_map.key?("push") && concurrency.is_a?(Hash) && cancels_push?(cancel_in_progress(concurrency))
    violations << "#{file}:top-level:concurrency must not cancel push runs (would kill a deploy mid-flight)"
  end
  violations
end

def merge_group_violations(file, wf)
  on_map = triggers(wf)
  return [] unless on_map.is_a?(Hash)

  violations = []
  contexts = REQUIRED_CONTEXTS.select { |_ctx, owner| owner == file }.keys
  unless contexts.empty? || on_map.key?("merge_group")
    violations << "#{file}:top-level:missing merge_group trigger (required contexts: #{contexts.join(', ')})"
  end
  if file.start_with?("pipeline-") && !on_map.key?("merge_group")
    violations << "#{file}:top-level:missing merge_group trigger (pipeline fixed point)"
  end
  if contexts.any? && wf["jobs"].is_a?(Hash)
    job_names = wf["jobs"].values.select { |j| j.is_a?(Hash) }.map { |j| j["name"] }
    contexts.each do |ctx|
      next if job_names.include?(ctx)

      violations << "#{file}:top-level:required context not produced by any job (#{ctx})"
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
    violations.concat(merge_group_violations(file, wf))
  end

  if violations.any?
    puts violations
    exit 1
  end
  puts "checked #{files.length} workflow files, all invariants hold"
end

main
