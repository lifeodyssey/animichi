# frozen_string_literal: true

# CI↔pre-push parity contract (#1114). Discover CI checkpoints from workflow
# run steps (and the scripts those steps invoke), diff against what pre-push
# actually runs, and require the remainder on an exemption list with a reason
# naming the CI-only resource (secrets / OIDC / cloud / deploy).
#
# Usage: ruby .github/scripts/test_ci_prepush_parity.rb

require "pathname"
require "yaml"
require_relative "ci_prepush_parity_yaml"
require_relative "ci_prepush_parity_extract"

ParityPaths = Struct.new(:root, :workflows, :quality, :pre_push, :exemptions, keyword_init: true)

REASON_CLASS = /\A(secrets|OIDC|cloud|deploy):\s+(?!(?i:n\/a|na|none|skip)\b)\S/
REASON_WAFFLE = /\bnot a (?:pre-push prerequisite|local agent extra)\b/i
DRIFT_ALIAS = "cmd:contract::git diff --cached --exit-code -- openapi.json users-openapi.json agent-openapi.json"

def default_parity_paths
  root = `git rev-parse --show-toplevel`.strip
  abort "cannot resolve the repository root (git rev-parse --show-toplevel failed)" unless $?.success? && !root.empty? && Dir.exist?(root)
  ParityPaths.new(
    root: root,
    workflows: File.join(root, ".github/workflows"),
    quality: File.join(root, "scripts/local-gates/quality.sh"),
    pre_push: File.join(root, "scripts/local-gates/pre-push.sh"),
    exemptions: File.join(root, ".github/scripts/ci-prepush-parity-exemptions.yml")
  )
end

def discover_ci_checkpoints(paths)
  found, seen, queue = [], {}, enqueue_merge_gating(paths.workflows)
  drain_workflow_queue(queue, seen, found, paths.root)
  found.uniq.sort
end

def drain_workflow_queue(queue, seen, found, root)
  until queue.empty?
    path = queue.shift
    next if seen[path]

    seen[path] = true
    take_workflow(path, root, found, queue)
  end
end

def take_workflow(path, root, found, queue)
  fps, reusables = workflow_checkpoints(path, root)
  found.concat(fps)
  enqueue_reusables(queue, root, reusables)
end

def enqueue_reusables(queue, root, reusables)
  reusables.each do |rel|
    child = File.join(root, rel)
    queue << child if File.exist?(child)
  end
end

def workflow_checkpoints(path, root)
  wf = load_yaml_file(path)
  return [[], []] unless wf.is_a?(Hash) && wf["jobs"].is_a?(Hash)

  collect_jobs(wf["jobs"], root)
end

def collect_jobs(jobs, root)
  found, reusables = [], []
  jobs.each_value { |job| collect_one_job(job, root, found, reusables) }
  [found, reusables]
end

def collect_one_job(job, root, found, reusables)
  return unless job.is_a?(Hash)
  return if skip_dependabot_job?(job)

  collect_job(job, root, found, reusables)
end

def collect_job(job, root, found, reusables)
  return enqueue_job_reusable(job, reusables) if local_reusable?(job["uses"].to_s)

  collect_steps(job, root, found)
end

def enqueue_job_reusable(job, reusables)
  reusables << uses_action_name(job["uses"])
end

def collect_steps(job, root, found)
  wd = job_working_directory(job)
  Array(job["steps"]).each { |step| found.concat(step_checkpoints(step, wd, root)) if step.is_a?(Hash) }
end

def step_checkpoints(step, wd, root)
  step_wd = step["working-directory"] || wd
  return run_step_checkpoints(step["run"], step_wd, root) if step["run"]
  return [] unless step["uses"]
  return [] if skip_uses_action?(step["uses"])
  return [] if local_reusable?(step["uses"])

  uses_checkpoints(step, step_wd, root)
end

def run_step_checkpoints(run, wd, root)
  found = fingerprints_from_run(run, wd)
  found + local_script_checkpoints(found, root)
end

def local_script_checkpoints(found, root)
  found.grep(/\Ascript:/).flat_map do |fingerprint|
    relative = fingerprint.delete_prefix("script:")
    next [] unless relative.start_with?("scripts/local-gates/") && relative.end_with?(".sh")

    local_gate_checkpoints(File.join(root, relative))
  end
end

def local_gate_checkpoints(path)
  return [] unless File.file?(path)

  text = expand_gate_vars(File.read(path))
  run_line_fps(text) + syntax_script_fps(text) + glob_cov_patch(text, path)
end

def uses_checkpoints(step, step_wd, root)
  name = uses_action_name(step["uses"])
  inputs = (step["with"] || {}).transform_keys(&:to_s)
  return composite_command_fps(name, inputs, step_wd, root) if local_composite?(step["uses"])
  return ruff_action_fp(step, step_wd) if name.start_with?("astral-sh/ruff-action")
  return [] if name == "pulumi/actions" && inputs["command"].to_s.empty?

  ["uses:#{name}"]
end

