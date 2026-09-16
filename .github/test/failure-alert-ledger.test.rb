# SUT: how the alerter finds its ledger (#678 AC1) — over the open issues' own
# bodies, with no label the repository has to configure first, across pages, and
# failing loudly rather than deduplicating against a ledger it could not read.
require_relative "support/failure-alert-harness"

class FailureAlertLedgerTest < FailureAlertCase
  # The alert must not depend on repository configuration it cannot create for
  # itself. There is no `failure-alert` label in the repository, and `POST /issues`
  # rejects an unknown label with 422 — so naming one would silence the alert at
  # exactly the moment a deploy broke.
  def test_the_alert_names_no_label_the_repository_must_configure_first
    scenario(staging_failure)
    alert
    assert_nil only_alert["labels"], "the alert must not name a label that has to exist first"
    refute_includes ledger_read, "labels=", "a label filter hides alerts whenever that label is missing"
  end

  # The scan reads every open issue, and the repository has ~250 of them; only the
  # ones carrying a marker are ledger entries, so a bodyless or unrelated issue has
  # to be skipped rather than crash the run.
  def test_open_issues_without_a_marker_are_not_ledger_entries
    scenario(staging_failure)
    seed([{ "number" => 42, "title" => "unrelated", "body" => nil },
          { "number" => 43, "title" => "other", "body" => "no marker" }])
    out, err, status = alert
    assert status.success?, err
    assert_includes out, "opened #901", "a foreign open issue must not stop the alert being published"
  end

  def test_the_scan_is_paginated_under_the_pinned_api_version
    scenario(staging_failure)
    alert
    assert_includes ledger_read, "state=open"
    assert_includes ledger_read, "per_page=100"
    assert_includes ledger_read, "page=1"
    assert(calls.all? { |call| call.join(" ").include?(API_VERSION) })
  end

  # A marker matching this run's key, as a previous alert left it on disk. Written
  # by hand so a change to the on-disk format shows up as a failure here.
  def prior_body
    state = { "key" => JSON.generate([WORKFLOW, "main", ["CD / staging"]]),
              "first_seen" => "2026-09-15T00:00:00Z", "last_seen" => "2026-09-15T00:00:00Z",
              "occurrences" => 1, "runs" => [{ "id" => 1, "started" => "2026-09-15T00:00:00Z" }] }
    "<!-- failure-alert:v1 #{JSON.generate(state)} -->"
  end

  # The repository holds ~250 open issues and the ledger only gets longer, so an
  # entry that has slipped onto page two must still be found: a partial ledger
  # would open a second alert for a repeat.
  def test_an_alert_read_from_a_later_page_still_deduplicates
    scenario(staging_failure)
    filler = (1..100).map { |n| { "number" => n, "title" => "unrelated", "body" => nil } }
    seed(filler + [{ "number" => 900, "title" => "Failure alert: CD on main", "body" => prior_body }])
    out, err, status = alert
    assert status.success?, err
    assert_includes out, "updated #900", "an alert on page two must be updated, not duplicated"
  end

  # Past the bound the ledger is refused loudly rather than silently truncated: a
  # partial ledger cannot tell a repeat from a new failure, and a channel that
  # lies about deduplication is worse than one that says it cannot tell.
  def test_the_ledger_refuses_to_read_once_the_page_bound_is_reached
    scenario(staging_failure)
    seed((1..1000).map { |n| { "number" => n, "title" => "unrelated", "body" => nil } })
    _out, err, status = alert
    refute status.success?, "an unreadable ledger must fail the step, not publish blind"
    assert_includes err, "cannot be read safely"
    assert_empty writes
  end
end
