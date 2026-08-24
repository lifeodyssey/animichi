# frozen_string_literal: true

module RulesetCutover
  module_function

  def positive_integer!(value, label)
    return value if value.is_a?(Integer) && value.positive?
    raise Error, "#{label} must be a positive integer"
  end

  def actions_run_id(url, repo, label)
    match = url.is_a?(String) && url.match(%r{\Ahttps://github\.com/#{Regexp.escape(repo)}/actions/runs/(\d+)(?:/|\z)})
    raise Error, "#{label} does not identify a repository Actions run" unless match
    match[1].to_i
  end

  def fetch_workflow_run(repo, run_id)
    gh_json("repos/#{repo}/actions/runs/#{positive_integer!(run_id, "workflow run id")}")
  end

  def validate_run_identity!(run, repo, path, event)
    raise Error, "workflow run evidence must be an object" unless run.is_a?(Hash)
    positive_integer!(run["id"], "workflow run id")
    raise Error, "workflow run repository mismatch" unless run.dig("repository", "full_name") == repo
    raise Error, "workflow run path mismatch" unless run["path"] == path
    raise Error, "workflow run event mismatch" unless Array(event).include?(run["event"])
  end

  def validate_run_result!(run, target_sha, default_branch)
    raise Error, "workflow run did not succeed" unless run["status"] == "completed" && run["conclusion"] == "success"
    raise Error, "workflow run target SHA mismatch" if target_sha && run["head_sha"] != target_sha
    return unless default_branch && run["head_branch"] != default_branch
    raise Error, "trusted workflow run is not from the default branch"
  end

  def validate_workflow_run!(run, repo:, path:, event:, target_sha: nil, default_branch: nil)
    validate_run_identity!(run, repo, path, event)
    validate_run_result!(run, target_sha, default_branch)
    run
  end

  def workflow_evidence(run)
    { "id" => run.fetch("id"), "path" => run.fetch("path"), "event" => run.fetch("event"),
      "head_sha" => run.fetch("head_sha"), "head_branch" => run.fetch("head_branch") }
  end

  def unique_ci_check!(repo, sha)
    response = gh_json("repos/#{repo}/commits/#{sha}/check-runs?per_page=100")
    matches = Array(response["check_runs"]).select { |run| run["name"] == CI_CONTEXT }
    raise Error, "expected exactly one #{CI_CONTEXT} check run on #{sha}" unless matches.one?
    matches.first
  end

  def validate_ci_check!(check, sha)
    valid = check["head_sha"] == sha && check["status"] == "completed" && check["conclusion"] == "success"
    raise Error, "#{CI_CONTEXT} is not successful on #{sha}" unless valid
    raise Error, "#{CI_CONTEXT} is not produced by GitHub Actions" unless check.dig("app", "slug") == "github-actions"
  end

  def ci_workflow_evidence(repo, check, sha, expected_event, expected_run_id)
    run_id = actions_run_id(check["details_url"], repo, CI_CONTEXT)
    raise Error, "merge-group CI run identity mismatch" if expected_run_id && run_id != expected_run_id
    run = fetch_workflow_run(repo, run_id)
    validate_workflow_run!(run, repo: repo, path: PRODUCER_PATHS.fetch(CI_CONTEXT), event: expected_event,
                           target_sha: sha)
    workflow_evidence(run)
  end

  def successful_ci(repo, sha, expected_event, expected_run_id: nil)
    check = unique_ci_check!(repo, sha)
    validate_ci_check!(check, sha)
    run = ci_workflow_evidence(repo, check, sha, expected_event, expected_run_id)
    { "type" => "check_run", "id" => check.fetch("id"), "state" => "success", "target_sha" => sha,
      "run" => run }
  end

  def successful_review_status!(repo, sha)
    statuses = gh_json("repos/#{repo}/commits/#{sha}/statuses?per_page=100")
    status = Array(statuses).find { |entry| entry["context"] == REVIEW_CONTEXT }
    raise Error, "#{REVIEW_CONTEXT} classic status is missing on #{sha}" unless status
    valid = status["state"] == "success" && status["sha"] == sha
    raise Error, "#{REVIEW_CONTEXT} is not successful on #{sha}" unless valid
    creator = status["creator"]
    trusted = creator.is_a?(Hash) && creator["login"] == "github-actions[bot]" && creator["type"] == "Bot"
    raise Error, "#{REVIEW_CONTEXT} is not produced by the GitHub Actions integration" unless trusted
    status
  end

  def review_workflow_evidence(repo, status, default_branch, target_event)
    run_id = actions_run_id(status["target_url"], repo, REVIEW_CONTEXT)
    run = fetch_workflow_run(repo, run_id)
    events = target_event == "merge_group" ? "workflow_run" : REVIEW_EVENTS
    validate_workflow_run!(run, repo: repo, path: PRODUCER_PATHS.fetch(REVIEW_CONTEXT), event: events,
                           default_branch: default_branch)
    workflow_evidence(run)
  end

  def successful_review(repo, sha, default_branch, target_event)
    status = successful_review_status!(repo, sha)
    run = review_workflow_evidence(repo, status, default_branch, target_event)
    { "type" => "commit_status", "id" => status.fetch("id"), "state" => "success", "target_sha" => sha,
      "integration_id" => GITHUB_ACTIONS_INTEGRATION_ID,
      "run" => run }
  end

  def capture_head(repo, sha, event, default_branch, expected_run_id: nil)
    validate_sha!(sha, "target head")
    { "head_sha" => sha, "statuses" => {
      CI_CONTEXT => successful_ci(repo, sha, event, expected_run_id: expected_run_id),
      REVIEW_CONTEXT => successful_review(repo, sha, default_branch, event)
    } }
  end

  def canary_pull!(repo, pr_number, default_branch)
    pull = gh_json("repos/#{repo}/pulls/#{pr_number}")
    valid = pull["state"] == "open" && pull.dig("base", "ref") == default_branch
    raise Error, "canary PR is not open against the default branch" unless valid
    pull
  end

  def canary_merge_run!(repo, merge_run_id)
    merge_run = fetch_workflow_run(repo, merge_run_id)
    validate_workflow_run!(merge_run, repo: repo, path: PRODUCER_PATHS.fetch(CI_CONTEXT), event: "merge_group")
    merge_run
  end

  def captured_canary(repo, ruleset_id, now, default_branch)
    result = { "schema_version" => CANARY_SCHEMA, "repository" => repo, "ruleset_id" => ruleset_id.to_i,
               "observed_at" => now.utc.iso8601, "default_branch" => default_branch }
    result
  end

  def validate_capture_ids!(pr_number, merge_run_id)
    positive_integer!(pr_number, "canary PR number")
    positive_integer!(merge_run_id, "merge-group CI run id")
  end

  def capture_canary_targets!(result, repo, pull, merge_run, default_branch, pr_number, merge_run_id)
    result["pull_request"] = capture_head(repo, pull.dig("head", "sha"), "pull_request", default_branch)
                             .merge("number" => pr_number)
    result["merge_group"] = capture_head(repo, merge_run.fetch("head_sha"), "merge_group", default_branch,
                                         expected_run_id: merge_run_id).merge("ci_run_id" => merge_run_id)
  end

  def capture_canary_body(repo, ruleset_id, pr_number, merge_run_id, now)
    validate_capture_ids!(pr_number, merge_run_id)
    default_branch = gh_json("repos/#{repo}").fetch("default_branch")
    pull = canary_pull!(repo, pr_number, default_branch)
    merge_run = canary_merge_run!(repo, merge_run_id)
    result = captured_canary(repo, ruleset_id, now, default_branch)
    capture_canary_targets!(result, repo, pull, merge_run, default_branch, pr_number, merge_run_id)
    result
  end

  def capture_canary(repo:, ruleset_id:, pr_number:, merge_run_id:, now: Time.now.utc)
    capture_canary_body(repo, ruleset_id, pr_number, merge_run_id, now)
  rescue KeyError, TypeError => error
    raise Error, "malformed GitHub canary response: #{error.message}"
  end
end
