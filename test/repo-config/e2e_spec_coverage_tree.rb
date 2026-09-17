# The throwaway tree test/repo-config/e2e-spec-coverage-mutation.test.rb drives
# the coverage contract against: a copy of everything that contract reads, plus
# the one mutation a probe asks for. Each verb here puts the tree in one #1702
# state — a spec no runnable script names, the lane naming it, a case exclusion
# with its tags gone, a spec token a command only prints — and the probe owns
# what the contract must say about that state. The committed tree is never
# written to.
require "fileutils"
require "json"
require "tmpdir"

module E2eSpecCoverageTree
  CONTRACT = File.join("test", "repo-config", "e2e-spec-coverage.test.rb").freeze
  REGISTRY = File.join("test", "repo-config", "e2e_lane_exclusions.rb").freeze
  PACKAGE = File.join("e2e", "package.json").freeze
  WORKFLOW = File.join(".github", "workflows", "pr-verification.yml").freeze
  COPIES = [CONTRACT, REGISTRY, PACKAGE, WORKFLOW].freeze
  SOURCE = File.expand_path("../..", __dir__)

  def with_spec_coverage_tree
    Dir.mktmpdir("e2e-spec-coverage-mutation-") do |root|
      copy_fixture(root)
      yield root
    end
  end

  def contract_path(root)
    File.join(root, CONTRACT)
  end

  # An on-disk spec no runnable script names.
  def write_orphan(root, spec)
    write(root, File.join("e2e", spec), %(test("x", async () => { await expect(1).toBe(1); });\n))
  end

  # The same spec named by the lane's own `playwright test` argument list.
  def add_to_lane(root, spec)
    manifest(root) do |scripts|
      scripts["test"] = scripts.fetch("test").sub("web-404.spec.ts", "web-404.spec.ts #{spec}")
    end
  end

  def restore_manifest(root)
    copy(root, PACKAGE)
  end

  # A command that prints a spec path without running Playwright.
  def append_echo(root, script, text)
    manifest(root) { |scripts| scripts[script] = "#{scripts.fetch(script)} && echo #{text}" }
  end

  # The declared case filter moved out of the Playwright invocation into prose:
  # printed, never passed, so the cases it names run in the always-run lane.
  def move_filter_to_prose(root, tag)
    manifest(root) do |scripts|
      scripts["typecheck"] = "#{scripts.fetch("typecheck")} && echo --grep-invert #{tag}"
      scripts["test"] = scripts.fetch("test").sub("--grep-invert #{tag} ", "")
    end
  end

  # A registry entry naming a pattern instead of a committed spec.
  def exempt_by_pattern(root, pattern)
    rewrite(root, REGISTRY, "  EXEMPT = {\n",
            "  EXEMPT = {\n    \"#{pattern}\" =>\n      \"a pattern broad enough to swallow the next spec\",\n")
  end

  # A KNOWN_FAILING reason with its repair-owner clause removed.
  def drop_repair_owner(root, clause)
    rewrite(root, REGISTRY, clause, "no repair card yet")
  end

  # Every `tag:` value of the named cases, gone: the declared grep matches nothing.
  def strip_case_tag(root, spec, tag)
    replace_all(root, File.join("e2e", spec), %(, { tag: "#{tag}" }), "")
  end

  private

  def copy_fixture(root)
    COPIES.each { |relative| copy(root, relative) }
    specs_on_disk.each { |relative| copy(root, relative) }
  end

  # Every *.spec.ts under e2e/ except the installed dependency tree, which is
  # not the checkout. The contract owns which spec files count as case sources
  # (`NOT_CASE_SOURCES` in e2e-spec-coverage.test.rb): copy one it excludes and
  # nothing changes, but omit one it counts and this fixture would lie.
  def specs_on_disk
    Dir.glob(File.join(SOURCE, "e2e", "**", "*.spec.ts"))
       .reject { |path| path.split(File::SEPARATOR).include?("node_modules") }
       .map { |path| path.delete_prefix("#{SOURCE}/") }
  end

  def manifest(root)
    path = File.join(root, PACKAGE)
    parsed = JSON.parse(File.read(path))
    yield parsed.fetch("scripts")
    File.write(path, JSON.generate(parsed))
  end

  def rewrite(root, relative, needle, replacement)
    edit(root, relative) { |source| source.sub(needle, replacement) }
  end

  def replace_all(root, relative, needle, replacement)
    edit(root, relative) { |source| source.gsub(needle, replacement) }
  end

  def edit(root, relative)
    path = File.join(root, relative)
    source = File.read(path)
    changed = yield source
    raise "mutation needle missing in #{relative}" if changed == source
    File.write(path, changed)
  end

  def copy(root, relative)
    FileUtils.mkdir_p(File.dirname(File.join(root, relative)))
    FileUtils.cp(File.join(SOURCE, relative), File.join(root, relative))
  end

  def write(root, relative, source)
    path = File.join(root, relative)
    FileUtils.mkdir_p(File.dirname(path))
    File.write(path, source)
  end
end
