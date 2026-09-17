# frozen_string_literal: true

# What Orca, GitHub, git and `ps` reported on 2026-09-16 for the lane shape `Shape2026` builds.
# `ScriptedShell` answers from these responses, so a test can collect the shape offline.

require_relative "card_reconcile_shape_2026"

module Shape2026Responses
  module_function

  def responses(root, heads)
    heads.each_with_object(base_responses(root, heads)) do |(card, _), result|
      result.merge!(worktree_responses(root, card))
    end
  end

  def base_responses(root, heads)
    git_responses(root, heads).merge(project_responses)
  end

  def git_responses(root, heads)
    { "ps -eo command=" => runner_lines(root),
      "git -C #{root} ls-remote --heads origin" => "",
      "git -C #{root} worktree list --porcelain" => porcelain(root, heads),
      "git -C #{root} cat-file -e" => missing_object }
  end

  # The fixture's heads are not objects in the temporary tree, which is not a repository at all:
  # every patch-identity read fails, so no verdict survives by patch identity.
  def missing_object
    Orca::CardReconcile::Command::Result.new("", "fatal: not a git repository", 128)
  end

  def project_responses
    { "gh pr list --repo lifeodyssey/animichi --state merged" => "[]",
      "gh pr list --repo lifeodyssey/animichi --state open" => JSON.generate(open_pull_requests),
      "gh api graphql" => JSON.generate(threads),
      "orca orchestration task-list" => JSON.generate(task_list),
      "orca orchestration check" => JSON.generate(mailbox),
      "orca orchestration inbox" => JSON.generate(mailbox) }
  end

  def worktree_responses(root, card)
    name = Shape2026::WORKTREES.dig(card, 0)
    count, date = history(card)
    { "git -C #{root}/w/#{name} rev-list --count origin/main..HEAD" => "#{count}\n",
      "git -C #{root}/w/#{name} log -1 --format=%cI" => "#{date}\n",
      "git -C #{root}/w/#{name} status --porcelain" => "" }
  end

  def history(card)
    { 1672 => [13, "2026-09-16T19:01:00+00:00"], 1601 => [2, "2026-09-16T19:30:00+00:00"],
      1715 => [1, "2026-09-16T19:00:00+00:00"], 1702 => [3, "2026-09-16T19:45:00+00:00"],
      1718 => [1, "2026-09-16T19:15:00+00:00"] }[card]
  end

  def porcelain(root, heads)
    Shape2026::WORKTREES.map { |card, (name, branch)| block(root, name, heads[card], branch) }
                        .join("\n") + "\n"
  end

  def block(root, name, head, branch)
    "worktree #{root}/w/#{name}\nHEAD #{head}\nbranch refs/heads/#{branch}\n"
  end

  # The task list is the settlement fact; the mailbox corroborates the same tasks.
  def task_list
    { "result" => { "runId" => Shape2026::RUN, "tasks" => completed_tasks + open_tasks } }
  end

  def completed_tasks
    settled_tasks.map { |task| task.merge("status" => "completed", "completed_at" => completed_at) }
  end

  def open_tasks
    (Shape2026::DEAD.map { |card| [card, "write"] } + unsettled_phases)
      .map { |card, phase| { "id" => Shape2026.task_id(card, phase), "status" => "ready" } }
  end

  def unsettled_phases
    [[Shape2026::UNRECORDED, "pi-attempt"], [Shape2026::READY, "pi-attempt"]]
  end

  def settled_tasks
    settled_lanes.map { |card, phase| { "id" => Shape2026.task_id(card, phase) } }
  end

  def completed_at
    Shape2026.stamp(19, 30)
  end

  def mailbox
    { "result" => { "runId" => Shape2026::RUN, "count" => settled_tasks.length,
                    "messages" => settled_tasks.map { |task| done_message(task["id"]) } } }
  end

  def done_message(task)
    { "type" => "worker_done", "created_at" => "2026-09-16T19:30:00Z",
      "payload" => JSON.generate({ "taskId" => task, "outcome" => "succeeded" }) }
  end

  def runner_lines(root)
    (Shape2026::DEAD.map { |card| [card, "write"] } + [[Shape2026::ALIVE, "write"]] + settled_lanes)
      .map { |card, phase| runner_line(root, card, phase) }.join
  end

  def settled_lanes
    Shape2026::SETTLED.flat_map { |card, phases| phases.map { |phase| [card, phase] } }
  end

  def runner_line(root, card, phase)
    "ruby runner.rb --state #{root}/animichi-lane-#{card}/#{phase} --timeout 120\n"
  end

  def threads
    { "data" => { "repository" => { "pullRequest" => { "reviewThreads" => { "nodes" => [] } } } } }
  end

  def open_pull_requests
    [{ "number" => 1711, "state" => "OPEN", "mergeStateStatus" => "CLEAN", "files" => [],
       "headRefName" => "lifeodyssey/orca-1601-ac5", "headRefOid" => Shape2026::PR_HEAD,
       "baseRefName" => "main", "updatedAt" => "2026-09-16T19:00:00Z",
       "statusCheckRollup" => [{ "status" => "COMPLETED", "conclusion" => "SUCCESS" }] }]
  end
end
