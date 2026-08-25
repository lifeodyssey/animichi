# frozen_string_literal: true

TRUSTED_EVENTS = %w[pull_request_target pull_request_review pull_request_review_comment issue_comment workflow_run].freeze

def named_step(steps, name, path)
  steps.find { |step| step.is_a?(Hash) && step["name"] == name } || abort("#{path} missing step #{name}")
end

def assert_trusted_events(workflow, path)
  events = triggers(workflow, path)
  missing = TRUSTED_EVENTS - events.keys
  abort "#{path} missing trusted events: #{missing.join(', ')}" unless missing.empty?
  forbidden = %w[pull_request merge_group] & events.keys
  abort "#{path} must not run a status writer on candidate events: #{forbidden.join(', ')}" unless forbidden.empty?
  run = events.fetch("workflow_run")
  abort "#{path} workflow_run must bridge completed CI" unless run.fetch("workflows") == ["CI"] && run.fetch("types") == ["completed"]
end

def assert_trusted_checkout(job, path)
  checkout = job.fetch("steps").find { |step| step.fetch("uses", "").start_with?("actions/checkout@") }
  abort "#{path} status writer must checkout trusted default-branch code" if checkout.nil?
  ref = checkout.fetch("with", {}).fetch("ref", "")
  abort "#{path} checkout must use the immutable trusted-source SHA" unless ref == "${{ steps.trusted.outputs.sha }}"
  abort "#{path} checkout must disable persisted credentials" unless checkout.dig("with", "persist-credentials") == false
end

def assert_no_candidate_execution(job, path)
  assert_trusted_checkout(job, path)
end

def assert_refresh_steps(job, path)
  steps = job.fetch("steps")
  bootstrap = named_step(steps, "Bootstrap fail-closed pending status", path)
  trusted = named_step(steps, "Resolve immutable trusted source", path)
  checkout = steps.find { |step| step.fetch("uses", "").start_with?("actions/checkout@") }
  title = named_step(steps, "Validate squash title", path)
  judge = named_step(steps, "Evaluate head-bound review evidence", path)
  finish = named_step(steps, "Publish only if this run still owns the status", path)
  bootstrap_source = YAML.dump(bootstrap)
  abort "#{path} bootstrap must resolve exact event targets" unless bootstrap_source.include?("pull_request.head.sha") && bootstrap_source.include?("workflow_run.head_sha")
  abort "#{path} bootstrap must publish pending itself" unless bootstrap_source.include?("post_with_retry pending") && bootstrap_source.include?("context='Review Gate'")
  abort "#{path} bootstrap must expose its target before claiming" unless bootstrap_source.index("head_sha=") < bootstrap_source.index("post_with_retry pending")
  abort "#{path} bootstrap must retry status publication" unless bootstrap_source.include?("post_with_retry")
  abort "#{path} bootstrap claim failure must attempt a red status" unless bootstrap_source.include?("post_with_retry pending || { post_with_retry failure")
  abort "#{path} must resolve the immutable default branch after pending" unless YAML.dump(trusted).include?("repository.default_branch")
  title_source = title.fetch("run")
  abort "#{path} title validation must read current PR state" unless title_source.include?(%q{gh api "repos/$REPO/pulls/$PR_NUMBER" --jq .title})
  abort "#{path} title validation must use the canonical validator" unless title_source.include?(%q{python3 scripts/local-gates/commit-message.py --subject "$title"})
  abort "#{path} title validation must run only for PR targets" unless title.fetch("if").include?("target_kind == 'pr'")
  abort "#{path} title validation must not interpolate event title text" if YAML.dump(title).include?("pull_request.title")
  abort "#{path} must evaluate PR and queue evidence" unless judge.fetch("run").include?("collect-target")
  judge_env = judge.fetch("env")
  abort "#{path} queue evidence must be loaded from the workflow run API" unless judge_env.key?("CI_RUN_ID")
  stale_event_inputs = %w[CI_CONCLUSION QUEUE_PULL_REQUESTS] & judge_env.keys
  abort "#{path} must not trust workflow_run event evidence: #{stale_event_inputs.join(', ')}" unless stale_event_inputs.empty?
  abort "#{path} must not pass event pull-request JSON to the gate" if YAML.dump(judge).include?("workflow_run.pull_requests")
  abort "#{path} final status must use newest-run ownership guard" unless finish.fetch("run").include?("finish-status")
  abort "#{path} final status must run after failures" unless finish.fetch("if").include?("always()")
  indexes = [bootstrap, trusted, checkout, title, judge, finish].map { |step| steps.index(step) }
  abort "#{path} must claim pending before trusted resolution, checkout, and evidence" unless indexes == indexes.sort
  abort "#{path} guarded final must be last" unless indexes.last == steps.length - 1
end

def assert_status_writer_permissions(workflow, job, path)
  permissions = workflow.fetch("permissions", {}).merge(job.fetch("permissions", {}))
  abort "#{path} publisher must write statuses" unless permissions["statuses"] == "write"
  %w[contents pull-requests actions checks].each do |scope|
    abort "#{path} publisher must have #{scope}: read" unless permissions[scope] == "read"
  end
end
