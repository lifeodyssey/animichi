# frozen_string_literal: true

require_relative "card_reconcile_git_history"

# The worktree listing and the pushed heads a card's ancestry is read from.
class GitFactsTest < Minitest::Test
  include GitFixture
  include GitHistory

  def test_reports_the_branch_and_commits_ahead_of_origin_main
    with_repo do |repo|
      assert_equal "main", reloaded(repo).branch
      assert_equal 0, reloaded(repo).ahead
      commit(repo, "second")
      assert_equal 1, reloaded(repo).ahead
    end
  end

  def test_dates_the_head_commit
    with_repo { |repo| assert_equal Time.utc(2026, 9, 16, 12), reloaded(repo).head_at }
  end

  def test_counts_uncommitted_paths_in_the_listing
    with_repo do |repo|
      write(File.join(repo, "untracked.txt"), "x\n")
      assert_equal 1, reloaded(repo).dirty
    end
  end

  def test_remote_heads_indexes_each_pushed_branch
    with_repo do |repo, origin|
      heads = Orca::CardReconcile::GitFacts.new(GitFixture.command, repo, notes).remote_heads
      assert_equal [head_of(repo, "main")], heads.values
      assert_equal 1, heads.keys.length
      assert_equal true, origin.end_with?("origin.git")
    end
  end

  def test_failures_are_noted_and_the_listing_is_unknown_not_empty
    notes = []
    facts = Orca::CardReconcile::GitFacts.new(GitFixture.command, "/nonexistent-repo", notes)
    assert_nil facts.worktrees
    assert_equal 1, notes.length
  end

  private

  def notes
    @notes ||= []
  end

  def reloaded(repo)
    Orca::CardReconcile::GitFacts.new(GitFixture.command, repo, [])
                             .worktrees
                             .find { |item| item.path == repo }
  end
end
