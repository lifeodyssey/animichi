# SUT: test/repo-config/pnpm-workspace-settings.test.rb and the settings surface
# it pins. Every probe copies the contract and the files it reads into a
# throwaway tree, mutates the copy, and runs the copied contract; the committed
# files are never written to.
require "minitest/autorun"
require "fileutils"
require "json"
require "open3"
require "psych"
require "tmpdir"

class PnpmWorkspaceSettingsMutationTest < Minitest::Test
  ROOT = File.expand_path("../..", __dir__)
  CONTRACT = "test/repo-config/pnpm-workspace-settings.test.rb"
  MANIFEST = "pnpm-workspace.yaml"
  NESTED_MANIFEST = "infra/database-access/pnpm-workspace.yaml"
  STALE_NPMRC = "reads only auth and registry settings from .npmrc"
  DATA_FIELD = "removed the `pnpm` field from package.json"
  KEBAB = "loads only camelCase settings"
  UNCATALOGUED = "declared by two or more importers"
  UNRESOLVED = "must name a dependency that catalog defines"

  def importer_paths
    workspace = Psych.safe_load(File.read(File.join(ROOT, MANIFEST)))
    members = workspace.fetch("packages").flat_map { |glob| Dir.glob(File.join(ROOT, glob, "package.json")) }
    (["package.json"] + members).map { |path| path.delete_prefix("#{ROOT}/") }.sort
  end

  def with_tree
    Dir.mktmpdir("pnpm-settings-mutation-") do |root|
      ([CONTRACT, MANIFEST, NESTED_MANIFEST] + importer_paths).each do |relative|
        FileUtils.mkdir_p(File.join(root, File.dirname(relative)))
        FileUtils.cp(File.join(ROOT, relative), File.join(root, relative))
      end
      yield root
    end
  end

  def write(root, relative, content)
    path = File.join(root, relative)
    FileUtils.mkdir_p(File.dirname(path))
    File.write(path, content)
  end

  def rewrite_json(root, relative, &block)
    manifest = JSON.parse(File.read(File.join(root, relative)))
    write(root, relative, "#{JSON.pretty_generate(block.call(manifest))}\n")
  end

  def rewrite(root, relative, needle, replacement, label)
    path = File.join(root, relative)
    source = File.read(path)
    changed = source.sub(needle, replacement)
    refute_equal source, changed, "mutation needle missing: #{label}"
    write(root, relative, changed)
  end

  # A key pnpm cannot find is one pnpm answers with its own default, so the
  # mutation is the whole declaration's removal, not a value swap. `assert` on
  # the key first: a needle that has already vanished would make the probe a
  # no-op whose "mutation survived" is a lie.
  def reject_deleted_setting(relative, key, consequence)
    with_tree do |root|
      document = Psych.safe_load(File.read(File.join(root, relative)))
      assert document.key?(key), "mutation needle missing: #{key} in #{relative}"
      write(root, relative, Psych.dump(document.tap { |manifest| manifest.delete(key) }))
      reject_tree(root, "#{key} deleted from #{relative}", consequence)
    end
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
    with_tree { |root| accept_tree(root, "committed configuration") }
  end

  def test_rejects_a_setting_left_in_npmrc
    with_tree do |root|
      write(root, ".npmrc", "shamefully-hoist=true\n")
      reject_tree(root, "shamefully-hoist back in .npmrc", STALE_NPMRC)
    end
  end

  def test_rejects_a_retired_pnpm_field
    with_tree do |root|
      rewrite_json(root, "packages/agent/package.json") { |m| m.merge("pnpm" => { "overrides" => { "ws" => ">=8.21.0" } }) }
      reject_tree(root, "a package.json `pnpm` field", DATA_FIELD)
    end
  end

  def test_rejects_a_kebab_case_workspace_setting
    with_tree do |root|
      rewrite(root, MANIFEST, "nodeLinker: hoisted", "node-linker: hoisted", "kebab-case nodeLinker")
      reject_tree(root, "node-linker in pnpm-workspace.yaml", KEBAB)
    end
  end

  def test_rejects_a_raw_specifier_for_a_catalogued_dependency
    with_tree do |root|
      rewrite_json(root, "packages/test-postgres/package.json") do |manifest|
        manifest["devDependencies"] = manifest.fetch("devDependencies").merge("zod" => "4.6.5")
        manifest
      end
      reject_tree(root, "a bare zod specifier beside the catalog", UNCATALOGUED)
    end
  end

  def test_rejects_a_catalog_reference_with_no_entry
    with_tree do |root|
      path = File.join(root, MANIFEST)
      workspace = Psych.safe_load(File.read(path))
      workspace.fetch("catalog").delete("zod")
      File.write(path, Psych.dump(workspace))
      reject_tree(root, "a cataloged reference whose entry was deleted", UNRESOLVED)
    end
  end

  # The settings the pnpm 12 move wrote into a manifest. Each one used to have a
  # home pnpm still reads — `.npmrc` or `package.json#pnpm` — and deleting the key
  # is what a "clean up the config" change does; every probe below has to go red
  # and name the key, or the guard would be green with its subject gone.
  def test_rejects_a_deleted_node_linker
    reject_deleted_setting(MANIFEST, "nodeLinker", "nodeLinker is missing")
  end

  def test_rejects_a_deleted_shamefully_hoist
    reject_deleted_setting(MANIFEST, "shamefullyHoist", "shamefullyHoist is missing")
  end

  def test_rejects_a_deleted_catalog_mode
    reject_deleted_setting(MANIFEST, "catalogMode", "catalogMode is missing")
  end

  def test_rejects_deleted_overrides
    reject_deleted_setting(MANIFEST, "overrides", "pnpm-workspace.yaml: overrides is missing")
  end

  def test_rejects_deleted_patched_dependencies
    reject_deleted_setting(MANIFEST, "patchedDependencies", "pnpm-workspace.yaml: patchedDependencies is missing")
  end

  def test_rejects_deleted_overrides_in_the_nested_workspace
    reject_deleted_setting(NESTED_MANIFEST, "overrides", "#{NESTED_MANIFEST}: overrides is missing")
  end
end
