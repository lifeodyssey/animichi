# frozen_string_literal: true

require_relative "card_reconcile_shape_2026"
require_relative "card_reconcile_fixtures"

# Builds the 2026-09-16 shape on disk: one lane directory per card with the launch and exit receipts
# the reconciler reads, and the two verdict documents a lane holds.
module Shape2026Tree
  module_function

  def build(root)
    Shape2026::DEAD.each_with_index { |card, index| lane(root, card, "write", exit_at: Shape2026.dead_stamp(index)) }
    lane(root, Shape2026::UNRECORDED, "pi-attempt", launched_at: Shape2026.stamp(16))
    lane(root, Shape2026::READY, "pi-attempt", launched_at: Shape2026.stamp(15))
    Shape2026::SETTLED.each { |card, phases| phases.each { |phase| settled_lane(root, card, phase) } }
    lane(root, Shape2026::ALIVE, "write", launched_at: Shape2026.stamp(19, 30))
    witness_files(root)
    root
  end

  def settled_lane(root, card, phase)
    lane(root, card, phase, exit_at: Shape2026.stamp(19, 0), workspace: orphan_workspace(root, card))
  end

  # The orphan lane recorded the worktree of #1718 instead of one of its own.
  def orphan_workspace(root, card)
    return "#{root}/w/#{Shape2026::WORKTREES.dig(1718, 0)}" if card == Shape2026::ORPHAN

    nil
  end

  def lane(root, card, phase, exit_at: nil, launched_at: Shape2026::LANE_START, dir: nil, workspace: nil)
    path = File.join(root, dir || "animichi-lane-#{card}", phase)
    ReconcileFixtures.write_json(File.join(path, "launch.json"),
                                 launch(card, Shape2026.task_id(card, phase),
                                        workspace || workspace_for(root, card), launched_at))
    return if exit_at.nil?

    ReconcileFixtures.write_json(File.join(path, "exit.json"), exit_receipt(exit_at))
  end

  def exit_receipt(at)
    { "phase" => "agent_exited", "childPid" => 42, "exitCode" => 0, "observedAt" => at }
  end

  def workspace_for(root, card)
    name = Shape2026::WORKTREES.dig(card, 0) || "orca-#{card}-lane"
    "#{root}/w/#{name}"
  end

  def launch(card, task, workspace, at)
    { "workspace" => workspace, "taskId" => task, "runId" => Shape2026::RUN,
      "coordinatorHandle" => "term_coordinator", "provider" => "pi", "recordedAt" => at }
  end

  def witness_files(root)
    File.write(File.join(root, "animichi-lane-1672", "review-round-2.md"), Shape2026::VERDICT)
    File.write(File.join(root, "animichi-lane-1601", "review-brief.md"),
               "- HEAD `#{Shape2026::PR_HEAD}`\n\n## Report\n\nAPPROVED or CHANGES REQUIRED.\n")
  end

end
