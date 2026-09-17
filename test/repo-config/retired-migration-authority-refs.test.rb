# SUT: every live surface of the repository after the migration authority moved to Prisma.
# A live file must not name a request field, marker or gate that no side of the release
# handshake sends, reads or runs any more — a receiver still branching on a field nobody sends
# reads as live policy (#1621, #1635). Dated records keep the history they recorded.
require "minitest/autorun"
require "open3"

class RetiredMigrationAuthorityRefsTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  # The staging-only baseline: the owner deleted the gate rather than rehousing it (#1621), so
  # the field, the marker and the guard script all have to be unreachable by name.
  RETIRED = [/stagingOnlyBaseline/, /STAGING_ONLY_BASELINE/, /staging_only_baseline/,
             %r{production-baseline-guard}].freeze
  # History, not live surfaces — exempt by path family, one stated reason each:
  HISTORY = {
    %r{\Adocs/archive/} => "read-only history (DOCS_POLICY)",
    %r{\Adocs/specs/\d{4}-\d{2}-\d{2}-} => "a dated spec (and its subfolder) records the design of its day",
    %r{\Adocs/iterations/} => "dated iteration plans and their execution records",
    %r{\Adocs/adr/} => "accepted decision records are immutable; a new ADR supersedes",
  }.freeze
  # Files that must spell a retired name out to do their own job:
  SPELLERS = {
    "test/repo-config/retired-migration-authority-refs.test.rb" => "this contract names what it forbids",
    "workers/migrator/test/preflight.worker.metadata.test.ts" =>
      "one case sends the retired body verbatim, so the deleted branch is proved gone rather than unreachable",
  }.freeze

  def test_no_live_surface_names_the_retired_staging_only_baseline
    offenders = live_files.flat_map { |path| retired_lines(path) }
    assert_empty(offenders,
                 "these live surfaces still name the deleted staging-only baseline gate (#1621, " \
                 "#1635). Delete the reference, or move a dated record under docs/archive/:\n  " \
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
