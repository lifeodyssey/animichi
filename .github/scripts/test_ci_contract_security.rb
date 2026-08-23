# frozen_string_literal: true

# Contract for issue #1177: one fail-closed Security check per current head.
# The individual scans remain visible evidence, but only the top-level
# aggregator is intended to be required by the repository ruleset.

require "yaml"

ROOT = File.expand_path("../..", __dir__)
WORKFLOWS = File.join(ROOT, ".github", "workflows")

def load_yaml(path)
  YAML.safe_load(File.read(path), aliases: true)
end

def abort_unless(condition, message)
  abort "security contract: #{message}" unless condition
end

ci = load_yaml(File.join(WORKFLOWS, "ci.yml"))
jobs = ci.fetch("jobs")
scan_job = jobs.fetch("security-scans")
aggregate = jobs.fetch("security")

abort_unless(scan_job["uses"] == "./.github/workflows/reusable-security.yml", "security-scans must call reusable-security.yml")
abort_unless(!scan_job.key?("if"), "security-scans must run on every CI event that reaches ci.yml")
abort_unless(scan_job.fetch("with").fetch("expected_sha") == "${{ github.sha }}", "security-scans must pin the reusable workflow to the current SHA")
abort_unless(scan_job.fetch("permissions").fetch("security-events") == "write", "Security must grant CodeQL its upload permission at the caller ceiling")
abort_unless(aggregate.fetch("name") == "Security", "the required check must be named Security")
abort_unless(aggregate.fetch("needs") == ["security-scans"], "Security must depend on the complete scan workflow")
abort_unless(aggregate.fetch("if").include?("always()"), "Security must run after failures and cancellations")
abort_unless(!aggregate.key?("uses"), "Security must be a top-level aggregator job")
abort_unless(!aggregate.to_s.include?("continue-on-error"), "Security must not suppress failures")

reusable = load_yaml(File.join(WORKFLOWS, "reusable-security.yml"))
security_jobs = reusable.fetch("jobs")
expected = %w[
  gitleaks trufflehog osv-scanner dependabot-config config-read-sets zizmor
  semgrep sqlfluff post-deploy-assert-test codeql
]
expected.each do |job_id|
  abort_unless(security_jobs.key?(job_id), "reusable Security workflow is missing #{job_id}")
end

summary = security_jobs.fetch("security-summary")
abort_unless(summary.fetch("needs").sort == (expected.sort), "security-summary must wait for every scan")
abort_unless(summary.fetch("if").include?("always()"), "security-summary must run after a scan failure")
abort_unless(!security_jobs.values.any? { |job| job.is_a?(Hash) && job.key?("continue-on-error") }, "security jobs must not use continue-on-error")

codeql = load_yaml(File.join(WORKFLOWS, "codeql.yml"))
codeql_events = codeql.fetch("on") { codeql.fetch(true) }
abort_unless(!codeql_events.key?("pull_request"), "standalone CodeQL must not duplicate PR Security")
abort_unless(!codeql_events.key?("push"), "standalone CodeQL must not duplicate push Security")

aggregate_script = File.read(File.join(ROOT, ".github", "scripts", "security-aggregate.sh"))
%w[EXPECTED_SHA ACTUAL_SHA SECURITY_RESULT REQUIRE_CHILD_RESULTS].each do |variable|
  abort_unless(aggregate_script.include?(variable), "aggregator must consume #{variable}")
end
abort_unless(aggregate_script.include?("GITHUB_STEP_SUMMARY"), "aggregator must retain child evidence in the run summary")

puts "Security contract: one fail-closed Security result over #{expected.size} underlying checks"
