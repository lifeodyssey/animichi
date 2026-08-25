# frozen_string_literal: true

# Fail-closed contract for the Security job emitted directly by the single CI
# workflow. Individual tools stay visible as affected matrix checks; Security
# is the one stable required context that aggregates them on the current head.

require "json"
require "yaml"

SECURITY_ROOT = File.expand_path("../..", __dir__)
SECURITY_WORKFLOWS = File.join(SECURITY_ROOT, ".github", "workflows")
DEFAULT_CI = File.join(SECURITY_WORKFLOWS, "pr-verification.yml")
DEFAULT_ACTION = File.join(SECURITY_ROOT, ".github", "actions", "security-tool", "action.yml")
DEFAULT_CODEQL = File.join(SECURITY_WORKFLOWS, "codeql.yml")
DEFAULT_AGGREGATE = File.join(SECURITY_ROOT, ".github", "scripts", "security-aggregate.sh")
DEFAULT_MANIFEST = File.join(SECURITY_ROOT, ".github", "ci", "components.json")
RETIRED_REUSABLES = %w[
  reusable-security.yml reusable-static-quality.yml
  reusable-cross-stack-e2e.yml reusable-coverage.yml
].freeze
AFFECTED_SECURITY_TOOLS = %w[
  codeql-actions codeql-javascript codeql-python osv dependabot-config
  config-read-sets release-config zizmor semgrep sqlfluff runtime-promotion
].freeze
SUPPORTED_SECURITY_TOOLS = (AFFECTED_SECURITY_TOOLS + ["trufflehog"]).freeze

def load_yaml(path)
  YAML.safe_load(File.read(path), aliases: true)
end

def workflow_events(workflow)
  workflow["on"] || workflow[true] || {}
end

def abort_unless(condition, message)
  abort "security contract: #{message}" unless condition
end

def aggregate_step(steps)
  steps.find { |step| step.is_a?(Hash) && step.fetch("run", "").include?("security-aggregate.sh") }
end

def assert_pinned_checkout(steps, aggregate, label)
  preceding = steps.take(steps.index(aggregate)).select do |step|
    step.is_a?(Hash) && step["uses"].to_s.start_with?("actions/checkout@")
  end
  abort_unless(!preceding.empty?, "#{label} must checkout before aggregation")
  preceding.each do |checkout|
    abort_unless(checkout.fetch("uses").match?(/actions\/checkout@[0-9a-f]{40}/),
                 "#{label} checkout must be SHA-pinned")
    options = checkout.fetch("with", {})
    abort_unless(options["persist-credentials"] == false, "#{label} checkout must disable persisted credentials")
    abort_unless(options["ref"] == "${{ github.sha }}", "#{label} checkout must pin the current workflow SHA")
  end
end

def assert_route(route)
  outputs = route.fetch("outputs", {})
  %w[security_tools has_security_tools].each do |name|
    abort_unless(outputs[name].to_s.include?("steps.route.outputs.#{name}"), "route must publish #{name}")
  end
  source = route.fetch("steps", []).map { |step| step["run"] }.compact.join("\n")
  abort_unless(source.include?('startswith("security-")') && source.include?('sub("^security-"; "")'),
               "route must derive security tools from affected security lanes")
end

def assert_changed_secret_job(job)
  abort_unless(!job.key?("needs"), "changed-secret scans must run independently of routing")
  steps = job.fetch("steps", [])
  gitleaks = steps.any? { |step| step["uses"] == "./.github/actions/secret-scan" }
  trufflehog = steps.any? do |step|
    step["uses"] == "./.github/actions/security-tool" && step.dig("with", "tool") == "trufflehog"
  end
  abort_unless(gitleaks, "changed-secret scans must retain Gitleaks")
  abort_unless(trufflehog, "changed-secret scans must retain TruffleHog")
end

def assert_security_matrix(job)
  abort_unless(job.fetch("if", "").include?("needs.route.outputs.has_security_tools == 'true'"),
               "security matrix must skip an empty affected plan")
  tool = job.dig("strategy", "matrix", "tool").to_s
  abort_unless(tool.include?("needs.route.outputs.security_tools"), "security matrix must consume the affected tool plan")
  abort_unless(job.dig("strategy", "fail-fast") == false, "security matrix must finish every selected tool")
  abort_unless(job.dig("permissions", "security-events") == "write", "security matrix must permit CodeQL uploads")
  local_action = job.fetch("steps", []).any? { |step| step["uses"] == "./.github/actions/security-tool" }
  abort_unless(local_action, "security matrix must use the local security action")
end

def assert_required_jobs(jobs)
  security = jobs.fetch("security")
  abort_unless(security["name"] == "Security", "the required security context must be named Security")
  abort_unless(Array(security["needs"]) == %w[route security-diff security-tools],
               "Security must depend on routing, changed-secret scans, and selected tools")
  abort_unless(security.fetch("if", "").include?("always()"), "Security must run after failures and cancellations")
  abort_unless(!security.key?("uses"), "Security must be emitted directly by CI")
  abort_unless(!security.to_s.include?("continue-on-error"), "Security must not suppress failures")
  steps = security.fetch("steps", [])
  aggregate = aggregate_step(steps)
  abort_unless(aggregate, "Security must invoke security-aggregate.sh")
  assert_pinned_checkout(steps, aggregate, "Security")
  expected = {
    "EXPECTED_SHA" => "${{ github.sha }}", "ACTUAL_SHA" => "${{ github.sha }}",
    "ROUTE_RESULT" => "${{ needs.route.result }}",
    "SECRET_SCANS_RESULT" => "${{ needs.security-diff.result }}",
    "SECURITY_TOOLS" => "${{ needs.route.outputs.security_tools }}",
    "SECURITY_MATRIX_RESULT" => "${{ needs.security-tools.result }}"
  }
  env = aggregate.fetch("env", {})
  expected.each { |key, value| abort_unless(env[key] == value, "Security must set #{key}=#{value}") }

  verification = jobs.fetch("aggregate")
  abort_unless(verification["name"] == "PR Verification", "the required CI context must be named PR Verification")
  abort_unless(Array(verification["needs"]).include?("security"), "PR Verification must aggregate Security")
  abort_unless(!verification.key?("uses"), "PR Verification must be emitted directly by CI")
  abort_unless(!jobs.key?("required-security") && !jobs.key?("required-pr-verification"),
               "legacy required-context forwarding jobs must be absent")
  names = jobs.values.map { |job| job["name"] if job.is_a?(Hash) }.compact
  abort_unless(names.count("Security") == 1 && names.count("PR Verification") == 1,
               "CI must emit each required context exactly once")
