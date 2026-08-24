# frozen_string_literal: true

# Contract for issue #1177: one fail-closed Security check per current head.
# The individual scans remain visible evidence, but only the top-level
# aggregator is intended to be required by the repository ruleset.

require "json"
require "yaml"
require_relative "security-check-runs-canary"

ROOT = File.expand_path("../..", __dir__)
WORKFLOWS = File.join(ROOT, ".github", "workflows")
DEFAULT_CI = File.join(WORKFLOWS, "pr-verification.yml")
DEFAULT_ACTION = File.join(ROOT, ".github", "actions", "security-tool", "action.yml")
DEFAULT_CODEQL = File.join(WORKFLOWS, "codeql.yml")
DEFAULT_RULESET = File.join(ROOT, "docs", "iterations", "s0v2", "ruleset-target.json")
DEFAULT_AGGREGATE = File.join(ROOT, ".github", "scripts", "security-aggregate.sh")
DEFAULT_CHECK_RUNS_FIXTURE = File.join(ROOT, ".github", "scripts", "fixtures", "security-check-runs.json")
SECURITY_TOOLS = %w[
  codeql-actions codeql-javascript codeql-python trufflehog osv dependabot-config
  config-read-sets release-config zizmor semgrep sqlfluff runtime-promotion
].freeze
RETIRED_SECURITY_LANE = "post-deploy-assert-test"

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
  steps.find do |step|
    step.is_a?(Hash) && step.key?("env") && step.fetch("run", "").include?("security-aggregate.sh")
  end
end

def assert_pinned_checkout(steps, aggregate, label, ref)
  aggregate_index = steps.index(aggregate)
  checkout_indexes = steps.each_index.select do |index|
    step = steps.fetch(index)
    step.is_a?(Hash) && step["uses"].to_s.start_with?("actions/checkout@") && index < aggregate_index
  end
  abort_unless(!checkout_indexes.empty?, "#{label} must checkout before aggregation")
  checkout_indexes.each do |checkout_index|
    checkout = steps.fetch(checkout_index)
    abort_unless(checkout.fetch("uses").match?(/actions\/checkout@[0-9a-f]{40}/), "#{label} checkout must be SHA-pinned")
    options = checkout.fetch("with", {})
    abort_unless(options.fetch("persist-credentials", nil) == false, "#{label} checkout must disable persisted credentials")
    abort_unless(!options.key?("repository"), "#{label} checkout must use the current repository")
    abort_unless(options.fetch("ref", nil) == ref, "#{label} checkout must pin the trusted workflow SHA")
  end
end

def assert_top_level(ci)
  jobs = ci.fetch("jobs")
  scans = jobs.fetch("security-tools")
  secrets = jobs.fetch("security-diff")
  aggregate = jobs.fetch("security")
  abort_unless(scans.dig("strategy", "matrix", "tool").include?("needs.route.outputs.security_tools"),
               "security matrix must consume the affected tool plan")
  abort_unless(scans.fetch("permissions").fetch("security-events") == "write",
               "security matrix must grant CodeQL its upload permission")
  abort_unless(scans.fetch("steps").any? { |step| step["uses"] == "./.github/actions/security-tool" },
               "security matrix must use the local security action")
  abort_unless(secrets.fetch("steps").any? { |step| step["uses"] == "./.github/actions/secret-scan" },
               "changed-secret lane must retain Gitleaks")
  abort_unless(secrets.fetch("steps").any? { |step| step["uses"] == "./.github/actions/security-tool" && step.dig("with", "tool") == "trufflehog" },
               "changed-secret lane must retain TruffleHog")
  abort_unless(aggregate.fetch("name") == "Security", "the required aggregate must be named Security")
  abort_unless(Array(aggregate.fetch("needs")) == %w[route security-diff security-tools],
               "Security must depend on routing, changed-secret scans, and selected tools")
  abort_unless(aggregate.fetch("if").include?("always()"), "Security must run after scan failures and cancellations")
  abort_unless(!aggregate.key?("uses"), "Security must be a top-level aggregator job")
  abort_unless(!aggregate.to_s.include?("continue-on-error"), "Security must not suppress failures")
  steps = aggregate.fetch("steps")
  script = aggregate_step(steps)
  abort_unless(script, "Security must invoke security-aggregate.sh")
  assert_pinned_checkout(steps, script, "top-level Security", "${{ github.sha }}")
  env = script.fetch("env")
  expected = {
    "ROUTE_RESULT" => "${{ needs.route.result }}",
    "SECRET_SCANS_RESULT" => "${{ needs.security-diff.result }}",
    "SECURITY_TOOLS" => "${{ needs.route.outputs.security_tools }}",
    "SECURITY_MATRIX_RESULT" => "${{ needs.security-tools.result }}"
  }
  expected.each { |key, value| abort_unless(env.fetch(key) == value, "Security must set #{key}=#{value}") }
  final = jobs.fetch("aggregate")
  abort_unless(final.fetch("name") == "PR Verification", "the final required context must be PR Verification")
  abort_unless(Array(final.fetch("needs")).include?("security"), "PR Verification must aggregate Security")
  abort_unless(!jobs.key?("required-security"), "legacy Security forwarding job must be absent")
