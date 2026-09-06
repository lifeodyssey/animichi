#!/usr/bin/env ruby
# frozen_string_literal: true

# The shape of the pnpm-affected CI file (card B1 / #1359), which is what the
# retired `test_ci_contract*` and `test_pr_verification_contract*` pinned for
# the old router:
#
#   plan        subtracts exactly the three projects that own a job of their own
#   affected    cannot start on an empty matrix, runs exactly the four package
#               scripts, and provisions every binary a selected package's own
#               `test` shells out to
#   workspace   a job that runs a repository script importing workspace
#               dependencies installs the workspace first
#   aggregates  `Security` and `PR Verification` each name their dependencies,
#               run `always()`, and fail on a failed or cancelled one; the
#               transitional codeql job is in neither
#
# The repository-wide meta-invariants (timeouts, permissions, concurrency,
# action pinning) are `test_workflow_invariants.rb`, not this file.
#
# Usage: ruby .github/scripts/test_ci_workflow_contract.rb [REPO_ROOT]

require_relative "workflow_document"

CI_FILE = File.join(repository_root, ".github", "workflows", "pr-verification.yml")
SECURITY_JOBS = %w[gitleaks trufflehog osv semgrep zizmor sqlfluff].freeze
LANE_JOBS = %w[plan affected contracts docs agent e2e db security].freeze
PACKAGE_SCRIPTS = %w[lint typecheck test test:integration].freeze
# The projects pnpm selects that must never enter the matrix, each because a
# dedicated job owns it: the root project, the Python agent, the browser suite.
MATRIX_EXCLUSIONS = ["animichi-cloudflare-worker", "@animichi/agent", "animichi-e2e"].freeze
# package => the marker of the step that provisions the binary its own `test`
# shells out to. Without the step the package's lane fails for a reason that
# has nothing to do with the code under test (#1359 review P1-1 / P1-2).
MATRIX_TOOLCHAINS = [
  ["@animichi/eval", "uv python install"],
  ["catalog", "install-atlas"],
  ["catalog", "docker build -f apps/agent/docker/test-postgres/Dockerfile"],
  ["infra", "pulumi/actions"]
].freeze
AGGREGATE_GUARD = "contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')"
# A `.github/scripts/*.mjs` resolves its imports against the repository's
# node_modules, so any job that runs one has to install the workspace. Without
# it the script dies with ERR_MODULE_NOT_FOUND and the assertion that spawned
# it reports an ordinary failure (run 34001151283).
WORKSPACE_SETUP = "./.github/actions/setup"
NODE_SCRIPT = %r{\bnode \.github/scripts/\S+\.mjs}

@log = ViolationLog.new
@ci = WorkflowDocument.load(CI_FILE)
@source = File.read(CI_FILE)

def assert_plan_subtracts_owned_projects
  MATRIX_EXCLUSIONS.each do |name|
    @log.unless_true(@source.include?(%("#{name}")),
                     "pr-verification.yml: plan must subtract #{name} from the matrix")
  end
  @log.unless_true(@source.include?(%(--filter "...[$merge_base]")),
                   "pr-verification.yml: plan must select the affected set with pnpm's dependent-closure filter")
end

def assert_matrix_guard
  @log.unless_true(@ci.dig("jobs", "affected", "if").to_s.include?("needs.plan.outputs.packages != '[]'"),
                   "pr-verification.yml: affected must not start on an empty matrix")
  @log.unless_true(@ci.dig("jobs", "affected", "strategy", "matrix", "package").to_s
                      .include?("needs.plan.outputs.packages"),
                   "pr-verification.yml: the matrix must be the plan job's package list")
end

def matrix_step_source
  @ci.steps_of("affected").map { |step| step["run"] }.compact.join("\n")
end

# The exact token list, not a substring search: `test` alone would otherwise
# be satisfied by `test:integration` still being there.
def matrix_scripts
  matrix_step_source[/^\s*for script in ([^;]+); do/, 1].to_s.split
end

def assert_matrix_runs_package_scripts
  @log.unless_true(matrix_step_source.include?('pnpm --filter "$PACKAGE" run --if-present "$script"'),
                   "pr-verification.yml: the matrix must run the package's own scripts")
  @log.unless_true(matrix_scripts == PACKAGE_SCRIPTS,
                   "pr-verification.yml: the matrix must run exactly #{PACKAGE_SCRIPTS.join(', ')} " \
                   "(got #{matrix_scripts.join(', ')})")
end

def provisions?(step, package, tool)
  step.is_a?(Hash) && step["if"].to_s.include?(package) && "#{step['uses']}#{step['run']}".include?(tool)
end

def assert_matrix_provisions_toolchains
  MATRIX_TOOLCHAINS.each do |package, tool|
    @log.unless_true(@ci.steps_of("affected").any? { |step| provisions?(step, package, tool) },
                     "pr-verification.yml: `#{package}` needs a matrix step providing #{tool}")
  end
end

def runs_node_script?(job)
  @ci.steps_of(job).any? { |step| step["run"].to_s.match?(NODE_SCRIPT) }
end

def installs_workspace?(job)
  @ci.steps_of(job).any? { |step| step["uses"] == WORKSPACE_SETUP }
end

def assert_node_scripts_have_a_workspace
  @ci.jobs.each_key do |job|
    next unless runs_node_script?(job)

    @log.unless_true(installs_workspace?(job),
                     "pr-verification.yml:#{job}: runs a repository .mjs script without installing the workspace")
  end
end

def assert_aggregate(job, expected_needs)
  @log.unless_true(@ci.dig("jobs", job, "if").to_s.include?("always()"),
                   "pr-verification.yml:#{job}: must run always()")
  @log.unless_true(Array(@ci.dig("jobs", job, "needs")).sort == expected_needs.sort,
                   "pr-verification.yml:#{job}: needs must be #{expected_needs.sort.join(', ')}")
  @log.unless_true(@ci.steps_of(job).map { |step| step["if"].to_s }.join(" ").include?(AGGREGATE_GUARD),
                   "pr-verification.yml:#{job}: must fail on a failed or cancelled dependency")
end

# CodeQL's results are consumed by the ruleset's own code_scanning rule. Inside
# an aggregate, the B3 switch to default setup would lock every in-flight PR.
def assert_codeql_is_outside_the_aggregates
  %w[security aggregate].each do |job|
    @log.unless_true(!Array(@ci.dig("jobs", job, "needs")).include?("codeql"),
                     "pr-verification.yml:#{job}: the transitional codeql job must stay out of the aggregate")
  end
end

def main
  assert_plan_subtracts_owned_projects
  assert_matrix_guard
  assert_matrix_runs_package_scripts
  assert_matrix_provisions_toolchains
  assert_node_scripts_have_a_workspace
  assert_aggregate("security", SECURITY_JOBS)
  assert_aggregate("aggregate", LANE_JOBS)
  assert_codeql_is_outside_the_aggregates
  @log.report("CI workflow contract: all assertions hold")
end

main if $PROGRAM_NAME == __FILE__
