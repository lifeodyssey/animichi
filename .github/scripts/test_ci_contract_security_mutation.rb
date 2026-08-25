# frozen_string_literal: true

# Red/restore/green probes for the direct single-CI Security contract.

require "fileutils"
require "stringio"
require "tmpdir"
require "yaml"
require_relative "test_ci_contract_security"

ORIGINAL_STDOUT = $stdout
ORIGINAL_STDERR = $stderr

def capture_contract(paths)
  out = StringIO.new
  err = StringIO.new
  $stdout = out
  $stderr = err
  assert_security_contract(**paths)
  [0, out.string + err.string]
rescue SystemExit => error
  [error.status, out.string + err.string]
ensure
  $stdout = ORIGINAL_STDOUT
  $stderr = ORIGINAL_STDERR
end

def fixture_paths(dir)
  workflow_dir = File.join(dir, "workflows")
  {
    ci_path: File.join(workflow_dir, "ci.yml"),
    action_path: File.join(dir, "security-action.yml"),
    codeql_path: File.join(workflow_dir, "codeql.yml"),
    aggregate_path: File.join(dir, "security-aggregate.sh"),
    manifest_path: DEFAULT_MANIFEST,
    workflow_dir: workflow_dir
  }
end

def write_fixture(dir, fixture)
  paths = fixture_paths(dir)
  FileUtils.mkdir_p(paths.fetch(:workflow_dir))
  File.write(paths.fetch(:ci_path), YAML.dump(fixture.fetch(:ci)))
  File.write(paths.fetch(:action_path), YAML.dump(fixture.fetch(:action)))
  File.write(paths.fetch(:codeql_path), YAML.dump(fixture.fetch(:codeql)))
  File.write(paths.fetch(:aggregate_path), fixture.fetch(:aggregate))
  fixture.fetch(:retired).each { |name| File.write(File.join(paths.fetch(:workflow_dir), name), "name: retired\n") }
  paths
end

def fresh_fixture
  {
    ci: load_yaml(DEFAULT_CI),
    action: load_yaml(DEFAULT_ACTION),
    codeql: load_yaml(DEFAULT_CODEQL),
    aggregate: File.read(DEFAULT_AGGREGATE),
    retired: []
  }
end

def red_probe(label, expected_fragment)
  Dir.mktmpdir("security-mutation-red") do |dir|
    fixture = fresh_fixture
    yield fixture
    rc, output = capture_contract(write_fixture(dir, fixture))
    abort "FAIL: #{label} passed unexpectedly:\n#{output}" if rc.zero?
    abort "FAIL: #{label} expected #{expected_fragment.inspect}:\n#{output}" unless output.include?(expected_fragment)
    puts "PASS: #{label} rejected (#{expected_fragment})"
  end
end

def green_probe
  rc, output = capture_contract(
    ci_path: DEFAULT_CI, action_path: DEFAULT_ACTION, codeql_path: DEFAULT_CODEQL,
    aggregate_path: DEFAULT_AGGREGATE, manifest_path: DEFAULT_MANIFEST,
    workflow_dir: SECURITY_WORKFLOWS
  )
  abort "FAIL: pristine Security contract failed:\n#{output}" unless rc.zero?
  abort "FAIL: pristine Security contract omitted its summary" unless output.include?("Security contract:")
  puts "PASS: pristine Security contract (restore/green)"
end

%w[route security-diff security-tools].each do |dependency|
  red_probe("Security drops #{dependency}", "depend on routing, changed-secret scans, and selected tools") do |fixture|
    fixture.dig(:ci, "jobs", "security", "needs").delete(dependency)
  end
end

red_probe("Security loses always", "run after failures and cancellations") do |fixture|
  fixture.dig(:ci, "jobs", "security")["if"] = "${{ success() }}"
end

red_probe("security matrix ignores the route", "consume the affected tool plan") do |fixture|
  fixture.dig(:ci, "jobs", "security-tools", "strategy", "matrix")["tool"] = ["semgrep"]
end

red_probe("security matrix can stop early", "finish every selected tool") do |fixture|
  fixture.dig(:ci, "jobs", "security-tools", "strategy")["fail-fast"] = true
end

