# frozen_string_literal: true

# Contract for issue #1177: one fail-closed Security check per current head.
# The individual scans remain visible evidence, but only the top-level
# aggregator is intended to be required by the repository ruleset.

require "json"
require "yaml"
require_relative "security-check-runs-canary"

ROOT = File.expand_path("../..", __dir__)
WORKFLOWS = File.join(ROOT, ".github", "workflows")
DEFAULT_CI = File.join(WORKFLOWS, "ci.yml")
DEFAULT_REUSABLE = File.join(WORKFLOWS, "reusable-security.yml")
DEFAULT_CODEQL = File.join(WORKFLOWS, "codeql.yml")
DEFAULT_RULESET = File.join(ROOT, "docs", "iterations", "s0v2", "ruleset-target.json")
DEFAULT_AGGREGATE = File.join(ROOT, ".github", "scripts", "security-aggregate.sh")
DEFAULT_CHECK_RUNS_FIXTURE = File.join(ROOT, ".github", "scripts", "fixtures", "security-check-runs.json")
SECURITY_LANES = %w[
  codeql gitleaks trufflehog osv-scanner dependabot-config config-read-sets
  zizmor semgrep sqlfluff post-deploy-assert-test
].freeze

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
  scan = jobs.fetch("security-scans")
  aggregate = jobs.fetch("security")
  abort_unless(scan["uses"] == "./.github/workflows/reusable-security.yml", "security-scans must call reusable-security.yml")
  abort_unless(!scan.key?("if"), "security-scans must run on every CI event that reaches ci.yml")
  abort_unless(scan.fetch("with").fetch("expected_sha") == "${{ github.sha }}", "security-scans must pin the reusable workflow to the current SHA")
  abort_unless(scan.fetch("permissions").fetch("security-events") == "write", "Security must grant CodeQL its upload permission at the caller ceiling")
  abort_unless(aggregate.fetch("name") == "Security", "the required check must be named Security")
  abort_unless(aggregate.fetch("needs") == ["security-scans"], "Security must depend on the complete scan workflow")
  abort_unless(aggregate.fetch("if").include?("always()"), "Security must run after scan failures and cancellations")
  abort_unless(!aggregate.key?("uses"), "Security must be a top-level aggregator job")
  abort_unless(!aggregate.to_s.include?("continue-on-error"), "Security must not suppress failures")
  steps = aggregate.fetch("steps")
  script = aggregate_step(steps)
  abort_unless(script, "Security must invoke security-aggregate.sh")
  assert_pinned_checkout(steps, script, "top-level Security", "${{ github.sha }}")
  env = script.fetch("env")
  abort_unless(env.fetch("SECURITY_RESULT") == "${{ needs.security-scans.result }}", "Security must propagate the reusable workflow result")
end

def assert_reusable(reusable)
  jobs = reusable.fetch("jobs")
  SECURITY_LANES.each { |lane| abort_unless(jobs.key?(lane), "reusable Security workflow is missing #{lane}") }
  summary = jobs.fetch("security-summary")
  missing = SECURITY_LANES - Array(summary.fetch("needs"))
  abort_unless(missing.empty?, "security-summary must wait for every required scan (missing #{missing.join(", ")})")
  abort_unless(summary.fetch("if").include?("always()"), "security-summary must run after a scan failure")
  abort_unless(!jobs.values.any? { |job| job.is_a?(Hash) && job.key?("continue-on-error") }, "security jobs must not use continue-on-error")
  steps = summary.fetch("steps")
  script = aggregate_step(steps)
  abort_unless(script, "security-summary must invoke security-aggregate.sh")
  assert_pinned_checkout(steps, script, "security-summary", "${{ github.sha }}")
  assert_summary_env(script.fetch("env"))
end

def assert_summary_env(env)
  expected = {
    "EXPECTED_SHA" => "${{ inputs.expected_sha }}",
    "ACTUAL_SHA" => "${{ github.sha }}",
    "SECURITY_RESULT" => "success",
    "REQUIRE_CHILD_RESULTS" => "true"
  }
  expected.each { |key, value| abort_unless(env.fetch(key) == value, "security-summary must set #{key}=#{value}") }
  results = env.fetch("SECURITY_RESULTS")
  SECURITY_LANES.each do |lane|
    expression = "#{lane}=${{ needs.#{lane}.result }}"
    abort_unless(results.include?(expression), "security-summary must report #{lane} result")
  end
end

def assert_standalone_codeql(codeql)
  events = workflow_events(codeql)
  abort_unless(!events.key?("pull_request"), "standalone CodeQL must not duplicate PR Security")
  abort_unless(!events.key?("push"), "standalone CodeQL must not duplicate push Security")
end

def assert_required_context_canary(ruleset)
  required = Array(JSON.parse(File.read(ruleset)).fetch("required_checks"))
  fixture = JSON.parse(File.read(DEFAULT_CHECK_RUNS_FIXTURE))
  SecurityCheckRunsCanary.assert!(fixture, repo: "lifeodyssey/animichi",
                                  expected_sha: fixture.fetch("head_sha"),
                                  required_contexts: required)
rescue SecurityCheckRunsCanary::Failure => error
  abort "security contract: #{error.message}"
end

def assert_aggregate_script(path)
  source = File.read(path)
  %w[EXPECTED_SHA ACTUAL_SHA SECURITY_RESULT REQUIRE_CHILD_RESULTS].each do |variable|
    abort_unless(source.include?(variable), "aggregator must consume #{variable}")
  end
  %w[GITHUB_STEP_SUMMARY GITHUB_SERVER_URL GITHUB_REPOSITORY GITHUB_RUN_ID].each do |variable|
    abort_unless(source.include?(variable), "aggregator must publish #{variable} evidence")
  end
  abort_unless(source.include?("actions/runs"), "aggregator must link workflow logs")
  abort_unless(source.include?("/checks"), "aggregator must link child check runs")
end

def assert_security_contract(ci_path: DEFAULT_CI, reusable_path: DEFAULT_REUSABLE,
                             codeql_path: DEFAULT_CODEQL, ruleset_path: DEFAULT_RULESET,
                             aggregate_path: DEFAULT_AGGREGATE)
  assert_top_level(load_yaml(ci_path))
  assert_reusable(load_yaml(reusable_path))
  assert_standalone_codeql(load_yaml(codeql_path))
  assert_required_context_canary(ruleset_path)
  assert_aggregate_script(aggregate_path)
  puts "Security contract: one fail-closed Security result over #{SECURITY_LANES.size} underlying checks"
end

assert_security_contract if $PROGRAM_NAME == __FILE__
