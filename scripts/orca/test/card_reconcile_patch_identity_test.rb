# frozen_string_literal: true

require_relative "card_reconcile_git_history"

# Verdict freshness by patch identity: a rebase that leaves the same patches keeps the verdict, and
# everything else — new content, a merge commit, a missing object, a failed git read — drops it.
class PatchIdentityTest < Minitest::Test
  include GitFixture
  include GitHistory

  def test_a_rebase_only_restack_keeps_the_verdict_fresh
    with_repo do |repo|
      reviewed = restacked_patch(repo)
      assert_equal true, identity_of(repo, []).fresh?(reviewed, head_of(repo, "topic"), "main")
    end
  end

  def test_an_added_commit_drops_the_verdict
    with_repo do |repo|
      reviewed = restacked_patch(repo)
      commit(repo, "added")
      assert_equal false, identity_of(repo, []).fresh?(reviewed, head_of(repo, "topic"), "main")
    end
  end

  def test_a_merge_commit_in_the_range_drops_the_verdict
    with_repo do |repo|
      reviewed = restacked_patch(repo)
      head = merge_main_into_topic(repo)
      assert_equal false, identity_of(repo, []).fresh?(reviewed, head, "main")
    end
  end

  def test_a_missing_verdict_object_is_not_fresh
    with_repo do |repo|
      reviewed = restacked_patch(repo)
      assert_equal false, identity_of(repo, []).fresh?("0" * 40, head_of(repo, "topic"), "main")
    end
  end

  # The reviewed commit is already carried by the base, so `git cherry` marks it `-` on both sides
  # and neither side has a patch. An empty list is not identity: a merged commit's verdict does not
  # keep holding for it.
  def test_a_verdict_the_base_already_carries_is_not_fresh
    with_repo do |repo|
      reviewed = merged_patch(repo)
      assert_equal false, identity_of(repo, []).fresh?(reviewed, reviewed, "main")
    end
  end

  def test_a_failed_git_read_is_not_fresh_and_is_noted
    with_repo do |repo|
      reviewed = restacked_patch(repo)
      notes = []
      identity = identity_of(repo, notes)
      assert_equal false, identity.fresh?(reviewed, head_of(repo, "topic"), "no-such-base")
      assert_equal 1, notes.length
      assert_match(/git rev-list --merges failed/, notes.first)
    end
  end

  private

  def identity_of(repo, notes)
    Orca::CardReconcile::PatchIdentity.new(Orca::CardReconcile::GitFacts.new(GitFixture.command, repo, notes))
  end
end
