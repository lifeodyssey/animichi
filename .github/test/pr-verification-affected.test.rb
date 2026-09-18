# SUT: pr-verification.yml selected-package gates and the workflow-wide Postgres
# image tag, which every build step sources from packages/test-postgres/postgres-image.env.
require "minitest/autorun"
require "psych"

class PrVerificationAffectedTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CI_FILE = File.join(ROOT, ".github", "workflows", "pr-verification.yml")
  PACKAGE_SCRIPTS = %w[lint typecheck test test:integration].freeze
  # Atlas is still applied by the catalog spike, the native catalog fixture and
  # the migrator's transition handshake; the packages whose gates reach it only
  # through the shared plane (#1625) are not listed (#1634 retires it entirely).
  MATRIX_TOOLCHAINS = [


    ["catalog", "docker build -f packages/test-postgres/Dockerfile"],

    ["@animichi/agent", "docker build -f packages/test-postgres/Dockerfile"],
    ["edge-worker", "docker build -f packages/test-postgres/Dockerfile"],
    ["@animichi/test-postgres", "docker build -f packages/test-postgres/Dockerfile"],
    ["@animichi/pi-session-neon", "docker build -f packages/test-postgres/Dockerfile"],
    ["@animichi/prisma-geography", "docker build -f packages/test-postgres/Dockerfile"],
    ["infra", "pulumi/actions"]
  ].freeze
  def setup
    @ci = Psych.safe_load(File.read(CI_FILE), aliases: true)
  end

  def test_matrix_guard
    assert(@ci.dig("jobs", "affected", "if").to_s.include?("needs.plan.outputs.packages != '[]'"),
                     "pr-verification.yml: affected must not start on an empty matrix")
    assert(@ci.dig("jobs", "affected", "strategy", "matrix", "package").to_s
                        .include?("needs.plan.outputs.packages"),
                     "pr-verification.yml: the matrix must be the plan job's package list")
  end

  def matrix_step_source
    @ci.dig("jobs", "affected", "steps").to_a.map { |step| step["run"] }.compact.join("\n")
  end

  def matrix_scripts
    matrix_step_source[/^\s*for script in ([^;]+); do/, 1].to_s.split
  end

  def test_matrix_runs_package_scripts
    assert(matrix_step_source.include?('pnpm --filter "$PACKAGE" run --if-present "$script"'),
                     "pr-verification.yml: the matrix must run the package's own scripts")
    assert(matrix_scripts == PACKAGE_SCRIPTS,
                     "pr-verification.yml: the matrix must run exactly #{PACKAGE_SCRIPTS.join(', ')} " \
                     "(got #{matrix_scripts.join(', ')})")
  end

  def test_agent_domain_package_selects_its_coverage_report
    assert_includes matrix_step_source, "@animichi/agent) file=packages/agent/coverage/lcov.info ;;"
  end

  def test_geography_package_selects_its_coverage_report
    assert_includes matrix_step_source, "@animichi/prisma-geography) file=packages/prisma-geography/coverage/lcov.info ;;"
  end

  COVERAGE_CHECK = 'pnpm --filter "$PACKAGE" exec ruby "$GITHUB_WORKSPACE/test/repo-config/check-coverage-report.rb"'

  def step_index(steps)
    steps.index { |step| yield step }
  end

  # node passes a coverage threshold on a report that measured nothing (#1766): the check reads
  # the report the package's gates wrote, so it runs after them and before Codecov receives it.
  def test_matrix_checks_the_coverage_report_between_the_gates_and_its_upload
    steps = @ci.dig("jobs", "affected", "steps").to_a
    gates = step_index(steps) { |step| step["run"].to_s.include?("run --if-present \"$script\"") }
    check = step_index(steps) { |step| step["run"].to_s.include?(COVERAGE_CHECK) }
    upload = step_index(steps) { |step| step["uses"].to_s.start_with?("codecov/codecov-action@") }
    refute_nil check, "pr-verification.yml: the affected matrix must run #{COVERAGE_CHECK}"
    assert check > gates && check < upload, "pr-verification.yml: the coverage check must sit between the gates and the upload"
  end

  def provisions?(step, package, tool)
    step.is_a?(Hash) && step["if"].to_s.include?(package) && "#{step['uses']}#{step['run']}".include?(tool)
  end

  # `@animichi/eval`'s own `test` re-ran the Python fixture exporter, which is
  # the only reason the matrix carried a uv arm; the fixtures are frozen bytes
  # now and nothing in the package shells out to uv (#1603). Both halves are
  # pinned: no eval-scoped uv step, and no uv install in the matrix at all —
  # the second is what keeps the first from passing vacuously.
  def test_eval_needs_no_uv_toolchain
    steps = @ci.dig("jobs", "affected", "steps").to_a
    refute(steps.any? { |step| provisions?(step, "@animichi/eval", "uv") },
                   "pr-verification.yml: no step may provision a toolchain for @animichi/eval")
    refute(steps.any? { |step| step["uses"].to_s.start_with?("astral-sh/setup-uv@") },
                   "pr-verification.yml: the affected matrix must not install uv")
  end

  def test_matrix_provisions_toolchains
    MATRIX_TOOLCHAINS.each do |package, tool|
      assert(@ci.dig("jobs", "affected", "steps").to_a.any? { |step| provisions?(step, package, tool) },
                       "pr-verification.yml: `#{package}` needs a matrix step providing #{tool}")
    end
  end
end

class PrVerificationPostgresImageTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  IMAGE_DECLARATION = "packages/test-postgres/postgres-image.env"
  IMAGE_BUILD = "docker build -f packages/test-postgres/Dockerfile"
  IMAGE_REFERENCE = '"$TEST_POSTGRES_IMAGE"'
  DECLARED_IMAGE = File.read(File.join(ROOT, IMAGE_DECLARATION))[/^TEST_POSTGRES_IMAGE=(.+)$/, 1].to_s.strip

  def setup
    @ci = Psych.safe_load(File.read(File.join(ROOT, ".github/workflows/pr-verification.yml")), aliases: true)
  end

  def image_build_runs
    @ci.fetch("jobs").keys.flat_map { |job| @ci.dig("jobs", job, "steps").to_a }
       .map { |step| step["run"] }.compact.select { |run| run.include?(IMAGE_BUILD) }
  end

  def built_tag(run)
    run[/#{Regexp.escape(IMAGE_BUILD)} -t (\S+) \./, 1].to_s
  end

  # Sourcing after the build would leave the tag unset, so the order matters.
  def sources_declaration_first?(run)
    source = run.index(". #{IMAGE_DECLARATION}")
    build = run.index(IMAGE_BUILD)
    !source.nil? && !build.nil? && source < build
  end

  def builds_from_the_declaration?(run)
    built_tag(run) == IMAGE_REFERENCE && sources_declaration_first?(run)
  end

  def unsourced_build_message(run)
    "pr-verification.yml: the build tagged #{built_tag(run)} must source " \
      "#{IMAGE_DECLARATION} first and tag with #{IMAGE_REFERENCE}; " \
      "#{DECLARED_IMAGE} is the tag's one declaration"
  end

  def test_image_builds_resolve_one_tag
    assert(!image_build_runs.empty?,
                     "pr-verification.yml: nothing builds the offline Postgres image any more")
    image_build_runs.each do |run|
      assert(builds_from_the_declaration?(run), unsourced_build_message(run))
    end
  end

end
