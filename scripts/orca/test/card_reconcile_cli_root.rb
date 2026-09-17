# frozen_string_literal: true

require_relative "card_reconcile_fixtures"
require_relative "scripted_shell"

# The root a CLI run reads: one lane directory whose approved head is unpushed, plus the stubbed
# Orca, GitHub and git reads that run makes. `CliFixture` runs the CLI over it.
module CliRoot
  HEAD = "d49a1c8be1f2a3b4c5d6e7f8091a2b3c4d5e6f70".freeze
  VERDICT = <<~MARKDOWN
    # Round-2 review — #1672

    - HEAD (under review): `#{HEAD}`

    ## Verdict: APPROVED
  MARKDOWN

  module_function

  def build(root)
    ReconcileFixtures.write_json(File.join(root, "animichi-lane-1672", "write", "launch.json"),
                                 launch)
    ReconcileFixtures.write_json(File.join(root, "animichi-lane-1672", "write", "exit.json"),
                                 { "phase" => "agent_exited",
                                   "observedAt" => "2026-09-16T18:00:00Z" })
    File.write(File.join(root, "animichi-lane-1672", "review-round-2.md"), VERDICT)
    root
  end

  def responses(root, git: true, failed: false)
    { "ps -eo command=" => "", "orca orchestration check" => JSON.generate(mailbox),
      "orca orchestration inbox" => JSON.generate(mailbox),
      "orca orchestration task-list" => JSON.generate(task_list(failed)),
      "gh pr list --repo lifeodyssey/animichi --state open" => "[]",
      "gh pr list --repo lifeodyssey/animichi --state merged" => "[]",
      "git -C #{root} worktree list --porcelain" => worktree(root, git),
      "git -C #{root} ls-remote --heads origin" => "" }.merge(worktree_state(git))
  end

  def launch
    { "workspace" => "/w/orca-1672-lane", "taskId" => "task_1672_write", "runId" => "run_1",
      "coordinatorHandle" => "term_coordinator", "provider" => "pi",
      "recordedAt" => "2026-09-16T13:00:00Z" }
  end

  # The worker of this lane reported `completed`, or `failed` for a run that needs the fix row.
  def task_list(failed = false)
    status = failed ? "failed" : "completed"
    tasks = [{ "id" => "task_1672_write", "status" => status,
               "completed_at" => "2026-09-16T19:00:00Z" }]
    { "result" => { "runId" => "run_1", "tasks" => tasks } }
  end

  def worktree_state(git)
    { "git -C /w/orca-1672-lane rev-list --count origin/main..HEAD" => git ? "1\n" : "0\n",
      "git -C /w/orca-1672-lane log -1 --format=%cI" => "2026-09-16T17:00:00+00:00\n",
      "git -C /w/orca-1672-lane status --porcelain" => "" }
  end

  def mailbox
    { "result" => { "messages" => [{ "type" => "worker_done",
                                     "payload" => JSON.generate({ "taskId" => "task_1672_write" }) }] } }
  end

  def worktree(root, git)
    return "" unless git

    "worktree /w/orca-1672-lane\nHEAD #{HEAD}\nbranch refs/heads/lifeodyssey/orca-1672-lane\n\n"
  end
end
