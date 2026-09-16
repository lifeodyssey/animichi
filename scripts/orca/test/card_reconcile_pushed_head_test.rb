# frozen_string_literal: true

require_relative "card_reconcile_git_history"

# How a worktree's head relates to the head an open pull request published: the pushed head covers it
# (an update-branch merge commit), sits beside it (the branch was rewritten), or says nothing.
class PushedHeadTest < Minitest::Test
  include GitFixture
  include GitHistory

  def test_a_pushed_head_above_the_local_head_covers_it
    with_repo do |repo|
      pushed = ahead_commit(repo)
      reset_to(repo, "HEAD~1")
      assert_equal true, tree_of(repo, "main" => pushed).pushed_covers
    end
  end

  def test_a_pushed_head_beside_the_local_head_does_not_cover_it
    with_repo do |repo|
      pushed = ahead_commit(repo)
      reset_to(repo, "HEAD~1")
      ahead_commit(repo, "rewritten")
      assert_equal false, tree_of(repo, "main" => pushed).pushed_covers
    end
  end

  def test_an_unreadable_pushed_head_leaves_the_coverage_unknown_and_noted
    with_repo do |repo|
      assert_nil tree_of(repo, "main" => "0" * 40).pushed_covers
      assert_equal 1, notes.length
      assert_match(/git merge-base --is-ancestor failed/, notes.first)
    end
  end

  def test_no_pushed_head_leaves_the_coverage_unknown
    with_repo { |repo| assert_nil tree_of(repo, {}).pushed_covers }
  end

  private

  def notes
    @notes ||= []
  end

  def tree_of(repo, pushed_heads)
    facts = Orca::CardReconcile::GitFacts.new(GitFixture.command, repo, notes)
    facts.worktrees(pushed_heads).find { |item| item.path == repo }
  end

  def ahead_commit(repo, name = "second")
    commit(repo, name)
    head_of(repo, "HEAD")
  end
end
