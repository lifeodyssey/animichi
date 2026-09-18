# SUT: test/repo-config/install-build-decisions.test.rb and the install decisions
# it governs. Every probe copies the contract, both workspace manifests and the
# whole `.github` tree it scans into a throwaway directory, mutates the copy, and
# runs the copied contract; the committed files are never written to.
require "minitest/autorun"
require "fileutils"
require "open3"
require "psych"
require "tmpdir"

class InstallBuildDecisionsMutationTest < Minitest::Test
  ROOT = File.expand_path("../..", __dir__)
  CONTRACT = "test/repo-config/install-build-decisions.test.rb"
  MANIFEST = "pnpm-workspace.yaml"
  NESTED_MANIFEST = "infra/database-access/pnpm-workspace.yaml"
  SEAL_INSTALL = ".github/scripts/release/seal-foundation.sh:6 runs `pnpm install --frozen-lockfile`"
  CD_INSTALL = ".github/workflows/cd.yml:81 runs `pnpm install --frozen-lockfile`"

  def with_tree
    Dir.mktmpdir("install-build-decisions-mutation-") do |root|
      [CONTRACT, MANIFEST, NESTED_MANIFEST].each do |relative|
        FileUtils.mkdir_p(File.join(root, File.dirname(relative)))
        FileUtils.cp(File.join(ROOT, relative), File.join(root, relative))
      end
      FileUtils.cp_r(File.join(ROOT, ".github"), File.join(root, ".github"))
      yield root
    end
  end

  # A key pnpm cannot find is one pnpm answers with its own default, so the
  # mutation is the whole declaration's removal. `assert` on the key first: a
  # needle that has already vanished would make the probe a no-op whose
  # "mutation survived" is a lie.
  def delete_key(root, relative, key)
    document = Psych.safe_load(File.read(File.join(root, relative)))
    assert document.key?(key), "mutation needle missing: #{key} in #{relative}"
    File.write(File.join(root, relative), Psych.dump(document.tap { |manifest| manifest.delete(key) }))
  end

  def rewrite(root, relative, needle, replacement, label)
    path = File.join(root, relative)
    source = File.read(path)
    changed = source.sub(needle, replacement)
    refute_equal source, changed, "mutation needle missing: #{label}"
    File.write(path, changed)
  end

  def reject_tree(root, label, named)
    out, err, status = Open3.capture3({ "TEST_REPOSITORY_ROOT" => root }, RbConfig.ruby, File.join(root, CONTRACT))
    refute status.success?, "mutation survived: #{label}\n#{out}#{err}"
    assert_includes out + err, named, "mutation must name its file and install: #{label}\n#{out}#{err}"
  end

  def accept_tree(root, label)
    out, err, status = Open3.capture3({ "TEST_REPOSITORY_ROOT" => root }, RbConfig.ruby, File.join(root, CONTRACT))
    assert status.success?, "an unmutated copy must pass: #{label}\n#{out}#{err}"
  end

  def test_accepts_an_unmutated_copy
    with_tree { |root| accept_tree(root, "committed configuration") }
  end

  def test_rejects_a_root_manifest_silent_about_strict_dep_builds
    with_tree do |root|
      delete_key(root, MANIFEST, "strictDepBuilds")
      reject_tree(root, "strictDepBuilds deleted from #{MANIFEST}", "(pnpm-workspace.yaml)")
    end
  end

  def test_rejects_the_foundation_manifest_silent_about_strict_dep_builds
    with_tree do |root|
      delete_key(root, NESTED_MANIFEST, "strictDepBuilds")
      reject_tree(root, "strictDepBuilds deleted from #{NESTED_MANIFEST}", "(#{NESTED_MANIFEST})")
    end
  end

  def test_rejects_the_seal_install_when_its_manifest_declares_no_builds
    with_tree do |root|
      delete_key(root, NESTED_MANIFEST, "allowBuilds")
      reject_tree(root, "allowBuilds deleted from #{NESTED_MANIFEST}", SEAL_INSTALL)
    end
  end

  def test_rejects_a_scripts_running_install_whose_manifest_declares_no_builds
    with_tree do |root|
      delete_key(root, MANIFEST, "allowBuilds")
      rewrite(root, ".github/workflows/cd.yml",
              "pnpm install --frozen-lockfile --ignore-scripts", "pnpm install --frozen-lockfile",
              "--ignore-scripts dropped from cd.yml's workspace install")
      reject_tree(root, "--ignore-scripts dropped from cd.yml's workspace install", CD_INSTALL)
    end
  end
end
