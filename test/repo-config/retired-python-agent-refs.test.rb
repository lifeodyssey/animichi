# SUT: every live surface of the repository after the Python agent's retirement (#1607).
# A live file must not send a reader to the deleted `apps/agent` tree or tell them to
# `uv run` / `uv sync` a Python project. Dated records keep the history they recorded.
require "minitest/autorun"
require "open3"

class RetiredPythonAgentRefsTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  RETIRED = [%r{apps/agent}, /\buv\s+(?:run|sync)\b/].freeze
  # History, not live surfaces — exempt by path family, one stated reason each:
  HISTORY = {
    %r{\Adocs/archive/} => "read-only history (DOCS_POLICY)",
    %r{\Adocs/specs/\d{4}-\d{2}-\d{2}-} => "a dated spec (and its subfolder) records the design of its day",
    %r{\Adocs/iterations/} => "dated iteration plans and their execution records",
    %r{\Adocs/adr/} => "accepted decision records are immutable; a new ADR supersedes",
    %r{\Adocs/naming-audit-} => "a dated audit snapshot",
    %r{\Adocs/ops/pr-comment-debt-} => "a dated PR-comment ledger",
    %r{\Amigrations/} => "applied migrations are checksummed by atlas.sum; their SQL comments cannot change",
  }.freeze
  # Files that must spell a retired pattern out to do their own job:
  SPELLERS = {
    "test/repo-config/retired-python-agent-refs.test.rb" => "this contract names what it forbids",
    ".github/test/workflow-python-toolchain.test.rb" => "the workflow-side contract names what it forbids",
    ".serena/project.yml" => "Serena's generated template describes Serena's own `uv run` script",
  }.freeze

  def test_no_live_surface_names_the_retired_python_agent
    offenders = live_files.flat_map { |path| retired_lines(path) }
    assert_empty(offenders,
                 "these live surfaces still point at the retired Python agent (#1607). Rewrite them " \
                 "against the TypeScript runtime, or move a dated record under docs/archive/:\n  " \
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
