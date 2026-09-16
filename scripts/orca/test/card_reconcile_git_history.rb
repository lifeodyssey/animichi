# frozen_string_literal: true

require_relative "card_reconcile_git_fixture"

# Moves the branches of a `GitFixture` repository: commits, checkouts, rebases and merges. A commit
# adds one file, so every commit in a fixture is a distinct patch.
module GitHistory
  module_function

  def commit(repo, name)
    GitFixture.write(File.join(repo, "#{name}.txt"), "#{name}\n")
    GitFixture.git("-C", repo, "add", "-A")
    GitFixture.dated_commit(repo, name)
    head_of(repo, "HEAD")
  end

  def head_of(repo, revision)
    GitFixture.git("-C", repo, "rev-parse", revision).strip
  end

  def branch(repo, name)
    GitFixture.git("-C", repo, "checkout", "-q", "-b", name)
  end

  def checkout(repo, ref)
    GitFixture.git("-C", repo, "checkout", "-q", ref)
  end

  def rebase(repo, onto)
    GitFixture.git("-C", repo, "rebase", "--quiet", onto)
  end

  def merge(repo, ref)
    GitFixture.git("-C", repo, "merge", "--quiet", "--no-edit", "--no-ff", ref)
  end

  def reset_to(repo, revision)
    GitFixture.git("-C", repo, "reset", "--hard", "--quiet", revision)
  end

  # A reviewed commit on `topic` whose patch is replayed onto a moved `main`: same patch, new SHA.
  def restacked_patch(repo)
    branch(repo, "topic")
    reviewed = commit(repo, "patch")
    checkout(repo, "main")
    commit(repo, "base")
    checkout(repo, "topic")
    rebase(repo, "main")
    reviewed
  end

  # `topic` with main's later commit merged into it: the reviewed range now carries a merge commit.
  def merge_main_into_topic(repo)
    checkout(repo, "main")
    commit(repo, "later")
    checkout(repo, "topic")
    merge(repo, "main")
    head_of(repo, "HEAD")
  end

  # A reviewed commit main has since merged: `git cherry` marks it `-` on both sides.
  def merged_patch(repo)
    branch(repo, "topic")
    reviewed = commit(repo, "patch")
    checkout(repo, "main")
    merge(repo, "topic")
    reviewed
  end
end
