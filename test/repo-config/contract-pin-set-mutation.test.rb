# SUT: test/repo-config/contract-pin-set.test.rb. Every probe copies the pin and the two files it
# reads into a throwaway tree, mutates the copy, and runs the copied contract; the committed files
# are never written to.
#
# The mutations insert a stale/orphaned version rather than swapping one literal for another, so a
# refresh of the pin set does not leave these needles pointing at text that no longer exists.
require "minitest/autorun"
require "fileutils"
require "open3"
require "tmpdir"

class ContractPinSetMutationTest < Minitest::Test
  ROOT = File.expand_path("../..", __dir__)
  CONTRACT = "test/repo-config/contract-pin-set.test.rb"
  GUIDE = "packages/contract/AGENTS.md"
  MANIFEST = "pnpm-workspace.yaml"
  STALE_ZOD = "states zod 0.0.0"
  STALE_ORPC = "states @orpc/* 0.0.0"
  SPLIT_VERSIONS = "holds 2 @orpc/* versions"
  DELETED_CLAIM = "no longer states"

  def with_tree
    Dir.mktmpdir("contract-pin-set-mutation-") do |root|
      [CONTRACT, GUIDE, MANIFEST].each do |relative|
        FileUtils.mkdir_p(File.join(root, File.dirname(relative)))
        FileUtils.cp(File.join(ROOT, relative), File.join(root, relative))
      end
      yield root
    end
  end

  def rewrite(root, relative, needle, replacement)
    path = File.join(root, relative)
    source = File.read(path)
    changed = source.sub(needle, replacement)
    refute_equal source, changed, "mutation needle missing: #{needle}"
    File.write(path, changed)
  end

  def reject_tree(root, label, consequence)
    out, err, status = Open3.capture3({ "TEST_REPOSITORY_ROOT" => root }, RbConfig.ruby, File.join(root, CONTRACT))
    refute status.success?, "mutation survived: #{label}"
    assert_includes out + err, consequence, "mutation must name its consequence: #{label}"
  end

  def accept_tree(root, label)
    out, err, status = Open3.capture3({ "TEST_REPOSITORY_ROOT" => root }, RbConfig.ruby, File.join(root, CONTRACT))
    assert status.success?, "an unmutated copy must pass: #{label}\n#{out}#{err}"
  end

  def test_accepts_an_unmutated_copy
    with_tree { |root| accept_tree(root, "committed guide and catalog") }
  end

  def test_rejects_a_guide_zod_version_the_catalog_does_not_hold
    with_tree do |root|
      rewrite(root, GUIDE, "`zod@", "`zod@0.0.0` (`zod@")
      reject_tree(root, "zod version drifted from the catalog", STALE_ZOD)
    end
  end

  def test_rejects_a_guide_orpc_version_the_catalog_does_not_hold
    with_tree do |root|
      rewrite(root, GUIDE, "`@orpc/*@", "`@orpc/*@0.0.0` (`@orpc/*@")
      reject_tree(root, "@orpc/* version drifted from the catalog", STALE_ORPC)
    end
  end

  def test_rejects_a_catalog_that_no_longer_holds_one_orpc_version
    with_tree do |root|
      rewrite(root, MANIFEST, %(  "@orpc/server":), %(  "@orpc/decoy": "0.0.1"\n  "@orpc/server":))
      reject_tree(root, "a second @orpc/* version in the catalog", SPLIT_VERSIONS)
    end
  end

  def test_rejects_a_deleted_claim
    with_tree do |root|
      rewrite(root, GUIDE, "`zod@", "zod ")
      reject_tree(root, "the zod claim deleted from the guide", DELETED_CLAIM)
    end
  end
end
