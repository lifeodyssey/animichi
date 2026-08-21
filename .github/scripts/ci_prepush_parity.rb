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

REASON_RE = /\b(secret|secrets|oidc|cloud|deploy)\b/i
DRIFT_ALIAS = "cmd:contract::git diff --cached --exit-code -- openapi.json users-openapi.json agent-openapi.json"

def default_parity_paths
  root = `git rev-parse --show-toplevel`.strip
  ParityPaths.new(
    root: root,
    workflows: File.join(root, ".github/workflows"),
    quality: File.join(root, "scripts/local-gates/quality.sh"),
    pre_push: File.join(root, "scripts/local-gates/pre-push.sh"),
    exemptions: File.join(root, ".github/scripts/ci-prepush-parity-exemptions.yml")
  )
end

def discover_ci_checkpoints(paths)
  found = []
  seen = {}
  queue = enqueue_merge_gating(paths.workflows)
  until queue.empty?
    path = queue.shift
    next if seen[path]

    seen[path] = true
    fps, reusables = workflow_checkpoints(path, paths.root)
    found.concat(fps)
    enqueue_reusables(queue, paths.root, reusables)
  end
  found.uniq.sort
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

  found = []
  reusables = []
  wf["jobs"].each_value do |job|
    next unless job.is_a?(Hash)
    next if skip_dependabot_job?(job)

    collect_job(job, root, found, reusables)
  end
  [found, reusables]
end

def collect_job(job, root, found, reusables)
  if local_reusable?(job["uses"].to_s)
    reusables << uses_action_name(job["uses"])
    return
  end

  wd = job_working_directory(job)
  Array(job["steps"]).each do |step|
    next unless step.is_a?(Hash)

    found.concat(step_checkpoints(step, wd, root))
  end
end

def step_checkpoints(step, wd, root)
  step_wd = step["working-directory"] || wd
  return fingerprints_from_run(step["run"], step_wd) if step["run"]
  return [] unless step["uses"]
  return [] if skip_uses_action?(step["uses"])
  return [] if local_reusable?(step["uses"])

  uses_checkpoints(step, step_wd, root)
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

  wd = inputs["working-directory"] || step_wd
  found = []
  inputs.each do |key, val|
    next unless key.end_with?("command")
    next if val.to_s.strip.empty?

    found.concat(fingerprints_from_run(val.to_s, wd))
  end
  found
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
  found.concat(text.scan(LISTED_SCRIPTS).map { |path| "script:#{path}" })
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
  found = []
  text.scan(/^gate_(\w+)\(\) \{([\s\S]*?)^\}/) do |_pkg, body|
    found.concat(gate_body_fps(body))
  end
  found
end

def gate_body_fps(body)
  found = []
  body.lines.each do |line|
    stripped = strip_shell_comment(line)
    if stripped =~ /\bgate\s+(\S+)\s+(.+)/
      found.concat(fingerprints_from_run(Regexp.last_match(2), Regexp.last_match(1)))
    elsif stripped =~ /\brun\s+(.+)/
      found.concat(fingerprints_from_run(Regexp.last_match(1), nil))
    end
  end
  found
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
  found = []
  list.each do |entry|
    msg = reason_violation(entry)
    found << msg if msg
  end
  found
end

def reason_violation(entry)
  reason = entry["reason"]
  return "#{entry['id']}: exemption is missing a reason field" unless reason.is_a?(String)
  return "#{entry['id']}: exemption reason is empty" if reason.strip.empty?
  return nil if reason.match?(REASON_RE)

  "#{entry['id']}: reason must name secrets / OIDC / cloud / deploy"
end

def parity_violations(paths)
  ci = discover_ci_checkpoints(paths)
  covered = discover_prepush_coverage(paths)
  remainder = ci - covered
  list = load_exemptions(paths.exemptions)
  ids = exemption_ids(list)
  leftover = remainder - ids
  stale = ids - remainder
  reason_violations(list) + leftover_lines(leftover) + stale_lines(stale)
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
