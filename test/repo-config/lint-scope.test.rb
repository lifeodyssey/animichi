# SUT: repository lint-scope configuration; tests preserve the reviewed tool input and install policy.
require "minitest/autorun"
require "json"
require "psych"

class LintScopeTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  OXLINT_CONFIG = ".oxlintrc.json"
  # The reviewed oxlint entry point: the whole package, run from its own root.
  # Every narrower shape looks the same on the outside — a path list
  # (`src scripts`), a `cd src &&` prefix, an appended `--ignore-pattern` or
  # `|| true` — while the file set it covers shrinks and the step exits 0.
  # #1360 measured that on the agent's now-retired ruff arm (592 files → 196);
  # #1452 found it live here, where `packages/contract` linted `src scripts`,
  # 34 of the package's 68 lintable files.
  OXLINT_WHOLE_PACKAGE = "oxlint --type-aware --deny-warnings ."
  # Each package's oxlint entry point by directory, pinned as the exact command
  # its own gates run. `lint` is the script CI's affected matrix step, the
  # pre-push gate and `pnpm -r run` all iterate; the reviewed command is either
  # in it (`packages/pi-session-neon`, `packages/prisma-geography`) or in the
  # `lint:oxlint` it delegates to. The whole string is pinned rather than the
  # `.` suffix, because `cd src && oxlint … .` ends in `.` too.
  OXLINT_ENTRY_POINTS = {
    "apps/anitabi-egress" => OXLINT_WHOLE_PACKAGE,
    "apps/web" => "pnpm run routes:generate && #{OXLINT_WHOLE_PACKAGE}",
    "e2e" => OXLINT_WHOLE_PACKAGE,
    "packages/agent" => OXLINT_WHOLE_PACKAGE,
    "packages/contract" => OXLINT_WHOLE_PACKAGE,
    "packages/eval" => OXLINT_WHOLE_PACKAGE,
    "packages/pi-session-neon" => OXLINT_WHOLE_PACKAGE,
    "packages/prisma-geography" => OXLINT_WHOLE_PACKAGE,
    "packages/test-postgres" => OXLINT_WHOLE_PACKAGE,
    "workers/catalog" => "tsx scripts/oxlint/check-no-inline-config.ts && " \
                         "tsx scripts/check-worker-entry-exports.ts && #{OXLINT_WHOLE_PACKAGE}",
    "workers/edge" => OXLINT_WHOLE_PACKAGE,
    "workers/migrator" => OXLINT_WHOLE_PACKAGE,
    "workers/users" => OXLINT_WHOLE_PACKAGE
  }.freeze
  # Workspace packages whose `lint` runs no oxlint at all. `infra` is the only
  # one: it declares no lint script (docs/ops/local-gates.md records the `—`),
  # so it is classified here rather than silently absent.
  NON_OXLINT_PACKAGES = %w[infra].freeze
  OXLINT_REVIEWED_IGNORES = {
    "." => [],
    "apps/anitabi-egress" => [],
    "apps/web" => ["node_modules/**", ".output/**", ".nitro/**", ".tanstack/**", "coverage/**",
                   "dist/**", "vitest*.config.ts", "vite.config.ts", "**/routeTree.gen.ts"],
    "packages/agent" => ["coverage/**"],
    "packages/pi-session-neon" => [],
    "packages/prisma-geography" => [],
    "e2e" => ["node_modules/**", "test-results/**", "playwright-report/**", ".auth/**",
              "generated/**", "agent-discovered/**", "visual/report/**", "visual/canonical/**"],
    "workers/catalog" => ["node_modules/**", ".wrangler/**", "dist/**", "coverage/**",
                          "vitest.config.ts", "vitest.integration.config.ts"],
    "workers/migrator" => ["node_modules/**", ".wrangler/**", "dist/**", "coverage/**",
                           "vitest.config.ts"],
    "workers/users" => ["node_modules/**", ".wrangler/**", "dist/**", "coverage/**",
                        "vitest.config.ts"]
  }.freeze

  def declared_oxlint_ignores
    paths = Dir.glob("**/#{OXLINT_CONFIG}", base: ROOT)
               .reject { |path| path.split("/").include?("node_modules") }
    paths.each_with_object({}) do |path, ignores|
      parsed = JSON.parse(File.read(File.join(ROOT, path)))
      ignores[File.dirname(path)] = Array(parsed["ignorePatterns"])
    end
  end

  def manifest_of(directory)
    JSON.parse(File.read(File.join(ROOT, directory, "package.json")))
  end

  def scripts_of(directory)
    manifest_of(directory)["scripts"] || {}
  end

  # What CI's affected matrix, the pre-push gate and `pnpm -r run` execute for
  # this package: `lint` is the step they iterate, and a package that factors
  # oxlint out keeps the reviewed command in the `lint:oxlint` it delegates to.
  def lint_invocation(directory)
    scripts = scripts_of(directory)
    scripts.key?("lint:oxlint") ? scripts.fetch("lint:oxlint") : scripts.fetch("lint", "")
  end

  def workspace_directories
    globs = Psych.safe_load(File.read(File.join(ROOT, "pnpm-workspace.yaml")))["packages"]
    globs.flat_map { |glob| Dir.glob(File.join(ROOT, glob, "package.json")) }
         .map { |path| File.dirname(path).delete_prefix("#{ROOT}/") }.sort
  end

  def delegating_lint_packages
    OXLINT_ENTRY_POINTS.keys.select { |directory| scripts_of(directory).key?("lint:oxlint") }
  end

  def root_lint_filters
    manifest_of(".").fetch("scripts").fetch("lint:oxlint").scan(/--filter[= ](\S+)/).flatten
  end

  def test_every_oxlint_config_is_reviewed
    found = declared_oxlint_ignores.keys.sort
    assert(found == OXLINT_REVIEWED_IGNORES.keys.sort,
                     "the reviewed oxlint configs are #{OXLINT_REVIEWED_IGNORES.keys.sort.join(', ')} " \
                     "(found #{found.join(', ')}); an unreviewed #{OXLINT_CONFIG} can ignore its own package's " \
                     "source, and a deleted one takes its package out of the type-aware lane entirely")
  end

  def render_patterns(patterns)
    patterns.empty? ? "none" : patterns.join(", ")
  end

  def test_oxlint_ignores_only_what_was_reviewed
    declared_oxlint_ignores.each do |directory, patterns|
      reviewed = OXLINT_REVIEWED_IGNORES[directory]
      assert(patterns == reviewed,
                       "#{File.join(directory, OXLINT_CONFIG)}: ignorePatterns must be exactly " \
                       "#{render_patterns(reviewed)} (got #{render_patterns(patterns)}); a pattern added here " \
                       "deletes files from `oxlint --type-aware --deny-warnings` without touching the command")
    end
  end

  def test_every_workspace_package_is_classified
    assert_equal((OXLINT_ENTRY_POINTS.keys + NON_OXLINT_PACKAGES).sort, workspace_directories,
                     "pnpm-workspace.yaml: every workspace package belongs to exactly one of " \
                     "OXLINT_ENTRY_POINTS and NON_OXLINT_PACKAGES; " \
                     "#{(workspace_directories - OXLINT_ENTRY_POINTS.keys - NON_OXLINT_PACKAGES).join(', ')} " \
                     "is in neither, so its lint scope is whatever its manifest happens to declare, unpinned")
  end

  def test_every_oxlint_entry_point_runs_the_reviewed_command
    OXLINT_ENTRY_POINTS.each do |directory, reviewed|
      assert_equal(reviewed, lint_invocation(directory),
                         "#{directory}/package.json: the lint entry point must be exactly " \
                         "#{reviewed.inspect} (got #{lint_invocation(directory).inspect}); anything " \
                         "narrower shrinks the file set the gate covers while the step stays green")
    end
  end

  def test_delegating_packages_run_their_lint_oxlint_from_lint
    delegating_lint_packages.each do |directory|
      assert_includes(scripts_of(directory).fetch("lint", ""), "lint:oxlint",
                             "#{directory}/package.json: `lint` must run `lint:oxlint` — the affected " \
                             "matrix, pre-push and `pnpm -r run` execute `lint`, so a command that " \
                             "bypasses it leaves the pinned invocation unrunnable")
    end
  end

  def test_workspace_packages_outside_the_oxlint_set_run_no_oxlint
    NON_OXLINT_PACKAGES.each do |directory|
      refute_includes(lint_invocation(directory), "oxlint",
                             "#{directory}/package.json: this package is classified as running no oxlint; " \
                             "it now needs a reviewed OXLINT_ENTRY_POINTS entry and the whole-package command")
    end
  end

  def test_root_dispatch_covers_every_package_that_declares_lint_oxlint
    declared = workspace_directories.select { |directory| scripts_of(directory).key?("lint:oxlint") }
    expected = declared.map { |directory| manifest_of(directory).fetch("name") }
    assert_equal(expected.sort, root_lint_filters.sort,
                     "package.json: the root lint:oxlint must filter exactly the packages declaring " \
                     "`lint:oxlint` (#{expected.sort.join(', ')}); a package missing here is linted by " \
                     "nothing that runs the aggregate, and one extra makes the aggregate exit non-zero")
  end
end
