# frozen_string_literal: true

require "json"
require "yaml"
require_relative "test_ci_contract_review_gate_steps"

ROOT = File.expand_path("../..", __dir__)
REVIEW_YML = File.join(ROOT, ".github/workflows/review-gate.yml")
QUALITY_YML = File.join(ROOT, ".github/workflows/reusable-static-quality.yml")
GATE_STEP = File.join(ROOT, "scripts/local-gates/pr-review-gate-step.sh")

def triggers(workflow, file)
  value = workflow["on"] || workflow[true]
  abort "#{file} must declare triggers under on:" unless value.is_a?(Hash)
  value
end

def workflow(path)
  YAML.safe_load(File.read(path).sub(/^on:(?=[ \t#]|$)/, '"on":'), aliases: true)
end

def assert_concurrency(review, path)
  concurrency = review.fetch("concurrency")
  abort "#{path} must cancel superseded generations" unless concurrency.fetch("cancel-in-progress") == true
  group = concurrency.fetch("group")
  %w[pull_request.number issue.number workflow_run.head_sha].each do |identity|
    abort "#{path} concurrency must bind #{identity}" unless group.include?(identity)
  end
end

def assert_static_quality_split(path)
  quality = workflow(path)
  abort "static quality must be workflow_call-only" unless triggers(quality, path).keys == ["workflow_call"]
  source = File.read(path)
  abort "static quality must not publish review statuses" if source.include?("statuses: write") || source.include?("claim-status")
end

def assert_single_status_producer(path)
  producers = Dir[File.join(ROOT, ".github/workflows/*.{yml,yaml}")].select do |candidate|
    File.read(candidate).match?(/claim-status|finish-status/)
  end
  abort "Review Gate must have exactly one trusted workflow producer" unless producers == [path]
end

def assert_live_queue_association(path = GATE_STEP)
  source = File.read(path)
  required = ["actions/runs/$run_id\" --jq", "/pull_requests?per_page=100", ".repository.full_name,.event,.head_sha,.path,.conclusion",
              ".github/workflows/pr-verification.yml", "n not in seen", 'base.get("ref")=="main"']
  missing = required.reject { |token| source.include?(token) }
  abort "#{path} must validate live workflow-run metadata and direct PR associations: #{missing.join(', ')}" unless missing.empty?
  abort "#{path} must not infer merge-queue membership from commit ancestry" if source.include?("/compare/")
end

def assert_artifacts
  target = JSON.parse(File.read(File.join(ROOT, "docs/iterations/s0v2/ruleset-target.json")))
  cutover = JSON.parse(File.read(File.join(ROOT, "docs/iterations/s0v2/ruleset-cutover-target.json")))
  expected = ["CI / verify", "Review Gate"]
  abort "ruleset contexts drifted" unless target.fetch("required_checks") == expected && cutover.fetch("required_checks") == expected
  source = target.dig("_required_status_sources", "Review Gate", "integration_id")
  abort "Review Gate ruleset source is not GitHub Actions" unless source == 15_368
  abort "native review-thread resolution is not required" unless target.fetch("_required_review_thread_resolution") == true
  producer = cutover.fetch("producer_jobs").fetch("Review Gate")
  valid = producer.fetch("workflow") == ".github/workflows/review-gate.yml"
  valid &&= producer.fetch("job_id") == "refresh" && producer.fetch("type") == "commit_status"
  abort "ruleset producer must be the trusted refresh job" unless valid
end

def assert_split_review_gate(path = REVIEW_YML)
  review = workflow(path)
  assert_trusted_events(review, path)
  assert_concurrency(review, path)
  refresh = review.fetch("jobs").fetch("refresh")
  writers = review.fetch("jobs").select do |_name, job|
    review.fetch("permissions", {}).merge(job.fetch("permissions", {}))["statuses"] == "write"
  end
  abort "only refresh may hold statuses: write" unless writers.keys == ["refresh"]
  abort "Actions job/check must not be named Review Gate" if refresh.fetch("name", "") == "Review Gate"
  assert_status_writer_permissions(review, refresh, path)
  writers.each_value { |job| assert_no_candidate_execution(job, path) }
  assert_refresh_steps(refresh, path)
  assert_live_queue_association
  assert_single_status_producer(path)
  assert_static_quality_split(QUALITY_YML)
  assert_artifacts
  puts "Review gate: trusted default-branch producer; PR pending claim + guarded final; workflow_run validates merge-queue evidence"
end

assert_split_review_gate(ARGV[0] || REVIEW_YML) if $PROGRAM_NAME == __FILE__