def composite_command_fps(name, inputs, step_wd, root)
  path = File.join(root, name, "action.yml")
  return [] unless File.exist?(path)

  working_directory = inputs["working-directory"] || step_wd
  action = load_yaml_file(path)
  steps = action.is_a?(Hash) ? action.dig("runs", "steps") : nil
  found = command_input_fps(inputs, working_directory)
  Array(steps).each do |step|
    found.concat(step_checkpoints(step, working_directory, root)) if step.is_a?(Hash)
  end
  found
end

def command_input_fps(inputs, wd)
  found = []
  inputs.each { |key, val| append_command_input(found, key, val, wd) }
  found
end

def append_command_input(found, key, val, wd)
  return unless key.end_with?("command") && !val.to_s.strip.empty?

  found.concat(fingerprints_from_run(val.to_s, wd))
end

def ruff_action_fp(step, wd)
  args = (step["with"] || {})["args"].to_s
  args = "check" if args.empty?
  pkg = package_from_dir((step["with"] || {})["working-directory"] || wd)
  prefix = pkg ? "#{pkg}::" : ""
  [canonical_fingerprint("cmd:#{prefix}ruff #{args}")]
end

def discover_prepush_coverage(paths)
  fps = quality_checkpoints(paths.quality) + gate_checkpoints(paths.pre_push)
  fps << DRIFT_ALIAS if fps.include?("script:scripts/local-gates/contract-drift.sh")
  fps.map { |fp| canonical_fingerprint(fp) }.uniq.sort
end

def quality_checkpoints(quality_path)
  text = expand_gate_vars(File.read(quality_path))
  found = run_line_fps(text)
  found.concat(syntax_script_fps(text))
  found.concat(glob_cov_patch(text, quality_path))
end

def glob_cov_patch(text, quality_path)
  return [] unless text.include?("test_*cov_patch")

  root = File.expand_path("../..", File.dirname(quality_path))
  Dir.glob(File.join(root, ".github/scripts/test_*cov_patch.rb")).map do |path|
    "script:#{Pathname.new(path).relative_path_from(root)}"
  end
end

def run_line_fps(text)
  found = []
  text.lines.each do |line|
    stripped = strip_shell_comment(line)
    next unless stripped.start_with?("run ")

    found.concat(fingerprints_from_run(stripped.sub(/\Arun\s+/, ""), nil))
  end
  found
end

def gate_checkpoints(pre_push_path)
  text = File.read(pre_push_path)
  extra = File.join(File.dirname(pre_push_path), "pre-push-worker-gates.sh")
  text += File.read(extra) if File.exist?(extra)
  found = []
  text.scan(/^(?:gate_\w+|run_pre_push)\(\) \{([\s\S]*?)^\}/) do |(body)|
    found.concat(gate_body_fps(body))
  end
  found
end

def gate_body_fps(body)
  body.lines.flat_map { |line| gate_line_fps(strip_shell_comment(line)) }
end

def gate_line_fps(stripped)
  return fingerprints_from_run(Regexp.last_match(2), Regexp.last_match(1)) if stripped =~ /\bgate\s+(\S+)\s+(.+)/
  return fingerprints_from_run(Regexp.last_match(1), nil) if stripped =~ /\brun\s+(.+)/

  []
end

def load_exemptions(path)
  data = YAML.safe_load(File.read(path))
  abort "#{path} must be a mapping with exemptions:" unless data.is_a?(Hash)
  list = data["exemptions"]
  abort "#{path} exemptions must be a list" unless list.is_a?(Array)

  list
end

def exemption_ids(list)
  list.map do |entry|
    abort "exemption is missing id" unless entry.is_a?(Hash) && entry["id"].is_a?(String) && !entry["id"].empty?

    entry["id"]
  end
end

def reason_violations(list)
  list.map { |entry| reason_violation(entry) }.compact
end

def reason_violation(entry)
  reason = entry["reason"]
  return "#{entry['id']}: exemption is missing a reason field" unless reason.is_a?(String)
  return "#{entry['id']}: exemption reason is empty" if reason.strip.empty?
  return nil if structured_reason?(reason)

  "#{entry['id']}: reason must name a CI-only resource (secrets|OIDC|cloud|deploy: <resource>)"
end

def structured_reason?(reason)
  reason.match?(REASON_CLASS) && !reason.match?(REASON_WAFFLE)
end

def parity_violations(paths)
  remainder = discover_ci_checkpoints(paths) - discover_prepush_coverage(paths)
  list = load_exemptions(paths.exemptions)
  ids = exemption_ids(list)
  reason_violations(list) + leftover_lines(remainder - ids) + stale_lines(ids - remainder)
end

def leftover_lines(leftover)
  leftover.map { |id| "uncovered CI checkpoint not on the exemption list: #{id}" }
end

def stale_lines(stale)
  stale.map { |id| "stale exemption (not a current remainder): #{id}" }
end

def assert_parity!(paths = default_parity_paths)
  found = parity_violations(paths)
  if found.empty?
    puts "CI↔pre-push parity: remainder is fully exempted with reasons"
    return
  end

  puts found.sort
  abort "CI↔pre-push parity contract violated (#{found.length} issue(s))"
end
