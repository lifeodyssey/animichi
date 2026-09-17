# frozen_string_literal: true

require_relative "card_reconcile_fixtures"

module LaneFixtures
  module_function

  def launch(card, task)
    { "schemaVersion" => 1, "workspace" => "/w/orca-#{card}-lane", "taskId" => task,
      "runId" => "run_1", "coordinatorHandle" => "term_coordinator", "provider" => "pi",
      "recordedAt" => "2026-09-16T18:00:00Z" }
  end

  def build(root, card, name, task, extra = {})
    build_raw(root, card, name, launch(card, task), extra)
  end

  def build_raw(root, card, name, receipt, extra = {})
    ReconcileFixtures.write_json(File.join(root, "animichi-lane-#{card}", name, "launch.json"),
                                 receipt)
    extra.each do |file, content|
      ReconcileFixtures.write_json(File.join(root, "animichi-lane-#{card}", name, file), content)
    end
  end

  def exit_at(observed = "2026-09-16T18:30:00Z")
    { "phase" => "agent_exited", "childPid" => 42, "exitCode" => 0, "observedAt" => observed }
  end
end

class LaneReaderTest < Minitest::Test
  include ReconcileFixtures

  def test_a_dead_runner_with_an_exit_receipt_is_not_running
    Dir.mktmpdir do |root|
      LaneFixtures.build(root, 1672, "write", "task_a", "exit.json" => LaneFixtures.exit_at)
      phase = reader(root, []).lanes.first.phases.first
      assert_equal false, phase.running?
      assert_equal Time.utc(2026, 9, 16, 18, 30), phase.exited_at
      assert_equal "task_a", phase.task_id
      assert_equal "/w/orca-1672-lane", phase.workspace
    end
  end

  def test_a_live_runner_holding_an_exited_agent_is_not_running
    Dir.mktmpdir do |root|
      LaneFixtures.build(root, 1672, "write", "task_a", "exit.json" => LaneFixtures.exit_at)
      dir = File.join(root, "animichi-lane-1672", "write")
      assert_equal false, reader(root, [dir]).lanes.first.phases.first.running?
    end
  end

  def test_a_live_runner_without_an_exit_receipt_is_running
    Dir.mktmpdir do |root|
      LaneFixtures.build(root, 1672, "write", "task_a")
      phase = reader(root, [File.join(root, "animichi-lane-1672", "write")]).lanes.first.phases.first
      assert_equal true, phase.running?
      assert_equal Time.utc(2026, 9, 16, 18), phase.launched_at
    end
  end

  def test_suffixed_lane_directories_group_under_one_card
    Dir.mktmpdir do |root|
      LaneFixtures.build(root, 1672, "write", "task_a")
      LaneFixtures.build(root, "1672-fix", "fix", "task_b")
      lanes = reader(root, []).lanes
      assert_equal [1672], lanes.map(&:card)
      assert_equal %w[fix write], lanes.first.phases.map(&:name).sort
    end
  end

  # A receipt field the rows are derived from must be present: a nil task id would read a settled
  # lane as unsettled instead of refusing the malformed receipt.
  def test_a_launch_receipt_without_a_consumed_field_is_refused
    Dir.mktmpdir do |root|
      receipt = LaneFixtures.launch(1672, "task_a")
      receipt.delete("taskId")
      LaneFixtures.build_raw(root, 1672, "write", receipt)
      error = assert_raises(Orca::CardReconcile::Failure) { reader(root, []).lanes }
      assert_match(/taskId/, error.message)
    end
  end

  def test_a_launch_receipt_with_an_invalid_timestamp_is_refused
    Dir.mktmpdir do |root|
      receipt = LaneFixtures.launch(1672, "task_a").merge("recordedAt" => "not-a-time")
      LaneFixtures.build_raw(root, 1672, "write", receipt)
      error = assert_raises(Orca::CardReconcile::Failure) { reader(root, []).lanes }
      assert_match(/recordedAt/, error.message)
    end
  end

  def test_an_exit_receipt_with_an_invalid_observed_at_is_refused
    Dir.mktmpdir do |root|
      LaneFixtures.build(root, 1672, "write", "task_a",
                         "exit.json" => LaneFixtures.exit_at("yesterday"))
      error = assert_raises(Orca::CardReconcile::Failure) { reader(root, []).lanes }
      assert_match(/observedAt/, error.message)
    end
  end

  def test_the_archive_and_other_directories_are_ignored
    Dir.mktmpdir do |root|
      LaneFixtures.build(root, "archive", "write", "task_a")
      FileUtils.mkdir_p(File.join(root, "animichi-lane-1655"))
      write_text(File.join(root, "animichi-lane-1655-brief.md"), "brief\n")
      FileUtils.mkdir_p(File.join(root, "unrelated"))
      assert_empty reader(root, []).lanes
    end
  end
  private

  def reader(root, live)
    Orca::CardReconcile::LaneReader.new(root, ->(dir) { live.include?(dir) })
  end
end
