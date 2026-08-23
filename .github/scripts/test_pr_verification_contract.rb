# frozen_string_literal: true

# Contract checks for issue #1176. The workflow has one required aggregator;
# package jobs are implementation details selected by the affected route.
require "open3"
require "yaml"

REPO_ROOT = File.expand_path("../..", __dir__)
WORKFLOW = ENV.fetch("PR_VERIFICATION_WORKFLOW", File.join(REPO_ROOT, ".github", "workflows", "pr-verification.yml"))
ROUTE = ENV.fetch("PR_VERIFICATION_ROUTE", File.join(REPO_ROOT, ".github", "scripts", "pr-verification-route.sh"))
GATE = ENV.fetch("PR_VERIFICATION_GATE", File.join(REPO_ROOT, ".github", "scripts", "pr-verification-gate.sh"))
WORKSPACE_LIB = File.join(REPO_ROOT, "scripts", "local-gates", "workspace-packages.sh")
EXPECTED_PACKAGES = %w[agent catalog contract doorbell e2e edge infra migrator users web]

def workflow_value(path)
  YAML.safe_load(File.read(path).sub(/^on:(?=[ \t#]|$)/, '"on":'), aliases: true)
end

def trigger_map(workflow)
  workflow.fetch("on")
end

def assert_event_contract(workflow)
  events = trigger_map(workflow)
  required = %w[opened synchronize reopened ready_for_review converted_to_draft]
  pull_request = events.fetch("pull_request")
  actual = Array(pull_request.fetch("types"))
  missing = required - actual
  abort "PR Verification pull_request trigger is missing: #{missing.join(', ')}" unless missing.empty?
  forbidden = %w[issue_comment pull_request_review pull_request_review_comment]
  present = forbidden & events.keys
  abort "PR Verification must not trigger code gates for: #{present.join(', ')}" unless present.empty?
  merge_group = events.fetch("merge_group")
  abort "PR Verification merge_group must target main" unless Array(merge_group.fetch("branches")) == ["main"]
end

def assert_job_contract(workflow)
  jobs = workflow.fetch("jobs")
  route = jobs.fetch("route")
  package = jobs.fetch("package-gate")
  aggregate = jobs.fetch("aggregate")
  names = jobs.values.map { |job| job["name"] if job.is_a?(Hash) }.compact
  abort "workflow must expose exactly one PR Verification job" unless names.count("PR Verification") == 1
  abort "route job must publish packages" unless route.fetch("outputs").fetch("packages").include?("steps.route.outputs.packages")
  matrix = package.fetch("strategy").fetch("matrix").fetch("package")
  abort "package gate must use the routed matrix" unless matrix.include?("fromJSON(needs.route.outputs.packages)")
  needs = Array(aggregate.fetch("needs"))
  abort "aggregator must wait for route and package gates" unless (needs & %w[route package-gate]).sort == %w[package-gate route]
  abort "aggregator must run after failed/cancelled matrix jobs" unless aggregate.fetch("if").include?("always()")
  run = aggregate.fetch("steps").map { |step| step["run"] }.compact.join("\n")
  abort "aggregator must invoke exact-head checker" unless run.include?("pr-verification-aggregate.sh")
  head_env = aggregate.fetch("steps").map { |step| step.dig("env", "PR_VERIFICATION_HEAD_SHA") }.compact.first
  abort "aggregator must bind PR checks to pull-request head" unless head_env.to_s.include?("github.event.pull_request.head.sha")
  abort "package gate must not suppress failures" if File.read(WORKFLOW).match?(/^\s*(continue-on-error|skip)\s*:/)
  workflow_source = File.read(WORKFLOW)
  image_build = "docker build -f apps/agent/docker/test-postgres/Dockerfile -t animichi-test-postgres:18-3.6-pgvector-0.8.5 ."
  abort "agent/db gates must build the pinned offline Postgres image" unless workflow_source.include?(image_build)
  abort "offline Postgres image build must be scoped to agent/db gates" unless workflow_source.include?("matrix.package == 'agent' || matrix.package == 'db'")
  gate_source = File.read(GATE)
  abort "e2e gate must run deterministic Web pipeline assertions" unless gate_source.include?("web-404.spec.ts web-maplibre-canary.spec.ts web-state-ownership.spec.ts")
  abort "e2e gate must not be collection-only" if gate_source.include?("playwright test --list")
end

def assert_routing_contract
  source = File.read(ROUTE)
  %w[load_workspace_packages match_workspace_package all_packages].each do |name|
    abort "route must use #{name}" unless source.include?(name)
  end
  gate_source = File.read(GATE)
  allowed = gate_source[/^ALLOWED="([^"]+)"/, 1].to_s.split("|")
  abort "gate dispatcher allowed package set drift" unless EXPECTED_PACKAGES.all? { |package| allowed.include?(package) }
  pre_push = File.read(File.join(REPO_ROOT, "scripts", "local-gates", "pre-push.sh"))
  worker_gates = File.read(File.join(REPO_ROOT, "scripts", "local-gates", "pre-push-worker-gates.sh"))
  EXPECTED_PACKAGES.each do |package|
    abort "gate dispatcher must list #{package}" unless gate_source.include?(package)
    next if package == "e2e"
    gate_source_text = pre_push + worker_gates
    abort "gate dispatcher must call gate_#{package}" unless gate_source_text.include?("gate_#{package}()")
  end
  abort "gate dispatcher must retain an e2e package seam" unless gate_source.include?("PACKAGE\" = e2e")
end

def assert_workspace_package_set
  command = "set -e; source \"#{WORKSPACE_LIB}\"; load_workspace_packages; printf '%s\\n' \"$WORKSPACE_NAMES\""
  output, status = Open3.capture2("bash", "-c", command)
  abort "workspace package derivation failed" unless status.success?
  actual = output.lines.map(&:strip).reject(&:empty?).sort
  abort "workspace package set drift: expected #{EXPECTED_PACKAGES}, got #{actual}" unless actual == EXPECTED_PACKAGES.sort
end

def run_contract(path)
  Open3.capture3(RbConfig.ruby, __FILE__, path)
end

def assert_pr_verification_contract(path = WORKFLOW)
  workflow = workflow_value(path)
  assert_event_contract(workflow)
  assert_job_contract(workflow)
  assert_routing_contract
  assert_workspace_package_set
  puts "PR Verification contract: one exact-head aggregator, affected workspace matrix, code-only triggers"
end

assert_pr_verification_contract(ARGV.fetch(0, WORKFLOW)) if $PROGRAM_NAME == __FILE__
