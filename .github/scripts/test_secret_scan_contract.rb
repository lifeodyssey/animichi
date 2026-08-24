# frozen_string_literal: true

require "yaml"

ROOT = File.expand_path("../..", __dir__)
ACTION = ENV.fetch("SECRET_SCAN_ACTION", File.join(ROOT, ".github/actions/secret-scan/action.yml"))
CI = ENV.fetch("SECRET_SCAN_CI", File.join(ROOT, ".github/workflows/pr-verification.yml"))
SECURITY = ENV.fetch("SECRET_SCAN_SECURITY", File.join(ROOT, ".github/workflows/reusable-security.yml"))
CROSS_STACK = ENV.fetch("SECRET_SCAN_CROSS_STACK", File.join(ROOT, ".github/workflows/reusable-cross-stack-e2e.yml"))
IMAGE = "docker://ghcr.io/gitleaks/gitleaks:v8.24.3@sha256:e1b35e12a8c6fa8901f060459cfb6b2fc4c484d3afbe3b029733a3bbfab07055"
EXPR = "$" + "{{"

def load_yaml(path)
  YAML.safe_load(File.read(path).sub(/^on:(?=[ \t#]|$)/, '"on":'), aliases: true)
end

def reject(condition, message)
  abort "secret scan contract: #{message}" if condition
end

def scan_step(job)
  Array(job.fetch("steps")).find { |step| step["uses"] == "./.github/actions/secret-scan" }
end

def assert_scan_job(job, label)
  step = scan_step(job)
  reject(step.nil?, "#{label} must use the shared local action")
  expected = {
    "event-name" => "#{EXPR} github.event_name }}",
    "base-sha" => "#{EXPR} github.event.pull_request.base.sha || github.event.merge_group.base_sha }}",
    "head-sha" => "#{EXPR} github.event.pull_request.head.sha || github.event.merge_group.head_sha }}"
  }
  reject(step.fetch("with") != expected, "#{label} must bind event/base/source head exactly")
  reject(job.fetch("permissions", {}) != { "contents" => "read" }, "#{label} must remain contents-read only")
  reject(job.to_s.match?(/GITLEAKS_LICENSE|GITHUB_TOKEN/), "#{label} must not receive a token or license")
end

def assert_action
  action = load_yaml(ACTION)
  steps = action.fetch("runs").fetch("steps")
  reject(action.fetch("runs").fetch("using") != "composite", "shared action must be composite")
  resolver = steps.find { |step| step["id"] == "range" }
  scanner = steps.find { |step| step["uses"] == IMAGE }
  reject(resolver.nil? || !resolver.fetch("run").include?("resolve-secret-scan-range.sh"), "action must resolve its Git range")
  reject(scanner.nil?, "Gitleaks image must be versioned and digest-pinned")
  args = scanner.dig("with", "args").to_s
  reject(!args.include?("git") || !args.include?("--log-opts=#{EXPR} steps.range.outputs.range }}"), "scanner must use the resolved git range")
  reject(args.match?(/--first-parent|--no-merges/), "scanner must retain merged side-branch history")
  safe_directory = {"GIT_CONFIG_COUNT" => "1", "GIT_CONFIG_KEY_0" => "safe.directory", "GIT_CONFIG_VALUE_0" => "/github/workspace"}
  reject(scanner.fetch("env") != safe_directory, "container must trust only the mounted workspace")
  reject(File.read(ACTION).match?(/GITLEAKS_LICENSE|GITHUB_TOKEN|gitleaks-action/), "shared action must be tokenless and license-free")
end

def assert_workflows
  ci = load_yaml(CI)
  reusable = load_yaml(SECURITY)
  assert_scan_job(ci.fetch("jobs").fetch("security-diff"), "always-on secret diff")
  assert_scan_job(reusable.fetch("jobs").fetch("gitleaks"), "affected security scan")
  sources = [File.read(CI), File.read(SECURITY)].join
  reject(sources.match?(/gitleaks-action|GITLEAKS_LICENSE/), "legacy action/license wiring must be deleted")
  condition = ci.fetch("jobs").fetch("agent-eval").fetch("if")
  route_step = ci.fetch("jobs").fetch("route").fetch("steps").find { |step| step["id"] == "route" }
  route_guard = route_step.fetch("env").fetch("EVAL_ALLOWED")
  [condition, route_guard].each do |guard|
    reject(!guard.include?("github.event.pull_request.user.login != 'dependabot[bot]'"), "eval must reject Dependabot by PR author")
    reject(!guard.include?("github.actor != 'dependabot[bot]'"), "eval must also reject the Dependabot actor")
  end
end

def assert_cross_stack
  workflow = load_yaml(CROSS_STACK)
  job = workflow.fetch("jobs").fetch("cross-stack-e2e")
  caller = load_yaml(CI).fetch("jobs").fetch("cross-stack")
  source = File.read(CROSS_STACK)
  reject(source.match?(%r{dorny/paths-filter|steps\.f\.outputs|\bdb/\*\*}), "affected routing must stay in the single CI planner")
  reject(job.fetch("permissions", {}).key?("pull-requests"), "cross-stack no longer needs PR-list permission")
  reject(caller.fetch("permissions", {}) != { "contents" => "read" }, "cross-stack caller must not grant unused permissions")
end

assert_action
assert_workflows
assert_cross_stack
puts "Secret scan contract: exact ranges, pinned shared scanner, eval guard, and single routing pass"
