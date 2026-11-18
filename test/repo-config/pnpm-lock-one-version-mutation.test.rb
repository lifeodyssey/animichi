# SUT: test/repo-config/pnpm-lock-one-version.test.rb. Every probe copies the contract and the root
# lockfile into a throwaway tree, mutates the copy, and runs the copied contract; the committed
# lockfile is never written to.
#
# The needles find a package's key by its name, never by its version, so a lockfile refresh does
# not leave them pointing at text that no longer exists. The first key a needle finds is the one
# under `packages`, which pnpm writes before `snapshots`.
require "minitest/autorun"
require "fileutils"
require "open3"
require "tmpdir"

class PnpmLockOneVersionMutationTest < Minitest::Test
  ROOT = File.expand_path("../..", __dir__)
  CONTRACT = "test/repo-config/pnpm-lock-one-version.test.rb"
  LOCKFILE = "pnpm-lock.yaml"
  ROUTER_CORE_KEY = %r{^  '@tanstack/router-core@}

  def with_tree
    Dir.mktmpdir("pnpm-lock-one-version-mutation-") do |root|
      [CONTRACT, LOCKFILE].each do |relative|
        FileUtils.mkdir_p(File.join(root, File.dirname(relative)))
        FileUtils.cp(File.join(ROOT, relative), File.join(root, relative))
      end
      yield root
    end
  end

  def rewrite(root, needle, replacement)
    path = File.join(root, LOCKFILE)
    source = File.read(path)
    changed = source.sub(needle, replacement)
    refute_equal source, changed, "mutation needle missing: #{needle.inspect}"
    File.write(path, changed)
  end

  # A `packages` entry of its own, written just above the first key the needle finds.
  def insert_package(root, needle, key)
    rewrite(root, needle, "  '#{key}':\n    resolution: {integrity: sha512-decoy}\n\n\\0")
  end

  def reject_tree(root, label, consequence)
    out, err, status = Open3.capture3({ "TEST_REPOSITORY_ROOT" => root }, RbConfig.ruby, File.join(root, CONTRACT))
    refute status.success?, "mutation survived: #{label}"
    assert_includes out + err, consequence, "mutation must name its consequence: #{label}"
  end

  def accept_tree(root, label)
    out, err, status = Open3.capture3({ "TEST_REPOSITORY_ROOT" => root }, RbConfig.ruby, File.join(root, CONTRACT))
    assert status.success?, "a lockfile the contract must accept was rejected: #{label}\n#{out}#{err}"
  end

  def test_accepts_an_unmutated_copy
    with_tree { |root| accept_tree(root, "the committed lockfile") }
  end

  def test_rejects_a_second_router_core_version
    with_tree do |root|
      insert_package(root, ROUTER_CORE_KEY, "@tanstack/router-core@0.0.0")
      reject_tree(root, "a second @tanstack/router-core", "resolves 2 versions of @tanstack/router-core")
    end
  end

  def test_rejects_a_lockfile_that_resolves_no_router_core
    with_tree do |root|
      rewrite(root, ROUTER_CORE_KEY, "  '@tanstack/router-core-gone@")
      reject_tree(root, "no @tanstack/router-core at all", "resolves 0 versions of @tanstack/router-core")
    end
  end

  def test_does_not_count_a_package_whose_name_only_starts_the_same
    with_tree do |root|
      insert_package(root, ROUTER_CORE_KEY, "@tanstack/router-core-devtools@0.0.0")
      accept_tree(root, "@tanstack/router-core-devtools is another package")
    end
  end

  def test_does_not_count_a_snapshot_as_a_version
    with_tree do |root|
      File.write(File.join(root, LOCKFILE), "  '@tanstack/router-core@0.0.0(decoy@0.0.0)': {}\n", mode: "a")
      accept_tree(root, "a `snapshots` key is a peer set, not a resolved version")
    end
  end
end
