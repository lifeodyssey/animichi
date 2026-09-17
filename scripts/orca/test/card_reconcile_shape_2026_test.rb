# frozen_string_literal: true

require_relative "card_reconcile_shape_2026_snapshot"

# The 2026-09-16 shape comes back as flagged rows: the dead runners, the unreviewed head, the
# approved head waiting to be pushed, and the card the Report puts first.
class Shape2026Test < Minitest::Test
  include Shape2026Snapshot

  def test_the_four_2026_09_16_failures_come_back_as_flagged_rows
    rows = Shape2026Snapshot.rows
    undelivered = rows.select { |row| row.state == "undelivered" }.map(&:card)
    assert_equal (Shape2026::DEAD + [Shape2026::UNRECORDED, Shape2026::READY]).sort, undelivered
    assert_equal "running", row_for(rows, Shape2026::ALIVE).state
    assert_equal "ready-to-push", row_for(rows, 1672).state
    assert_match(/APPROVED@d49a1c8/, row_for(rows, 1672).facts)
    assert_equal "needs-review", row_for(rows, 1601).state
    assert_match(/no verdict for this head/, row_for(rows, 1601).facts)
  end

  def test_a_dead_runner_without_an_exit_receipt_is_undelivered
    row = row_for(Shape2026Snapshot.rows, Shape2026::UNRECORDED)
    assert_equal "undelivered", row.state
    assert_match(/lane pi-attempt exited unknown, no worker_done/, row.facts)
    assert_equal Time.utc(2026, 9, 16, 16), row.stuck_since
  end

  def test_a_new_push_unseats_the_verdict_again
    rows = Shape2026Snapshot.rows(Shape2026::HEADS.merge(1672 => Shape2026::LATER))
    assert_equal "needs-review", row_for(rows, 1672).state
  end

  def test_the_longest_stuck_card_is_reported_first
    rows = Shape2026Snapshot.rows
    table = Orca::CardReconcile::Report.new(rows, ReconcileFixtures::NOW).sorted
    assert_equal 1000, table.first.card
    assert_equal 6 * 3600, table.first.stuck_seconds(ReconcileFixtures::NOW).to_i
    stuck = table.map { |row| row.stuck_seconds(ReconcileFixtures::NOW).to_i }
    assert_equal stuck.sort.reverse, stuck
  end

  def test_the_lane_brief_is_not_a_verdict_and_the_mailbox_only_corroborates
    Shape2026Snapshot.with_snapshot do |snapshot|
      facts = Orca::CardReconcile::Facts.new(snapshot)
      assert_nil snapshot.verdicts.fresh(facts.lane(1601), Shape2026::PR_HEAD,
                                         facts.pulls.base(1601))
      assert_equal [], snapshot.notes
      assert_equal settled_task_ids.sort, snapshot.settled.keys.sort
    end
  end

  private

  def settled_task_ids
    Shape2026::SETTLED.flat_map do |card, phases|
      phases.map { |phase| Shape2026.task_id(card, phase) }
    end
  end
end
