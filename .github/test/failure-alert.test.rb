# SUT: the failure alert's workflow wiring (#678 AC1) — which runs reach the
# alerter, what it is handed, and the permissions it publishes under. The
# behavior itself is driven in failure-alert-behavior.test.rb; this is the
# contract that fails when the wiring is deleted.
require "minitest/autorun"
require "psych"

class FailureAlertWiringTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  WORKFLOWS = Dir.glob(File.join(ROOT, ".github/workflows/*.yml")).sort
  JOB = "alert-failure"
  ENTRY = "ruby .github/scripts/alert/failure-alert.rb"
  PERMISSIONS = { "contents" => "read", "actions" => "read", "issues" => "write" }.freeze
  # The names the alerter itself reads: the run's own identity and its job name.
  # The token is not among them — `gh` reads GH_TOKEN from the step env, which the
  # wiring test above pins to the run's own token.
  READS = %w[ALERT_SELF_JOB GITHUB_REF_NAME GITHUB_REPOSITORY GITHUB_RUN_ID GITHUB_SERVER_URL GITHUB_WORKFLOW].freeze
  # A pull request failure is already visible on the pull request. These events
  # are the ones with no human-facing surface of their own.
  UNATTENDED = %w[schedule push workflow_dispatch].freeze

  def documents
    WORKFLOWS.to_h { |path| [File.basename(path), Psych.safe_load(File.read(path), aliases: true)] }
  end

  def events(workflow)
    (workflow["on"] || workflow[true].to_h).keys
  end

  def unattended
    documents.select { |_file, workflow| events(workflow).any? { |event| UNATTENDED.include?(event) } }
  end

  def alerter(workflow, file)
    workflow.fetch("jobs", {})[JOB].tap { |job| refute_nil job, "#{file}: a run that fails must alert (#{JOB})" }
  end

  def alert_step(workflow, file)
    alerter(workflow, file).fetch("steps").find { |step| step["run"].to_s.start_with?("ruby .github/scripts/alert/") }
                  .tap { |step| refute_nil step, "#{file}: no step invokes the alerter" }
  end

  def each_unattended
    refute_empty unattended, "no unattended workflow carries the alert contract; this guard would pass with its subject deleted"
    unattended.each { |file, workflow| yield(file, workflow) }
  end

  def test_every_unattended_workflow_reaches_the_alerter
    each_unattended { |file, workflow| alerter(workflow, file) }
  end

  def test_the_alerter_sees_every_job_of_its_workflow
    each_unattended do |file, workflow|
      assert_equal (workflow.fetch("jobs").keys - [JOB]).sort, Array(alerter(workflow, file)["needs"]).sort,
                   "#{file}: a failure in any job must reach #{JOB}"
    end
  end

  def test_the_alerter_runs_on_failure_and_stays_silent_on_success
    each_unattended do |file, workflow|
      condition = alerter(workflow, file).fetch("if")
      assert_includes condition, "always()", "#{file}: #{JOB} must run even though a dependency failed"
      assert_includes condition, "contains(needs.*.result, 'failure')", "#{file}: #{JOB} must run on a failure only"
      refute_includes condition, "cancelled", "#{file}: a withdrawn deployment approval is not a failure"
    end
  end

  def test_the_alerter_publishes_under_least_privilege
    each_unattended do |file, workflow|
      job = alerter(workflow, file)
      assert_equal PERMISSIONS, job["permissions"], "#{file}: #{JOB} publishes issues and reads the run, nothing else"
      assert job["timeout-minutes"], "#{file}: #{JOB} needs a time limit"
    end
  end

  # One alert is a read-then-write, so it needs mutual exclusion and not only an
  # idempotent payload: two concurrent runs that share a key must not both find the
  # alert absent and both create it. The group is the key's own (workflow, ref)
  # prefix, so same-key runs serialize; `github.run_id` would give every run its own
  # group and let them race.
  def test_the_alerter_serializes_the_runs_that_share_a_key
    each_unattended do |file, workflow|
      group = alerter(workflow, file).dig("concurrency", "group").to_s
      assert_includes group, "github.workflow", "#{file}: #{JOB} must serialize per workflow, not per run"
      assert_includes group, "github.ref", "#{file}: #{JOB} must serialize one ref's runs against each other"
      assert_equal false, alerter(workflow, file).dig("concurrency", "cancel-in-progress"),
                   "#{file}: a waiting publisher must never cancel the one holding the group"
    end
  end

  def test_the_alerter_is_handed_the_run_token_and_its_own_job_name_only
    each_unattended do |file, workflow|
      job = alerter(workflow, file)
      assert_equal({ "GH_TOKEN" => "${{ github.token }}", "ALERT_SELF_JOB" => job.fetch("name") },
                   alert_step(workflow, file).fetch("env"),
                   "#{file}: the alerter gets the run's own token, no secret context, and no new credential")
    end
  end

  def test_the_alerter_step_invokes_the_committed_entry
    each_unattended do |file, workflow|
      assert_equal ENTRY, alert_step(workflow, file).fetch("run"), "#{file}: #{JOB} must invoke the committed entry"
    end
  end

  def test_the_alerter_checks_out_without_persisting_credentials
    each_unattended do |file, workflow|
      checkout = alerter(workflow, file).fetch("steps").first
      assert_match(/\Aactions\/checkout@[0-9a-f]{40}\z/, checkout.fetch("uses"), "#{file}: #{JOB} must check out first")
      assert_equal false, checkout.dig("with", "persist-credentials"), "#{file}: the alert must not hold the token on disk"
    end
  end

  # `pr-verification.yml` runs on `push` too (#1715), so it is unattended and the
  # alerter belongs in it — but a pull request failure is already on the pull
  # request, which is the surface this workflow's other events have. The alert
  # must therefore be gated to the one event left with no human-facing surface,
  # and this is what pins that gate rather than the job's absence.
  def test_pull_request_verification_alerts_only_on_the_merged_commit
    condition = alerter(documents.fetch("pr-verification.yml"), "pr-verification.yml").fetch("if")
    assert_includes condition, "github.event_name == 'push'",
                    "pr-verification.yml: a PR failure is already on the pull request, so the alert is push-only"
  end

  def test_the_alerter_reads_no_credential_beyond_the_run_identity
    assert_equal READS, alerter_environment,
                 "the alerter's whole environment surface is pinned: a new name is a new credential path"
  end

  def alerter_environment
    sources = [File.join(ROOT, ".github/scripts/alert/failure-alert.rb")] + Dir.glob(File.join(ROOT, ".github/lib/alert/*.rb"))
    sources.flat_map { |path| File.read(path).scan(/ENV(?:\.fetch)?\(?['"]([A-Z_]+)['"]/) }.flatten.uniq.sort
  end
end
