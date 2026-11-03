# SUT: test/repo-config/node-version-source.test.rb. Every probe copies the contract and
# the files it reads into a throwaway tree, mutates the copy, and runs the copied
# contract; the committed files are never written to.
require "fileutils"
require "json"
require "minitest/autorun"
require "open3"
require "psych"
require "tmpdir"

class NodeVersionSourceMutationTest < Minitest::Test
  ROOT = File.expand_path("../..", __dir__)
  CONTRACT = "test/repo-config/node-version-source.test.rb"
  NVMRC = ".nvmrc"
  MANIFEST = "package.json"
  WORKSPACE = "pnpm-workspace.yaml"
  PR_WORKFLOW = ".github/workflows/pr-verification.yml"
  SETUP_ACTION = ".github/actions/setup-workspace/action.yml"
  LITERAL = "pins a `node-version` literal"
  READS = "must set `node-version-file: .nvmrc`"
  ENGINES = "engines.node is"
  TYPES = "@types/node describes the runtime's API surface"

  def importer_paths
    workspace = Psych.safe_load(File.read(File.join(ROOT, WORKSPACE)))
    members = workspace.fetch("packages").flat_map { |glob| Dir.glob(File.join(ROOT, glob, "package.json")) }
    (["package.json"] + members.map { |path| path.delete_prefix("#{ROOT}/") } + ["infra/database-access/package.json"])
      .select { |path| File.file?(File.join(ROOT, path)) }.sort.uniq
  end

  def files
    ([CONTRACT, NVMRC, MANIFEST, WORKSPACE] +
      Dir.glob(".github/workflows/*.yml", base: ROOT) +
      Dir.glob(".github/actions/**/action.yml", base: ROOT) +
      importer_paths).sort.uniq
  end

  def with_tree
    Dir.mktmpdir("node-version-source-mutation-") do |root|
      files.each do |relative|
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

  def rewrite(root, relative, needle, replacement, label)
    source = File.read(File.join(root, relative))
    changed = source.sub(needle, replacement)
    refute_equal source, changed, "mutation needle missing: #{label}"
    write(root, relative, changed)
  end

  def rewrite_json(root, relative)
    manifest = JSON.parse(File.read(File.join(root, relative)))
    write(root, relative, "#{JSON.pretty_generate(yield(manifest))}\n")
  end

  def run_contract(root)
    out, err, status = Open3.capture3({ "TEST_REPOSITORY_ROOT" => root }, RbConfig.ruby, File.join(root, CONTRACT))
    [status, out + err]
  end

  def reject_tree(root, label, *consequences)
    status, output = run_contract(root)
    refute status.success?, "mutation survived: #{label}"
    consequences.each do |consequence|
      assert_includes output, consequence, "mutation must name its consequence: #{label}"
    end
  end

  def test_accepts_an_unmutated_copy
    with_tree do |root|
      status, output = run_contract(root)
      assert status.success?, "an unmutated copy must pass\n#{output}"
    end
  end

  # The exact hazard the acceptance criterion names: one workflow reintroduces
  # `node-version: "24"` and the contract must fail naming that file.
  def test_rejects_a_node_version_literal_in_a_workflow
    with_tree do |root|
      rewrite(root, PR_WORKFLOW, "node-version-file: .nvmrc", 'node-version: "24"', "pr-verification literal")
      reject_tree(root, "a literal in pr-verification.yml", PR_WORKFLOW, LITERAL, READS)
    end
  end

  def test_rejects_a_node_version_literal_in_a_composite_action
    with_tree do |root|
      rewrite(root, SETUP_ACTION, "node-version-file: .nvmrc", 'node-version: "24"', "setup-workspace literal")
      reject_tree(root, "a literal in setup-workspace", SETUP_ACTION, LITERAL, READS)
    end
  end

  def test_rejects_an_engines_floor_behind_the_runtime
    with_tree do |root|
      rewrite_json(root, MANIFEST) { |manifest| manifest.merge("engines" => { "node" => ">=24" }) }
      reject_tree(root, "an engines floor behind the runtime", ENGINES)
    end
  end

  def test_rejects_a_types_node_major_behind_the_runtime
    with_tree do |root|
      rewrite(root, WORKSPACE, '"@types/node": ^26.6.1', '"@types/node": ^24.0.0', "catalog @types/node")
      reject_tree(root, "a catalog @types/node behind the runtime", TYPES, MANIFEST)
    end
  end

  def test_rejects_a_runtime_behind_the_types
    with_tree do |root|
      write(root, NVMRC, "24\n")
      reject_tree(root, "a runtime behind the types", ENGINES, TYPES)
    end
  end
end
