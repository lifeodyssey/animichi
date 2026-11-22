# SUT: every live surface of the repository after the edge Worker's code was renamed to `api`
# (#1928). A live file must not send a reader, a filter or a rule to the old directory
# `workers/edge` or the old package `edge-worker`: after the rename each such reference names
# code that is no longer there, and a `pnpm --filter` or a path glob that matches nothing
# passes silently. The same goes for a regex source, a JSON string or a URL that spells either
# name escaped (`edge\/`, `edge\-worker`) or encoded (`edge%2F`): a plain search misses it, and
# a pattern that still spells the old path matches nothing, so its check passes vacuously.
# Dated records keep the history they recorded.
require "minitest/autorun"
require "open3"

class RetiredEdgeCodeRefsTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  RETIRED = [%r{workers/edge}, /edge-worker/, %r{workers\\+/edge}, %r{(?<![\w-])edge\\+/}, /edge\\+-worker/,
             %r{workers%2Fedge|(?<![\w-])edge%2F}i].freeze
  # History, not live surfaces — exempt by path family, one stated reason each. The families
  # are `retired-python-agent-refs.test.rb`'s, as the coordinator settled on #1928.
  HISTORY = {
    %r{\Adocs/archive/} => "read-only history (DOCS_POLICY)",
    %r{\Adocs/specs/\d{4}-\d{2}-\d{2}-} => "a dated spec (and its subfolder) records the design of its day",
    %r{\Adocs/iterations/} => "dated iteration plans and their execution records",
    %r{\Adocs/adr/} => "accepted decision records are immutable; a new ADR supersedes",
    %r{\Adocs/naming-audit-} => "a dated audit snapshot",
    %r{\Adocs/ops/pr-comment-debt-} => "a dated PR-comment ledger",
    %r{\Apackages/pi-session-neon/migrations/app/20260913T1711_data_plane_baseline/(?:conversation-ledger|usage-meters)\.ts\z} =>
      "an applied migration's authored source stays byte-identical until the chain is regenerated",
  }.freeze
  # Files that must spell a retired pattern out to do their own job:
  SPELLERS = {
    "test/repo-config/retired-edge-code-refs.test.rb" => "this contract names what it forbids",
  }.freeze
  # GitHub blocks a pushed file over 100 MiB, so a larger one can never become a live surface;
  # reading one over 2 GiB whole also fails on macOS (read(2): EINVAL).
  # https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github
  PUSHABLE_BYTES = 100 * 1024 * 1024

  def test_no_live_surface_names_the_retired_edge_directory_or_package
    offenders = live_files.flat_map { |path| retired_lines(path) }
    assert_empty(offenders,
                 "these live surfaces still name the edge Worker's retired code name (#1928). Rewrite " \
                 "them against `workers/api` and the `api` package, or move a dated record under " \
                 "docs/archive/:\n  #{offenders.join("\n  ")}")
  end

  private

  def live_files
    repository_files.reject { |path| SPELLERS.key?(path) || HISTORY.keys.any? { |family| path.match?(family) } }
  end

  # Tracked and staged paths, each read as it stands in the working tree: a partially staged file is
  # checked as it is on disk, and a new file counts once it is staged. CI's contracts job checks what
  # was pushed, on a clean checkout whose working tree equals the commit.
  def repository_files
    out, err, status = Open3.capture3("git", "ls-files", "-z", "--cached", chdir: ROOT)
    assert_predicate(status, :success?, "git ls-files failed: #{err}")
    out.split("\0").select { |path| pushable_file?(File.join(ROOT, path)) }
  end

  def pushable_file?(path)
    File.file?(path) && File.size(path) <= PUSHABLE_BYTES
  end

  def retired_lines(path)
    text = File.binread(File.join(ROOT, path))
    return [] if text.include?("\0")

    text.force_encoding(Encoding::UTF_8).scrub.each_line.with_index(1)
        .select { |line, _| RETIRED.any? { |pattern| line.match?(pattern) } }
        .map { |line, number| "#{path}:#{number}: #{line.strip}" }
  end
end
