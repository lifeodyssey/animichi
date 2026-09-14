# SUT: the scanner pins and the default-rule inventory that
# test/repo-config/gitleaks.test.rb binds to each other.
# Each probe copies the contract and its inputs into a throwaway tree, mutates
# the copy, and runs the copied contract; the committed files are never written.
require "minitest/autorun"
require "fileutils"
require "open3"
require "tmpdir"

class GitleaksPinMutationTest < Minitest::Test
  ROOT = File.expand_path("../..", __dir__)
  CONTRACT = "test/repo-config/gitleaks.test.rb"
  COPIES = [CONTRACT, "test/repo-config/gitleaks_release.rb", "test/repo-config/gitleaks_toml.rb",
            ".gitleaks.toml", ".pre-commit-config.yaml", ".github/workflows/pr-verification.yml"].freeze
  DRIFTED = "bound to the pinned gitleaks version"
  TRUNCATED = "the inventory must be the pinned release's rule IDs"

  def write_copy(root, relative, source)
    path = File.join(root, relative)
    FileUtils.mkdir_p(File.dirname(path))
    File.write(path, source)
  end

  def copy_into(root, relative)
    write_copy(root, relative, File.read(File.join(ROOT, relative)))
  end

  def reject_tree(root, label, consequence)
    out, err, status = Open3.capture3({ "TEST_REPOSITORY_ROOT" => root }, RbConfig.ruby,
                                      File.join(root, CONTRACT))
    refute status.success?, "mutation survived: #{label}"
    assert_includes out + err, consequence, "mutation must name its consequence: #{label}"
  end

  def mutate_tree(relative, needle, replacement, label, consequence)
    Dir.mktmpdir("gitleaks-pin-mutation-") do |root|
      COPIES.each { |file| copy_into(root, file) }
      rewrite(root, relative, needle, replacement, label)
      reject_tree(root, label, consequence)
    end
  end

  def rewrite(root, relative, needle, replacement, label)
    path = File.join(root, relative)
    source = File.read(path)
    changed = source.sub(needle, replacement)
    refute_equal source, changed, "mutation needle missing: #{label}"
    File.write(path, changed)
  end

  def test_rejects_a_ci_pin_that_drifted_from_the_inventory
    mutate_tree(".github/workflows/pr-verification.yml", /GITLEAKS_VERSION: "[^"]*"/,
                %(GITLEAKS_VERSION: "9.9.9"),
                "CI gitleaks version bumped without re-deriving the inventory", DRIFTED)
  end

  def test_rejects_a_pre_commit_pin_that_drifted_from_the_inventory
    mutate_tree(".pre-commit-config.yaml", /(gitleaks\n\s*rev: v)[\d.]+/, '\19.9.9',
                "pre-commit gitleaks rev bumped without re-deriving the inventory", DRIFTED)
  end

  def test_rejects_an_inventory_that_upgraded_without_moving_the_pins
    mutate_tree("test/repo-config/gitleaks_release.rb", /"8\.30\.1"/, %("8.99.0"),
                "inventoried version bumped without moving the scanner pins", DRIFTED)
  end

  def test_rejects_a_truncated_default_rule_inventory
    mutate_tree("test/repo-config/gitleaks_release.rb", / github-pat\n/, "\n",
                "one default rule dropped from the inventory", TRUNCATED)
  end
end
