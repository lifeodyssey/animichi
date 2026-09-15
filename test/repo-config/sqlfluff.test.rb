# SUT: the sanctioned sqlfluff lint entry point (`make db-lint`) and the CI step that runs it.
require "minitest/autorun"
require "open3"
require "psych"

class SqlfluffMigrationsTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CI_FILE = ".github/workflows/pr-verification.yml"
  CI_OVERRIDES = %w[defaults env if shell working-directory].freeze
  CONFIG = "db/.sqlfluff"
  # `make -n` executes no recipe line, so a fixed PATH and an otherwise empty environment are
  # enough to keep an inherited MAKEFLAGS — or a variable override — out of the expansion.
  DRY_RUN_ENV = { "PATH" => "/usr/bin:/bin:/usr/sbin:/sbin" }.freeze

  def read(path)
    File.read(File.join(ROOT, path))
  end

  # What make itself expands for `make db-lint` and would run. Make resolves the recipe's
  # includes, `define`, `$(eval)` and prerequisites before printing, so this is the real command,
  # not a scrape of the recipe text.
  def db_lint_dry_run
    out, err, status = Open3.capture3(DRY_RUN_ENV, "make", "-n", "db-lint",
                                      chdir: ROOT, unsetenv_others: true)
    assert_predicate(status, :success?, "`make -n db-lint` failed (#{status.exitstatus}): #{err}")
    out
  end

  def test_the_sanctioned_command_lints_through_the_reviewed_config
    assert_equal(
      %(env -u UV_CACHE_DIR uvx --no-build "sqlfluff==4.2.2" lint migrations/neon --config db/.sqlfluff\n),
      db_lint_dry_run,
      "`make db-lint` must expand to exactly this command: the pinned version, the reviewed " \
      "config and the one linted path — never supabase/migrations"
    )
    assert(File.exist?(File.join(ROOT, CONFIG)),
           "#{CONFIG} must exist; moving it away leaves the sanctioned command with no config")
  end

  def test_ci_runs_the_sanctioned_command_with_no_overrides
    workflow = Psych.safe_load(read(CI_FILE), aliases: true)
    job = workflow.dig("jobs", "sqlfluff")
    steps = job.fetch("steps")
    assert_equal(["make db-lint"], steps.select { |step| step.key?("run") }.map { |step| step["run"] },
                 "#{CI_FILE}: the sqlfluff job must run `make db-lint`, not its own sqlfluff command")
    assert_empty([workflow, job, *steps].flat_map { |item| item.keys & CI_OVERRIDES },
                 "#{CI_FILE}: #{CI_OVERRIDES.join(', ')} must not override the workflow root, the " \
                 "job or its steps, or CI lints with inputs the sanctioned command never shows")
  end
end
