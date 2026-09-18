# SUT: .github/scripts/alert/failure-alert.rb's audience — who a published alert
# reaches (#1718 AC2): the assignment that turns an issue nobody is watching into
# a notification, where that name comes from, and the refusal that keeps a dropped
# audience from reading as coverage. The dedup identity, the ledger and the
# permissions are #678's contracts and keep their own counts; this file asserts
# the audience only.
require_relative "support/failure-alert-harness"

class FailureAlertRecipientTest < FailureAlertCase
  # The repository's owner, which is what the alerter is expected to read out of
  # the repository rather than write down. GitHub only accepts an assignee the
  # caller may set, and the owner is the one account that necessarily has the push
  # access that requires.
  OWNER = "lifeodyssey"

  def assignees
    Array(only_alert["assignees"]).map { |user| user.fetch("login") }
  end

  def test_a_published_alert_is_assigned_to_a_named_person
    scenario(staging_failure)
    out, err, status = alert
    assert status.success?, err
    assert_equal [OWNER], assignees, "an alert published with no assignee notifies nobody"
    assert_includes out, "opened #901"
  end

  # The name is read from the repository the run is already told it is, not written
  # into the alerter: a hard-coded login survives a transfer or rename and keeps
  # naming an account that no longer owns the repository, at exactly the moment an
  # alert has to arrive somewhere.
  def test_the_recipient_follows_the_repository_identity_rather_than_a_literal
    scenario(staging_failure)
    _out, err, status = alert(repo: "another-maintainer/animichi")
    assert status.success?, err
    assert_equal ["another-maintainer"], assignees,
                 "the recipient must be the repository's owner, not a hard-coded login"
  end

  # `POST /issues` answers 201 and silently drops an assignee the caller may not
  # set, so the response is the only witness that anyone was notified. An
  # unverified channel then publishes an issue that reaches nobody while looking
  # exactly like one that reached someone — the failure this audience exists to
  # prevent, so it must fail the step instead.
  def test_an_assignee_github_dropped_fails_the_step_instead_of_notifying_nobody
    scenario(staging_failure)
    _out, err, status = alert(drop_assignees: true)
    refute status.success?, "an alert that notifies nobody must not look green"
    assert_includes err, "notifies nobody"
  end
end
