# frozen_string_literal: true

require_relative "card_reconcile_fixtures"
require_relative "scripted_shell"

# The liveness one phase reads from the process table: a runner whose command line names the lane
# directory is alive, and a failed `ps` read is unknown rather than dead.
class ProcessProbeTest < Minitest::Test
  def test_a_runner_process_on_the_lane_directory_is_alive
    probe = Orca::CardReconcile::ProcessProbe.new(command("ruby runner.rb --state /tmp/lane-1\n"),
                                                  [])
    assert_equal true, probe.call("/tmp/lane-1")
  end

  def test_no_runner_process_on_the_lane_directory_is_not_alive
    probe = Orca::CardReconcile::ProcessProbe.new(command("ruby runner.rb --state /tmp/other\n"),
                                                  [])
    assert_equal false, probe.call("/tmp/lane-1")
  end

  # The failed read must not become a row that cannot match the runner checks and so read as
  # "no runner": liveness stays unknown, with the failure noted.
  def test_a_failed_process_table_read_is_unknown_not_dead
    notes = []
    probe = Orca::CardReconcile::ProcessProbe.new(failing_command, notes)
    assert_nil probe.call("/tmp/lane-1")
    assert_equal 1, notes.length
  end

  private

  def command(table)
    Orca::CardReconcile::Command.new(ScriptedShell.new("ps -eo command=" => table))
  end

  def failing_command
    Orca::CardReconcile::Command.new(
      ScriptedShell.new("ps -eo command=" => Orca::CardReconcile::Command::Result.new("", "boom", 1))
    )
  end
end
