# frozen_string_literal: true

require "json"
require "yaml"

module RulesetCutoverTestSupport
  ROOT = File.expand_path("../..", __dir__)
  TARGET = File.join(ROOT, "docs", "iterations", "s0v2", "ruleset-cutover-target.json")

  def fail_test(message)
    abort "FAIL: #{message}"
  end

  def assert(condition, message)
    fail_test(message) unless condition
  end

  def assert_error(fragment)
    yield
    fail_test "expected #{fragment.inspect}"
  rescue RulesetCutover::Error => error
    fail_test "expected #{fragment.inspect}, got #{error.message.inspect}" unless error.message.include?(fragment)
  end

  def fixture(contexts)
    {
      "id" => 42, "name" => "protect main", "target" => "branch", "source_type" => "Repository",
      "enforcement" => "active",
      "bypass_actors" => [{ "actor_id" => 7, "actor_type" => "User", "bypass_mode" => "always" }],
      "conditions" => { "ref_name" => { "include" => ["~DEFAULT_BRANCH"], "exclude" => [] } },
      "rules" => rules(contexts)
    }
  end

  def rules(contexts)
    [
      { "type" => "deletion" },
      { "type" => "pull_request", "parameters" => {
        "dismiss_stale_reviews_on_push" => false, "require_code_owner_review" => false,
        "require_last_push_approval" => false, "required_approving_review_count" => 0,
        "required_review_thread_resolution" => false
      } },
      { "type" => "required_status_checks", "parameters" => {
        "strict_required_status_checks_policy" => true,
        "required_status_checks" => contexts.map { |context| { "context" => context } }
      } },
      { "type" => "code_quality", "parameters" => { "severity" => "all" } },
      { "type" => "code_coverage", "parameters" => { "min_coverage" => 90 } }
    ]
  end

  def load_workflow(path)
    source = File.read(File.join(ROOT, path)).sub(/^on:(?=[ \t#]|$)/, '"on":')
    YAML.safe_load(source, aliases: true)
  end

  def assert_target_contract
    target = JSON.parse(File.read(TARGET))
    assert(target.fetch("schema_version") == "ruleset-cutover/v3", "target must use the API-backed v3 schema")
    assert(target.fetch("required_checks") == RulesetCutover::APPROVED_CONTEXTS,
           "target must list the two approved contexts in canonical order")
    assert_atomic_contract(target)
    assert_producer_contract(target)
    assert_canary_contract(target)
    assert(!target.to_s.include?("sha256"), "v3 target must not claim local workflow SHA-256 evidence")
    assert(!target.key?("pre_cutover_compatibility"), "post-cutover target must not retain a legacy wrapper")
    assert(target.fetch("live_cutover").fetch("status") == "pending-content-addressed-canary-and-atomic-put",
           "target must remain pending until canary and atomic cutover")
  end

  def assert_atomic_contract(target)
    atomic = target.fetch("atomic_put")
    assert(atomic.fetch("actions_settings") == "not_requested", "target must forbid Actions settings changes")
    assert(atomic.fetch("remove_rule_types") == RulesetCutover::RETIRED_RULE_TYPES,
           "target must explicitly remove unavailable native rules")
    assert(atomic.fetch("required_review_thread_resolution") == true,
           "target must require native review-thread resolution")
    assert(atomic.fetch("review_gate_integration_id") == RulesetCutover::GITHUB_ACTIONS_INTEGRATION_ID,
           "target must source-bind Review Gate to GitHub Actions")
  end

  def assert_producer_contract(target)
    target.fetch("producer_jobs").each do |context, producer|
      job = load_workflow(producer.fetch("workflow")).fetch("jobs").fetch(producer.fetch("job_id"))
      classic = producer.fetch("type", "check_run") == "commit_status"
      valid = classic ? producer.fetch("context") == context && job.fetch("name") != context :
        producer.fetch("name") == context && job.fetch("name") == context
      assert(valid, "#{context} target must match its producer type and job name")
      assert(producer.fetch("identity_fields") == %w[id path event head_sha head_branch],
             "#{context} must bind the exact API run id/path/event/branch/head fields")
    end
    ci = target.fetch("producer_jobs").fetch("CI / verify")
    assert(ci.fetch("events_by_head") == { "pull_request" => "pull_request", "merge_group" => "merge_group" },
           "CI producer events must match each evidence head")
    review = target.fetch("producer_jobs").fetch("Review Gate")
    assert(review.fetch("merge_group_event") == "workflow_run", "merge-group Review Gate must use only workflow_run")
    assert(review.fetch("trusted_branch") == "repository.default_branch", "Review Gate must bind the trusted default branch")
    assert(review.fetch("integration_id") == RulesetCutover::GITHUB_ACTIONS_INTEGRATION_ID,
           "Review Gate producer must declare the GitHub Actions integration")
  end

  def assert_canary_contract(target)
    canary = target.fetch("canary_contract")
    assert(canary.fetch("schema_version") == RulesetCutover::CANARY_SCHEMA, "machine target must match the v3 canary schema")
    assert(canary.fetch("capture_source") == "github_api", "canary evidence must be captured from GitHub APIs")
    assert(canary.fetch("maximum_age_seconds") == RulesetCutover::CANARY_MAX_AGE,
           "machine target and runtime must share the canary freshness window")
    revalidation = canary.fetch("apply_time_revalidation")
    assert(revalidation.fetch("required") && revalidation.fetch("before") == "ruleset_put",
           "apply must live-recapture immediately before the ruleset PUT")
    assert(revalidation.fetch("comparison") == "exact_except_observed_at",
           "live recapture must match every stable artifact field")
  end

  def status_evidence(sha, event, ci_run_id)
    RulesetCutover::APPROVED_CONTEXTS.each_with_index.to_h do |context, index|
      ci = context == RulesetCutover::CI_CONTEXT
      [context, { "type" => ci ? "check_run" : "commit_status", "id" => 100 + index,
                  "state" => "success", "target_sha" => sha,
                  "integration_id" => ci ? nil : RulesetCutover::GITHUB_ACTIONS_INTEGRATION_ID,
                  "run" => { "id" => ci ? ci_run_id : 200 + index,
                             "path" => RulesetCutover::PRODUCER_PATHS.fetch(context),
                             "event" => ci ? event : "workflow_run", "head_sha" => ci ? sha : "d" * 40,
                             "head_branch" => ci ? "feature" : "main" } }]
    end
  end
end
