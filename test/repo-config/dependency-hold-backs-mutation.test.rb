# SUT: test/repo-config/dependency-hold-backs.test.rb — the hold-back register (#1736).
# Every probe copies the contract, its reader, the workspace manifest, the fixture and the
# package manifests into a throwaway tree, mutates the copy, and runs the copied contract;
# the committed files are never written to. Each probe has to go red AND name its subject:
# a register that is green with a line deleted, a line misplaced, or a pin moved is a
# register that lies about the tree it lives in.
require "minitest/autorun"
require_relative "dependency_hold_backs"
require "fileutils"
require "json"
require "open3"
require "tmpdir"

class DependencyHoldBacksMutationTest < Minitest::Test
  include HoldBacks

  ROOT = File.expand_path("../..", __dir__)
  CONTRACT = "test/repo-config/dependency-hold-backs.test.rb"
  READER = "test/repo-config/dependency_hold_backs.rb"
  MANIFEST = "pnpm-workspace.yaml"
  NO_LINE = "no `# hold-back:` line for it"
  MISPLACED = "not immediately above its catalog entry"
  ORPHAN = "names an entry that is not below latest"
  MOVED_PIN = "refresh the register"
  ADMITTED = "not a hold-back, so take the bump and delete its register line"
  ISSUE_MISMATCH = "the snapshot registers #1742"
  # A catalog pin `^4.13.7` admits (4.13.8), verbatim, for the probe that registers it as held.
  HONO_ENTRY = { "package" => "hono", "declared" => "^4.13.7", "latest" => "4.13.8", "declaredIn" => MANIFEST,
                 "issue" => 9999 }.freeze
  HONO_PIN = "  \"hono\": \"^4.13.7\""
  HONO_LINE = "# hold-back: hono@^4.13.7 -> 4.13.8 fails nothing at all \u2014 #9999"
  # The catalog's @vitest/coverage-istanbul line, verbatim, for the probes that move it and
  # re-cite it. (Originally the zod line, until #1745 released that pin.)
  ISTANBUL_LINE = "  # hold-back: @vitest/coverage-istanbul@4.1.11 -> 5.0.1 fails workers/users test:worker (the provider throws \"coverageFilesDirectory is required\" under vitest 4, so coverage stays 0%) \u2014 #1742
"

  def manifests
    Dir.glob(MANIFEST_GLOBS, base: ROOT).sort
  end

  def with_tree
    Dir.mktmpdir("hold-back-mutation-") do |root|
      ([CONTRACT, READER, MANIFEST, FIXTURE] + manifests).each do |relative|
        FileUtils.mkdir_p(File.join(root, File.dirname(relative)))
        FileUtils.cp(File.join(ROOT, relative), File.join(root, relative))
      end
      yield root
    end
  end

  def rewrite(root, relative, needle, replacement, label)
    path = File.join(root, relative)
    source = File.read(path)
    changed = source.sub(needle, replacement)
    refute_equal source, changed, "mutation needle missing: #{label}"
    File.write(path, changed)
  end

  # The snapshot is a document, not a fold: the block mutates it and this writes it back.
  def rewrite_fixture(root)
    path = File.join(root, FIXTURE)
    fixture = JSON.parse(File.read(path))
    yield(fixture)
    File.write(path, "#{JSON.pretty_generate(fixture)}\n")
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
    with_tree { |root| accept_tree(root, "the committed register") }
  end

  def test_rejects_a_catalog_pin_with_no_register_line
    with_tree do |root|
      rewrite(root, MANIFEST, "  # hold-back: @vitest/coverage-istanbul@4.1.11", "  # deleted: @vitest/coverage-istanbul@4.1.11", "the coverage-istanbul register line")
      reject_tree(root, "a deleted catalog register line", "@vitest/coverage-istanbul@4.1.11: #{NO_LINE}")
    end
  end

  def test_rejects_a_manifest_pin_with_no_register_line
    with_tree do |root|
      rewrite(root, MANIFEST, "# hold-back: h3@^1.15.11", "# deleted: h3@^1.15.11", "the h3 register line")
      reject_tree(root, "a deleted manifest register line", "h3@^1.15.11: #{NO_LINE}")
    end
  end

  # The plausible mistake: a catalog pin's line kept, but collected into the manifest-pins
  # block instead of staying beside the entry it registers.
  def test_rejects_a_line_that_drifted_away_from_its_catalog_entry
    with_tree do |root|
      rewrite(root, MANIFEST, ISTANBUL_LINE, "", "the coverage-istanbul register line")
      File.write(File.join(root, MANIFEST), ISTANBUL_LINE, mode: "a")
      reject_tree(root, "a register line moved away from its pin", MISPLACED)
    end
  end

  def test_rejects_a_line_whose_entry_is_no_longer_below_latest
    with_tree do |root|
      rewrite(root, MANIFEST, "-> 5.0.1 fails workers/users test:worker", "-> 4.1.11 fails workers/users test:worker", "a stale latest on the coverage-istanbul line")
      reject_tree(root, "a line naming a release that is not the latest", ORPHAN)
    end
  end

  def test_rejects_a_pin_that_moved_without_the_register
    with_tree do |root|
      rewrite(root, MANIFEST, "  \"@vitest/coverage-istanbul\": \"4.1.11\"", "  \"@vitest/coverage-istanbul\": \"5.0.1\"", "the catalog's coverage-istanbul pin")
      reject_tree(root, "a bumped declaration left in the register", "#{MOVED_PIN}")
    end
  end

  # The line is in the right place and names the right release, but points a merged register at
  # the wrong follow-up card (round 1, must-fix 5).
  def test_rejects_a_line_that_cites_an_issue_the_snapshot_does_not_register
    with_tree do |root|
      rewrite(root, MANIFEST, "  # hold-back: @vitest/coverage-istanbul@4.1.11 -> 5.0.1 fails workers/users test:worker (the provider throws \"coverageFilesDirectory is required\" under vitest 4, so coverage stays 0%) \u2014 #1742", "  # hold-back: @vitest/coverage-istanbul@4.1.11 -> 5.0.1 fails workers/users test:worker (the provider throws \"coverageFilesDirectory is required\" under vitest 4, so coverage stays 0%) \u2014 #9999", "the coverage-istanbul line's follow-up issue")
      reject_tree(root, "a line citing an issue the snapshot does not register", ISSUE_MISMATCH)
    end
  end

  def test_rejects_a_fixture_entry_whose_specifier_admits_the_latest
    with_tree do |root|
      register_hono_as_held(root)
      reject_tree(root, "an entry whose specifier admits its latest", ADMITTED)
    end
  end

  # A hold-back line for a pin that `^4.13.7` admits: the register's own shape, and a lie.
  def register_hono_as_held(root)
    rewrite_fixture(root) { |fixture| fixture["holdbacks"].push(HONO_ENTRY) }
    rewrite(root, MANIFEST, HONO_PIN, "#{HONO_LINE}\n#{HONO_PIN}", "a hold-back that is not held")
  end
end
