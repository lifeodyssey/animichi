# SUT: every configuration root the retired showcase mode (#1013, retired by
# #1975) could come back through. A live file in a covered root must not set or
# require the showcase variable (edge `EDGE_SHOWCASE_MODE`, web
# `VITE_SHOWCASE_MODE`, the runtime config's `showcaseMode` field) or answer
# with the `showcase_denied` rejection: after #1975 no Worker, runtime
# configuration, build environment, test harness, PR verification lane, e2e
# configuration or local gate script reads a showcase flag, and any one of them
# bringing the name back would resurrect a gate that no longer exists. docs/
# and dated records are outside this contract's scope.
require "minitest/autorun"
require "open3"

class RetiredShowcaseModeRefsTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  # The covered roots, spelled out — exactly the surfaces the card names, so a
  # new configuration root has to be added here deliberately.
  ROOTS = [
    "workers/edge/wrangler.toml",
    "workers/catalog/wrangler.toml",
    "workers/users/wrangler.toml",
    "workers/migrator/wrangler.toml",
    "apps/web/wrangler.jsonc",
    "apps/web/src/lib/runtime-config",
    "apps/web/.env.example",
    "apps/web/.storybook",
    "apps/web/vitest.config.ts",
    "apps/web/tests",
    "workers/edge/test",
    "workers/edge/host-integration-test",
    "workers/edge/bundle-smoke",
    ".github/workflows",
    ".github/actions",
    ".github/scripts",
    ".github/test",
    "e2e",
    "scripts/local-gates",
  ].freeze
  RETIRED = [%r{EDGE_SHOWCASE_MODE}i, %r{VITE_SHOWCASE_MODE}i,
             %r{showcaseMode}i, %r{showcase_denied}i].freeze
  # Files that must spell a retired name out to do their own job:
  SPELLERS = {
    "test/repo-config/retired-showcase-mode-refs.test.rb" => "this contract names what it forbids",
    "apps/web/tests/unit/lib/runtime-config/runtime-config.test.ts" => "the loader contract rejects a re-added showcase field, and names it",
    "workers/edge/test/production-vars.test.ts" => "the retirement's own nail test asserts the denial never comes back, and names it",
  }.freeze

  def test_no_covered_root_carries_a_showcase_variable_or_denial
    offenders = root_files.flat_map { |path| retired_lines(path) }
    assert_empty(offenders,
                 "these covered roots still carry the retired showcase mode (#1975). Remove the " \
                 "variable/field/denial, or move a dated record under docs/:\n  " \
                 "#{offenders.join("\n  ")}")
  end

  private

  def root_files
    repository_files.select do |path|
      path == "apps/web/.env.example" ||
        ROOTS.any? { |root| root.end_with?(".toml", ".jsonc", ".ts") && path == root } ||
        ROOTS.any? { |root| !File.extname(root).match?(/\.(toml|jsonc|ts)/) && path.start_with?("#{root}/") }
    end.reject { |path| SPELLERS.key?(path) }
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