end

def assert_top_level(ci)
  jobs = ci.fetch("jobs")
  assert_route(jobs.fetch("route"))
  assert_changed_secret_job(jobs.fetch("security-diff"))
  assert_security_matrix(jobs.fetch("security-tools"))
  assert_required_jobs(jobs)
  delegated = jobs.values.any? { |job| job.is_a?(Hash) && job["uses"].to_s.include?("reusable-security") }
  abort_unless(!delegated, "single CI must not delegate Security to a reusable workflow")
end

def assert_action(path)
  action = load_yaml(path)
  abort_unless(action.dig("inputs", "tool", "required") == true, "local security action must require a tool")
  source = File.read(path)
  executable = action.dig("runs", "steps").to_a.reject { |step| step["name"] == "Reject unknown security tool" }
  SUPPORTED_SECURITY_TOOLS.each do |tool|
    represented = executable.any? { |step| step.to_s.include?(tool) }
    abort_unless(represented, "local security action is missing #{tool}")
  end
  abort_unless(source.include?("github/codeql-action/init@") && source.include?("github/codeql-action/analyze@"),
               "local security action must retain CodeQL initialization and analysis")
  rejection = action.dig("runs", "steps").to_a.find { |step| step["name"] == "Reject unknown security tool" }
  abort_unless(rejection && rejection.fetch("run", "").include?("exit 2"), "local security action must reject unknown tools")
  SUPPORTED_SECURITY_TOOLS.each do |tool|
    abort_unless(rejection.fetch("if", "").include?(tool), "unknown-tool guard must allow #{tool}")
  end
  action.dig("runs", "steps").to_a.each do |step|
    uses = step["uses"].to_s
    next if uses.empty? || uses.start_with?("./")

    abort_unless(uses.match?(/@[0-9a-f]{40}\z/), "security action dependency must be SHA-pinned: #{uses}")
  end
  abort_unless(!source.include?("continue-on-error"), "local security action must not suppress failures")
end

def assert_manifest(path)
  lanes = JSON.parse(File.read(path)).fetch("global_lanes").map { |lane| lane.fetch("name") }
  actual = lanes.grep(/^security-/).map { |lane| lane.delete_prefix("security-") }.sort
  abort_unless(actual == AFFECTED_SECURITY_TOOLS.sort,
               "affected security lane set drifted: expected #{AFFECTED_SECURITY_TOOLS.sort}, got #{actual}")
end

def assert_standalone_codeql(codeql)
  events = workflow_events(codeql)
  abort_unless(!events.key?("pull_request"), "standalone CodeQL must not duplicate PR Security")
  abort_unless(!events.key?("push"), "standalone CodeQL must not duplicate merge-queue Security")
end

def assert_aggregate_script(path)
  source = File.read(path)
  %w[EXPECTED_SHA ACTUAL_SHA ROUTE_RESULT SECRET_SCANS_RESULT SECURITY_TOOLS SECURITY_MATRIX_RESULT].each do |variable|
    abort_unless(source.include?(variable), "aggregator must consume #{variable}")
  end
  abort_unless(!source.include?("REQUIRE_CHILD_RESULTS"), "aggregator must not retain the reusable-workflow interface")
  %w[GITHUB_STEP_SUMMARY GITHUB_SERVER_URL GITHUB_REPOSITORY GITHUB_RUN_ID].each do |variable|
    abort_unless(source.include?(variable), "aggregator must publish #{variable} evidence")
  end
  abort_unless(source.include?("actions/runs") && source.include?("/checks"),
               "aggregator must link workflow and child-check evidence")
end

def assert_reusables_retired(workflow_dir)
  present = RETIRED_REUSABLES.select { |file| File.exist?(File.join(workflow_dir, file)) }
  abort_unless(present.empty?, "retired reusable workflows remain: #{present.join(', ')}")
end

def assert_security_contract(ci_path: DEFAULT_CI, action_path: DEFAULT_ACTION,
                             codeql_path: DEFAULT_CODEQL, aggregate_path: DEFAULT_AGGREGATE,
                             manifest_path: DEFAULT_MANIFEST, workflow_dir: SECURITY_WORKFLOWS)
  assert_top_level(load_yaml(ci_path))
  assert_action(action_path)
  assert_manifest(manifest_path)
  assert_standalone_codeql(load_yaml(codeql_path))
  assert_aggregate_script(aggregate_path)
  assert_reusables_retired(workflow_dir)
  puts "Security contract: changed secrets plus #{AFFECTED_SECURITY_TOOLS.size} affected tools feed Security and PR Verification"
end

assert_security_contract if $PROGRAM_NAME == __FILE__
