# frozen_string_literal: true

module RulesetCutover
  module_function

  def validate_canary_shape!(evidence)
    keys = %w[schema_version repository ruleset_id observed_at default_branch pull_request merge_group]
    missing = keys.reject { |key| evidence.is_a?(Hash) && evidence.key?(key) }
    raise Error, "canary evidence is missing: #{missing.join(", ")}" unless missing.empty?
  end
  def validate_sha!(sha, label)
    return if sha.is_a?(String) && sha.match?(/\A[0-9a-f]{40}\z/)
    raise Error, "#{label} must be a 40-hex SHA"
  end
  def validate_statuses!(statuses, sha, label)
    valid_keys = statuses.is_a?(Hash) && statuses.keys.sort == APPROVED_CONTEXTS.sort
    raise Error, "#{label} statuses must contain exactly the approved contexts" unless valid_keys
    statuses.each { |context, status| validate_status!(context, status, sha, label) }
  end
  def validate_status_identity!(context, status, sha, label)
    expected_type = context == CI_CONTEXT ? "check_run" : "commit_status"
    valid = status.is_a?(Hash) && status["type"] == expected_type && status["state"] == "success" && status["target_sha"] == sha
    raise Error, "#{label} #{context} must be success on its target SHA" unless valid
    positive_integer!(status["id"], "#{label} #{context} evidence id")
    if context == REVIEW_CONTEXT && status["integration_id"] != GITHUB_ACTIONS_INTEGRATION_ID
      raise Error, "#{label} #{context} integration source mismatch"
    end
  end

  def validate_status_producer!(context, status, label)
    producer = status["run"]
    raise Error, "#{label} #{context} producer run is malformed" unless producer.is_a?(Hash)
    positive_integer!(producer["id"], "#{label} #{context} producer run id")
    validate_sha!(producer["head_sha"], "#{label} #{context} producer head")
    return if producer["path"] == PRODUCER_PATHS.fetch(context)
    raise Error, "#{label} #{context} producer workflow path mismatch"
  end

  def validate_status!(context, status, sha, label)
    validate_status_identity!(context, status, sha, label)
    validate_status_producer!(context, status, label)
  end
  def validate_head!(entry, label)
    raise Error, "#{label} evidence must be an object" unless entry.is_a?(Hash)
    sha = entry.fetch("head_sha")
    validate_sha!(sha, "#{label} head_sha")
    validate_statuses!(entry.fetch("statuses"), sha, label)
  end
  def validate_ci_producer!(entry, event, expected_ci_run_id)
    sha = entry.fetch("head_sha")
    ci_run = entry.dig("statuses", CI_CONTEXT, "run")
    valid_ci = ci_run["event"] == event && ci_run["head_sha"] == sha
    raise Error, "#{event} CI producer is not bound to its target head" unless valid_ci
    return unless expected_ci_run_id && ci_run["id"] != expected_ci_run_id
    raise Error, "merge-group CI run identity mismatch"
  end

  def validate_review_producer!(entry, event, default_branch)
    review_run = entry.dig("statuses", REVIEW_CONTEXT, "run")
    review_events = event == "merge_group" ? ["workflow_run"] : REVIEW_EVENTS
    valid_review = review_events.include?(review_run["event"]) && review_run["head_branch"] == default_branch
    raise Error, "Review Gate producer is not a trusted default-branch run" unless valid_review
  end

  def validate_artifact_producers!(entry, event, default_branch, expected_ci_run_id: nil)
    validate_ci_producer!(entry, event, expected_ci_run_id)
    validate_review_producer!(entry, event, default_branch)
  end
  def validate_producers!(producers, root: File.expand_path("../..", __dir__))
    valid_keys = producers.is_a?(Hash) && producers.keys.sort == APPROVED_CONTEXTS.sort
    raise Error, "producer_workflows must contain exactly the approved contexts" unless valid_keys
    PRODUCER_PATHS.each { |context, path| validate_producer!(producers, context, path, root) }
  end
  def validate_producer!(producers, context, path, root)
    entry = producers.fetch(context)
    expected = Digest::SHA256.file(File.join(root, path)).hexdigest
    valid = entry.is_a?(Hash) && entry["path"] == path && entry["sha256"] == expected
    raise Error, "#{context} producer workflow digest/path does not match #{path}" unless valid
  end
  def validate_freshness!(observed_at, now)
    age = now - Time.iso8601(observed_at)
    raise Error, "canary evidence is stale or from the future" unless age.between?(0, CANARY_MAX_AGE)
  rescue ArgumentError, TypeError
    raise Error, "canary observed_at must be ISO-8601"
  end
  def validate_identity!(evidence, repo, ruleset_id)
    raise Error, "canary schema mismatch" unless evidence.fetch("schema_version") == CANARY_SCHEMA
    raise Error, "canary repository mismatch" unless evidence.fetch("repository") == repo
    raise Error, "canary ruleset mismatch" unless evidence.fetch("ruleset_id") == ruleset_id.to_i
  end
  def canary_heads!(evidence)
    pull_request = evidence.fetch("pull_request")
    validate_pull_request!(pull_request)
    merge_group = evidence.fetch("merge_group")
    positive_integer!(merge_group["ci_run_id"], "merge-group CI run id")
    validate_head!(merge_group, "merge_group")
    [pull_request, merge_group]
  end

  def validate_canary_branch!(evidence)
    branch = evidence.fetch("default_branch")
    raise Error, "canary default branch is missing" unless branch.is_a?(String) && !branch.empty?
    branch
  end

  def validate_canary_producers!(pull_request, merge_group, default_branch)
    validate_artifact_producers!(pull_request, "pull_request", default_branch)
    validate_artifact_producers!(merge_group, "merge_group", default_branch,
                                 expected_ci_run_id: merge_group["ci_run_id"])
  end

  def validate_canary_body!(evidence, repo, ruleset_id, now)
    validate_canary_shape!(evidence)
    validate_identity!(evidence, repo, ruleset_id)
    validate_freshness!(evidence.fetch("observed_at"), now)
    default_branch = validate_canary_branch!(evidence)
    pull_request, merge_group = canary_heads!(evidence)
    validate_canary_producers!(pull_request, merge_group, default_branch)
    true
  end

  def validate_canary!(evidence, repo:, ruleset_id:, now: Time.now.utc, root: File.expand_path("../..", __dir__))
    validate_canary_body!(evidence, repo, ruleset_id, now)
  rescue KeyError, TypeError => error
    raise Error, "malformed canary evidence: #{error.message}"
  end
  def validate_pull_request!(pull_request)
    raise Error, "pull_request evidence must be an object" unless pull_request.is_a?(Hash)
    positive_integer!(pull_request["number"], "canary PR number")
    validate_head!(pull_request, "pull_request")
  end
  def canonical_object(value)
    return value.keys.sort.to_h { |key| [key, canonical_object(value.fetch(key))] } if value.is_a?(Hash)
    return value.map { |entry| canonical_object(entry) } if value.is_a?(Array)
    value
  end
  def canary_digest(evidence)
    Digest::SHA256.hexdigest(JSON.generate(canonical_object(evidence)))
  end
  def load_canary!(evidence, digest, **options)
    raise Error, "canary artifact digest mismatch" unless digest.is_a?(String) && canary_digest(evidence) == digest
    validate_canary!(evidence, **options)
  end

  def comparable_canary(evidence)
    copy = deep_copy(evidence)
    copy.delete("observed_at")
    canonical_object(copy)
  end

  def revalidate_canary!(evidence, repo:, ruleset_id:, now: Time.now.utc)
    validate_canary!(evidence, repo: repo, ruleset_id: ruleset_id, now: now)
    live = capture_canary(repo: repo, ruleset_id: ruleset_id,
                          pr_number: evidence.dig("pull_request", "number"),
                          merge_run_id: evidence.dig("merge_group", "ci_run_id"), now: now)
    unless comparable_canary(evidence) == comparable_canary(live)
      raise Error, "canary does not match current GitHub API evidence"
    end
    live
  end
end
