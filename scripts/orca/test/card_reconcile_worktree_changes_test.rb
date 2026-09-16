# frozen_string_literal: true

require_relative "card_reconcile_fixtures"

# The uncommitted changes of one worktree: how many paths differ and when the newest of them was
# written, as read from the porcelain text `git status --porcelain` returns.
class WorktreeChangesTest < Minitest::Test
  def test_counts_the_paths_and_dates_the_newest_file
    Dir.mktmpdir do |root|
      write(root, "untracked.txt")
      write(root, "sub/dir/modified.txt")
      changed = Time.utc(2026, 9, 16, 18)
      File.utime(changed, changed, File.join(root, "untracked.txt"))
      changes = Orca::CardReconcile::WorktreeChanges.new(root, "?? untracked.txt\n M sub/dir/modified.txt\n")
      assert_equal 2, changes.count
      assert_equal changed, changes.newest_change_at
    end
  end

  def test_a_rename_counts_the_path_that_is_on_disk
    Dir.mktmpdir do |root|
      path = write(root, "new.txt")
      changes = Orca::CardReconcile::WorktreeChanges.new(root, "R  old.txt -> new.txt\n")
      assert_equal 1, changes.count
      assert_equal File.mtime(path), changes.newest_change_at
    end
  end

  def test_a_path_that_has_disappeared_is_counted_but_not_dated
    Dir.mktmpdir do |root|
      changes = Orca::CardReconcile::WorktreeChanges.new(root, "?? gone.txt\n")
      assert_equal 1, changes.count
      assert_nil changes.newest_change_at
    end
  end

  private

  def write(root, name)
    path = File.join(root, name)
    FileUtils.mkdir_p(File.dirname(path))
    File.write(path, "x\n")
    path
  end
end
