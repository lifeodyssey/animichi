# frozen_string_literal: true

require_relative "card_reconcile_shape_2026_snapshot"
require_relative "card_reconcile_snapshot_fixtures"

# A worktree belongs to the card its branch names, however the directory drifted: the row follows the
# branch, not the directory name.
class Shape2026WorktreeTest < Minitest::Test
  include Shape2026Snapshot

  def test_a_worktree_row_follows_its_branch_card
    rows = Shape2026Snapshot.rows
    assert_match(/15d2478/, row_for(rows, 1715).facts)
    assert_match(/8336021/, row_for(rows, 1702).facts)
    assert_match(/ff94edc/, row_for(rows, 1718).facts)
  end
end