end

def assert_action(path)
  source = File.read(path)
  SECURITY_TOOLS.each do |tool|
    abort_unless(source.include?(tool), "local security action is missing #{tool}")
  end
  abort_unless(source.include?("github/codeql-action/init@") && source.include?("github/codeql-action/analyze@"),
               "local security action must retain CodeQL")
  abort_unless(source.include?("Reject unknown security tool"), "local security action must reject unknown tools")
  abort_unless(!source.include?("continue-on-error"), "local security action must not suppress failures")
end

def assert_standalone_codeql(codeql)
  events = workflow_events(codeql)
  abort_unless(!events.key?("pull_request"), "standalone CodeQL must not duplicate PR Security")
  abort_unless(!events.key?("push"), "standalone CodeQL must not duplicate push Security")
end

def assert_required_context_canary(ruleset)
  required = Array(JSON.parse(File.read(ruleset)).fetch("required_checks"))
  fixture = JSON.parse(File.read(DEFAULT_CHECK_RUNS_FIXTURE))
  retired = Array(fixture["check_runs"]).any? { |run| run["name"].to_s.include?(RETIRED_SECURITY_LANE) }
  abort_unless(!retired, "security check-run fixture must not retain #{RETIRED_SECURITY_LANE}")
  SecurityCheckRunsCanary.assert!(fixture, repo: "lifeodyssey/animichi",
                                  expected_sha: fixture.fetch("head_sha"),
                                  required_contexts: required)
rescue SecurityCheckRunsCanary::Failure => error
  abort "security contract: #{error.message}"
end

def assert_aggregate_script(path)
  source = File.read(path)
  %w[EXPECTED_SHA ACTUAL_SHA ROUTE_RESULT SECRET_SCANS_RESULT SECURITY_TOOLS SECURITY_MATRIX_RESULT].each do |variable|
    abort_unless(source.include?(variable), "aggregator must consume #{variable}")
  end
  %w[GITHUB_STEP_SUMMARY GITHUB_SERVER_URL GITHUB_REPOSITORY GITHUB_RUN_ID].each do |variable|
    abort_unless(source.include?(variable), "aggregator must publish #{variable} evidence")
  end
  abort_unless(source.include?("actions/runs"), "aggregator must link workflow logs")
  abort_unless(source.include?("/checks"), "aggregator must link child check runs")
end

def assert_security_contract(ci_path: DEFAULT_CI, action_path: DEFAULT_ACTION,
                             codeql_path: DEFAULT_CODEQL, ruleset_path: DEFAULT_RULESET,
                             aggregate_path: DEFAULT_AGGREGATE)
  assert_top_level(load_yaml(ci_path))
  assert_action(action_path)
  assert_standalone_codeql(load_yaml(codeql_path))
  assert_required_context_canary(ruleset_path)
  assert_aggregate_script(aggregate_path)
  puts "Security contract: changed secrets and #{SECURITY_TOOLS.size} affected tools feed required contexts"
end

assert_security_contract if $PROGRAM_NAME == __FILE__
