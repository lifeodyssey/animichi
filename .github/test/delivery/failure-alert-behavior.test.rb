# SUT: the failure alert entry (.github/scripts/alert/failure-alert.rb) — the one
# deduplicated alert a failed run publishes, and the silence a restored run keeps
# (#678 AC1). The ledger read has its own contract in failure-alert-ledger.test.rb.
require_relative "support/failure-alert-harness"

class FailureAlertBehaviorTest < FailureAlertCase
  def test_a_failed_run_opens_one_alert_naming_the_workflow_and_linking_the_run
    scenario(staging_failure)
    out, err, status = alert
    assert status.success?, err
    issue = only_alert
    assert_includes issue.fetch("title"), "Failure alert: CD on main"
    assert_includes issue.fetch("body"), "#{SERVER}/#{REPO}/actions/runs/#{RUN_ID}"
    assert_includes out, "opened #901"
  end

  def test_the_alert_says_what_failed_and_when_it_started
    scenario(staging_failure)
    alert
    body = only_alert.fetch("body")
    assert_includes body, "CD / staging"
    assert_includes body, STEP
    assert_includes body, STARTED
    assert_includes body, "**Occurrences:** 1"
  end

  def test_two_failed_jobs_in_one_run_are_still_one_alert
    scenario([failed("CD / select artifact", "Resolve the selected artifact"),
              failed("CD / staging"), concluded(SELF_JOB, nil)])
    alert
    body = only_alert.fetch("body")
    assert_includes body, "CD / select artifact"
    assert_includes body, "CD / staging"
    assert_equal 1, writes.length
  end

  def test_the_same_cause_failing_again_updates_the_one_alert_without_re_alerting
    scenario(staging_failure, run_id: OTHER_RUN_ID)
    alert(run_id: OTHER_RUN_ID)
    scenario(staging_failure)
    out, err, status = alert
    assert status.success?, err
    issue = only_alert
    assert_includes out, "updated #901"
    assert_includes issue.fetch("body"), "**Occurrences:** 2"
    assert_includes issue.fetch("body"), OTHER_RUN_ID.to_s
    assert_equal 1, writes.count { |call| call.include?("POST") }
  end

  def test_a_repeat_never_comments_because_a_comment_is_a_second_notification
    scenario(staging_failure, run_id: OTHER_RUN_ID)
    alert(run_id: OTHER_RUN_ID)
    scenario(staging_failure)
    alert
    only_alert
    assert_empty calls.select { |call| call.join(" ").include?("/comments") }
  end

  def test_re_running_the_same_run_publishes_nothing_at_all
    scenario(staging_failure)
    alert
    scenario(staging_failure, attempt: 2)
    out, _err, _status = alert(attempt: 2)
    only_alert
    assert_includes out, "already recorded on #901"
    assert_equal 1, writes.count { |call| call.include?("POST") }
  end

  def test_a_different_failing_job_is_a_different_failure_and_its_own_alert
    scenario(staging_failure, run_id: OTHER_RUN_ID)
    alert(run_id: OTHER_RUN_ID)
    scenario(staging_failure(job: "CD / production"))
    alert
    assert_equal 2, issues.length
    assert_equal 2, writes.count { |call| call.include?("POST") }
  end

  # The reviewer's collision (#678 review), driven through the committed alerter:
  # one job literally named `a + b` and the two jobs `a` and `b` used to share a
  # key (`names.join(' + ')`), so the pair's failure updated the single job's
  # alert and published nothing new. The key carries the failing-job list, so the
  # two runs must print two different keys and open two alerts.
  def test_a_job_named_like_a_separator_is_not_the_same_failure_as_the_jobs_it_splits_into
    scenario([failed("a + b"), concluded(SELF_JOB, nil)])
    single, err, status = alert
    assert status.success?, err
    scenario([failed("a"), failed("b"), concluded(SELF_JOB, nil)], run_id: OTHER_RUN_ID)
    split, err, status = alert(run_id: OTHER_RUN_ID)
    assert status.success?, err
    refute_equal plan_key(single), plan_key(split), "one job named `a + b` is not the pair `a`, `b`"
    assert_includes single, '["CD","main",["a + b"]]'
    assert_includes split, '["CD","main",["a","b"]]'
    assert_equal 2, issues.length, "one alert per failing-job set"
  end

  # The dedup key the alerter printed, so the two runs are compared on the
  # identity itself and not only on how many issues exist.
  def plan_key(output)
    output[/failure-alert: (\[.*?\]) - /, 1]
  end

  def test_a_restored_workflow_publishes_no_alert
    scenario(restored)
    _out, _err, status = alert
    assert status.success?
    assert_empty writes
    assert_empty issues
  end

  def test_a_cancelled_job_is_a_human_decision_and_never_alerts
    scenario([concluded("CD / select artifact", "success"), concluded("CD / staging", "success"),
              concluded("CD / production", "cancelled"), concluded(SELF_JOB, nil)])
    alert
    assert_empty writes
    assert_empty issues
  end

  def test_a_broken_channel_fails_the_step_instead_of_looking_green
    scenario(staging_failure)
    _out, err, status = alert(refusal: "GET repos/#{REPO}/actions/runs/#{RUN_ID}/jobs")
    refute status.success?
    assert_includes err, "gh api"
    assert_empty issues
  end

  def test_no_secret_reaches_the_alert_the_output_or_the_recorded_calls
    scenario(staging_failure)
    out, err, status = alert
    assert status.success?, err
    written = [out, err, only_alert.fetch("body"), File.read(@calls), File.read(@state)].join("\n")
    refute_includes written, TOKEN
  end
end
