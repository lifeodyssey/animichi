# frozen_string_literal: true

require_relative "card_reconcile_cli_fixture"

class CardReconcileCliTest < Minitest::Test
  include CliFixture

  def test_json_rows_match_the_table_columns
    with_root do |root|
      status, stdout, stderr = invoke(root, ["--json"])
      assert_equal 0, status
      assert_equal "", stderr
      rows = JSON.parse(stdout)
      assert_equal [1672], rows.map { |row| row["card"] }
      assert_equal %w[card facts next_action state stuck_for stuck_since], rows.first.keys.sort
    end
  end

  def test_the_table_reports_ready_to_push_for_an_approved_unpushed_head
    with_root do |root|
      status, stdout, = invoke(root)
      lines = stdout.split("\n")
      assert_equal 0, status
      assert_equal %w[card facts state next-action stuck], lines.first.split(" | ").map(&:strip)
      assert_match(/^1672 \| .*ready-to-push.*\| push/, lines[2])
    end
  end

  def test_a_degraded_gh_keeps_the_report_and_warns
    with_root do |root|
      status, stdout, stderr = invoke(root, ["--json"], degraded: true)
      assert_equal 0, status
      rows = JSON.parse(stdout)
      assert_equal ["ready-to-push"], rows.map { |row| row["state"] }
      assert_match(/open pull requests unknown/, rows.first["facts"])
      assert_match(/degraded: gh failed: gh is down/, stderr)
    end
  end


end
