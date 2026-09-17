# frozen_string_literal: true

require_relative "card_reconcile_cli_fixture"

# A lane whose worker reported `failed`, read end to end: the Run's task status is the settlement
# fact, so the row says the lane delivered a failure and names the fix instead of the missing
# `worker_done` it never failed to send.
class DeliveredFailedTest < Minitest::Test
  include CliFixture

  def test_a_lane_whose_worker_reported_failed_is_delivered_failed
    with_root do |root|
      status, stdout, stderr = invoke(root, ["--json"], failed: true)
      assert_equal 0, status
      assert_equal "", stderr
      row = JSON.parse(stdout).first
      assert_equal "delivered-failed", row["state"]
      assert_equal "lane write reported failed", row["facts"]
      assert_equal "dispatch fix", row["next_action"]
    end
  end

  def test_the_same_lane_reads_as_approved_when_its_worker_completed
    with_root do |root|
      _status, stdout, = invoke(root)
      assert_match(/\| ready-to-push \| push/, stdout)
      assert_match(/^1672 \| head d49a1c8, remote unknown, APPROVED@d49a1c8, no open PR at this head/m, stdout)
    end
  end
end
