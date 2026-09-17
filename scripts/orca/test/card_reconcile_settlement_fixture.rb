# frozen_string_literal: true

require_relative "card_reconcile_fixtures"
require_relative "scripted_shell"

# The `orca task-list` documents a test asks with: the Run's tasks, or a read that failed.
module SettlementFixture
  module_function

  def build(tasks: [], failure: nil, notes: [], run: "run_1", shell: nil)
    shell ||= shell_for(tasks: tasks, failure: failure)
    Orca::CardReconcile::Settlement.new(Orca::CardReconcile::Command.new(shell), run, notes)
  end

  def shell_for(tasks: [], failure: nil)
    ScriptedShell.new("orca orchestration task-list" => failure || document(tasks))
  end

  def document(tasks)
    JSON.generate({ "ok" => true, "result" => { "runId" => "run_1", "tasks" => tasks } })
  end

  def completed(id)
    { "id" => id, "status" => "completed", "completed_at" => "2026-09-16T19:30:00Z" }
  end

  def failed(id)
    { "id" => id, "status" => "failed", "completed_at" => "2026-09-16T19:30:00Z" }
  end

  def ready(id)
    { "id" => id, "status" => "ready" }
  end
end
