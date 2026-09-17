# frozen_string_literal: true

require "json"
require "minitest/autorun"
require "tmpdir"
require "fileutils"
require_relative "../card_reconcile"
require_relative "fake_verdicts"

# The domain records a snapshot is built from, and the files a lane directory holds: lanes, phases,
# worktrees, pull requests, verdicts and holds, dated against one fixed clock.
module ReconcileFixtures
  NOW = Time.utc(2026, 9, 16, 20, 0, 0).freeze
  SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4".freeze
  LATER = "b1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4".freeze

  module_function

  def phase(card, name: "write", task_id: nil, alive: false, exited_at: NOW - 3600,
            launched_at: NOW - 7200, workspace: nil)
    Orca::CardReconcile::Phase.new("/private/tmp/animichi-lane-#{card}/#{name}", name,
                                   task_id || "task_#{card}", workspace || "/w/orca-#{card}-lane",
                                   "pi", "run_1", "term_coordinator", launched_at, exited_at, alive)
  end

  def lane(card, phases)
    Orca::CardReconcile::Lane.new(card, ["/private/tmp/animichi-lane-#{card}"], phases)
  end

  def worktree(card, branch: nil, head: SHA, ahead: 1, dirty: 0, head_at: NOW - 1800,
               newest_change_at: nil, path: nil, pushed_covers: nil)
    Orca::CardReconcile::Worktree.new(path || "/w/orca-#{card}-lane",
                                      branch || "lifeodyssey/orca-#{card}-lane", head, head_at,
                                      ahead, dirty, newest_change_at, pushed_covers)
  end

  def pull(number, head_ref:, head_sha: SHA, merge_state: "CLEAN", checks: nil, threads: 0,
           files: [], state: "OPEN", updated_at: NOW - 600, base_ref: "main")
    Orca::CardReconcile::PullRequest.new(number, state, merge_state, head_sha, head_ref,
                                         base_ref, checks || checks_of(0, 0, 0), threads, files,
                                         false, updated_at)
  end

  def checks_of(passed, failed, pending)
    Orca::CardReconcile::Checks.new(passed, failed, pending)
  end

  def verdict(card, sha: SHA, kind: :approved, written_at: NOW - 600, name: "review-round-1.md")
    Orca::CardReconcile::Verdict.new("/private/tmp/animichi-lane-#{card}/#{name}", sha, kind,
                                     written_at)
  end

  def hold(card, predicate: "pr_merged", target: 1607, satisfied: false, since: NOW - 900)
    Orca::CardReconcile::Hold.new(card, predicate, target, since, satisfied, nil)
  end

  def write_json(path, content)
    FileUtils.mkdir_p(File.dirname(path))
    File.write(path, JSON.generate(content))
    path
  end

  def write_text(path, content)
    FileUtils.mkdir_p(File.dirname(path))
    File.write(path, content)
    path
  end
end
