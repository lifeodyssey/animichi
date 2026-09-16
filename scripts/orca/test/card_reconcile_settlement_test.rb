# frozen_string_literal: true

require_relative "card_reconcile_settlement_fixture"

# Settlement is the Run's task status: `completed` and `failed` are both delivered outcomes, and a
# `failed` one is named separately so the lane can ask for a fix. A `worker_done` message only
# corroborates.
class SettlementTest < Minitest::Test
  include SettlementFixture

  def test_the_runs_completed_tasks_are_the_settlement_fact
    notes = []
    shell = shell_for(tasks: [completed("task_7"), ready("task_8")])
    settled = build(shell: shell, notes: notes).settled({})
    assert_equal ["task_7"], settled.keys
    assert_equal Time.utc(2026, 9, 16, 19, 30), settled["task_7"]
    assert_equal [], notes
    assert_equal ["orca", "orchestration", "task-list", "--run", "run_1", "--json"],
                 shell.calls.first
  end

  def test_a_task_settled_without_a_worker_done_message_still_settles
    settled = build(tasks: [completed("task_7")]).settled({})
    assert_equal ["task_7"], settled.keys
  end

  # `failed` is a terminal Orca status: the worker stopped and reported, so the lane is delivered.
  def test_a_failed_task_is_a_delivered_outcome_and_is_named_separately
    settlement = build(tasks: [completed("task_7"), failed("task_8")])
    assert_equal %w[task_7 task_8], settlement.settled({}).keys.sort
    assert_equal ["task_8"], settlement.failed.keys
    assert_equal Time.utc(2026, 9, 16, 19, 30), settlement.failed["task_8"]
  end

  def test_a_worker_done_for_a_failed_task_corroborates_and_does_not_warn
    notes = []
    settlement = build(tasks: [failed("task_7")], notes: notes)
    assert_equal ["task_7"], settlement.settled("task_7" => ReconcileFixtures::NOW).keys
    assert_empty notes
  end

  def test_a_worker_done_without_a_completed_task_is_corroboration_only
    notes = []
    settled = build(tasks: [ready("task_7")], notes: notes).settled("task_7" => ReconcileFixtures::NOW)
    assert_empty settled
    assert_equal ["settlement: 1 worker_done tasks are not completed: task_7"], notes
  end

  def test_a_worker_done_for_a_task_the_task_list_lacks_is_corroboration_only
    notes = []
    settled = build(tasks: [], notes: notes).settled("task_9" => ReconcileFixtures::NOW)
    assert_empty settled
    assert_equal 1, notes.length
  end
end