red_probe("CodeQL upload permission is removed", "permit CodeQL uploads") do |fixture|
  fixture.dig(:ci, "jobs", "security-tools", "permissions")["security-events"] = "read"
end

red_probe("security matrix drops the local action", "use the local security action") do |fixture|
  steps = fixture.dig(:ci, "jobs", "security-tools", "steps")
  steps.reject! { |step| step["uses"] == "./.github/actions/security-tool" }
end

red_probe("changed-secret lane drops Gitleaks", "retain Gitleaks") do |fixture|
  steps = fixture.dig(:ci, "jobs", "security-diff", "steps")
  steps.reject! { |step| step["uses"] == "./.github/actions/secret-scan" }
end

red_probe("changed-secret lane drops TruffleHog", "retain TruffleHog") do |fixture|
  steps = fixture.dig(:ci, "jobs", "security-diff", "steps")
  steps.reject! { |step| step.dig("with", "tool") == "trufflehog" }
end

red_probe("Security checkout persists credentials", "disable persisted credentials") do |fixture|
  checkout = fixture.dig(:ci, "jobs", "security", "steps").first
  checkout.fetch("with")["persist-credentials"] = true
end

red_probe("Security checkout follows an input ref", "pin the current workflow SHA") do |fixture|
  checkout = fixture.dig(:ci, "jobs", "security", "steps").first
  checkout.fetch("with")["ref"] = "${{ inputs.expected_sha }}"
end

red_probe("Security checkout is not pinned", "checkout must be SHA-pinned") do |fixture|
  checkout = fixture.dig(:ci, "jobs", "security", "steps").first
  checkout["uses"] = "actions/checkout@v7"
end

%w[EXPECTED_SHA ACTUAL_SHA ROUTE_RESULT SECRET_SCANS_RESULT SECURITY_TOOLS SECURITY_MATRIX_RESULT].each do |variable|
  red_probe("Security drops #{variable}", "Security must set #{variable}=") do |fixture|
    step = fixture.dig(:ci, "jobs", "security", "steps").last
    step.fetch("env")[variable] = "removed"
  end
end

red_probe("required Security context is renamed", "must be named Security") do |fixture|
  fixture.dig(:ci, "jobs", "security")["name"] = "Legacy Security"
end

red_probe("required PR context is renamed", "must be named PR Verification") do |fixture|
  fixture.dig(:ci, "jobs", "aggregate")["name"] = "Legacy Verification"
end

red_probe("legacy forwarding bridge returns", "forwarding jobs must be absent") do |fixture|
  fixture.fetch(:ci).fetch("jobs")["required-security"] = { "name" => "Security", "uses" => "./old.yml" }
end

red_probe("retired reusable workflow returns", "retired reusable workflows remain") do |fixture|
  fixture.fetch(:retired) << "reusable-security.yml"
end

SUPPORTED_SECURITY_TOOLS.each_with_index do |tool, index|
  red_probe("local action drops #{tool}", "local security action is missing #{tool}") do |fixture|
    yaml = YAML.dump(fixture.fetch(:action)).gsub(tool, "removedtool#{index}")
    fixture[:action] = YAML.safe_load(yaml, aliases: true)
  end
end

red_probe("local action accepts unknown tools", "must reject unknown tools") do |fixture|
  rejection = fixture.dig(:action, "runs", "steps").find { |step| step["name"] == "Reject unknown security tool" }
  rejection["run"] = "true"
end

red_probe("standalone CodeQL duplicates PR scanning", "must not duplicate PR Security") do |fixture|
  events = fixture.fetch(:codeql)["on"] || fixture.fetch(:codeql)[true]
  events["pull_request"] = {}
end

%w[EXPECTED_SHA ACTUAL_SHA ROUTE_RESULT SECRET_SCANS_RESULT SECURITY_TOOLS SECURITY_MATRIX_RESULT].each_with_index do |variable, index|
  red_probe("aggregate script drops #{variable}", "aggregator must consume #{variable}") do |fixture|
    fixture[:aggregate] = fixture.fetch(:aggregate).gsub(variable, "REMOVEDVARIABLE#{index}")
  end
end

green_probe
puts "All test_ci_contract_security mutation probes passed."
