# SUT: the edge Worker's code rename to `api` (#1928). A live file must not send a
# reader to the old directory `workers/edge` or the old package `edge-worker`:
# after the rename every such reference is an alias to code that is no longer there.
# Dated records keep the history they recorded.
require "minitest/autorun"
require "open3"

class RetiredEdgeCodeRefsTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  RETIRED = [%r{workers/edge}, %r{edge-worker}].freeze
  # History, not live surfaces — exempt by path family, one stated reason each:
  HISTORY = {
    %r{\Adocs/archive/} => "read-only history (DOCS_POLICY)",
    %r{\Adocs/specs/\d{4}-\d{2}-\d{2}-} => "a dated spec (and its subfolder) records the design of its day",
    %r{\Adocs/iterations/} => "dated iteration plans and their execution records",
    %r{\Adocs/adr/} => "accepted decision records are immutable; a new ADR supersedes",
    %r{\Adocs/naming-audit-} => "a dated audit snapshot",
    %r{\Adocs/ops/pr-comment-debt-} => "a dated PR-comment ledger",
  }.freeze
  # Files that must spell a retired pattern out to do their own job:
  SPELLERS = {
    "test/repo-config/retired-edge-code-refs.test.rb" => "this contract names what it forbids",
  }.freeze

  def test_no_live_surface_names_the_retired_edge_directory_or_package
    offenders = live_files.flat_map { |path| retired_lines(path) }
    assert_empty(offenders,
                 "these live surfaces still point at the edge Worker's retired code name (#1928). " \
                 "Rewrite them against `workers/api` / the `api` package, or move a dated record " \
                 "under docs/archive/:\n  " \
                 "#{offenders.join("\n  ")}")
  end

  private

  def live_files
    repository_files.reject { |path| SPELLERS.key?(path) || HISTORY.keys.any? { |family| path.match?(family) } }
  end

  def repository_files
    out, err, status = Open3.capture3("git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", chdir: ROOT)
    assert_predicate(status, :success?, "git ls-files failed: #{err}")
    out.split("\0").select { |path| File.file?(File.join(ROOT, path)) }
  end

  def retired_lines(path)
    text = File.binread(File.join(ROOT, path))
    return [] if text.include?("\0")

    text.force_encoding(Encoding::UTF_8).scrub.each_line.with_index(1)
        .select { |line, _| RETIRED.any? { |pattern| line.match?(pattern) } }
        .map { |line, number| "#{path}:#{number}: #{line.strip}" }
  end
end
