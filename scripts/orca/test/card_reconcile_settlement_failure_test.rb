# frozen_string_literal: true

require_relative "card_reconcile_settlement_fixture"

# A settlement read that failed: it settles nothing, and the reason reaches the report as a note
# rather than turning into a silent "nothing settled".
class SettlementFailureTest < Minitest::Test
  include SettlementFixture

  def test_a_failed_task_list_is_noted_and_settles_nothing
    notes = []
    failure = Orca::CardReconcile::Command::Result.new("", "orca is down", 1)
    settled = build(tasks: [], failure: failure, notes: notes)
              .settled({ "task_7" => ReconcileFixtures::NOW })
    assert_empty settled
    assert_match(/settlement: orca task-list failed: orca is down/, notes.first)
    assert_match(/worker_done tasks are not completed/, notes.last)
  end

  def test_a_missing_run_settles_nothing_without_reading
    shell = ScriptedShell.new({})
    settlement = Orca::CardReconcile::Settlement.new(
      Orca::CardReconcile::Command.new(shell), nil, []
    )
    assert_empty settlement.settled({ "task_7" => ReconcileFixtures::NOW })
    assert_empty shell.calls
  end

  def test_malformed_task_json_is_reported_as_a_failure
    shell = ScriptedShell.new("orca orchestration task-list" => "not json")
    notes = []
    settlement = Orca::CardReconcile::Settlement.new(
      Orca::CardReconcile::Command.new(shell), "run_1", notes
    )
    assert_empty settlement.settled({})
    assert_match(/malformed JSON/, notes.first)
  end
end
