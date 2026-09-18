# SUT: pr-verification.yml plan selects dependent packages and routes workflow/action changes to real lanes.
require "minitest/autorun"
require "psych"

class PrVerificationPlanTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  FILE = File.join(ROOT, ".github/workflows/pr-verification.yml")

  def setup
    @source = File.read(FILE)
    @ci = Psych.safe_load(@source, aliases: true)
  end

  def test_routes_workflow_and_action_sources_together
    paths = @ci.dig("jobs", "plan", "steps").find { |step| step["id"] == "paths" }
    filters = Psych.safe_load(paths.dig("with", "filters"), aliases: true)
    assert_includes filters.fetch("workflows"), ".github/workflows/**"
    assert_includes filters.fetch("workflows"), ".github/actions/**"
    assert_includes filters.fetch("workflows"), ".github/scripts/**"
    assert_includes filters.fetch("workflows"), ".github/lib/**"
    assert_includes filters.fetch("workflows"), ".github/test/**"
  end

  # The plan job's two hand-written routing tables: the paths filters that
  # decide which lane a changed path reaches, and the matrix's exclusion list.
  # pnpm derives the matrix itself, so a new package is covered the moment it
  # exists — but a path or a name leaving either table stops that gate while the
  # rest of CI stays green, the hole #1687 found in pre-push's routing table
  # (`test/repo-config/pre-push-routing.test.rb`). Both are pinned whole.
  REVIEWED_PATHS_FILTERS = {
    "web" => ["apps/web/**"],
    "e2e" => ["e2e/**", "packages/contract/**", "workers/edge/**", "packages/agent/**",
              "packages/pi-session-neon/**", "packages/test-postgres/**"],
    "migrations" => ["packages/pi-session-neon/migrations/**", "packages/pi-session-neon/src/contract.prisma",
                     "infra/database-access/reset-staging-baseline*"],
    "workflows" => [".github/workflows/**", ".github/actions/**", ".github/scripts/**",
                    ".github/lib/**", ".github/test/**"],
    "deps" => ["pnpm-lock.yaml", "package.json", "pnpm-workspace.yaml", ".npmrc"],
    "foundation" => ["pnpm-lock.yaml", "package.json", "pnpm-workspace.yaml", ".pulumi.version",
                     "infra/database-access/**", ".github/scripts/release/**"],
    "delivery" => [".github/lib/**", ".github/scripts/**", ".github/test/delivery/**",
                   "scripts/delivery/**", "scripts/local-gates/**"]
  }.freeze
  REVIEWED_MATRIX_EXCLUSIONS = ["animichi-cloudflare-worker", "animichi-e2e"].freeze

  def paths_filters
    step = @ci.dig("jobs", "plan", "steps").find { |candidate| candidate["id"] == "paths" }
    Psych.safe_load(step.dig("with", "filters"), aliases: true)
  end

  def test_paths_filters_are_the_reviewed_routing_table
    reviewed = REVIEWED_PATHS_FILTERS.transform_values(&:sort)
    declared = paths_filters.transform_values { |paths| Array(paths).sort }
    assert_equal reviewed, declared,
                     "pr-verification.yml: the plan job's filters are the routing table every lane is selected " \
                     "by; a path leaving one stops that lane running while the rest of CI stays green"
  end

  def test_the_matrix_subtracts_only_the_reviewed_projects
    excluded = @source[/\[\.\[\]\.name\] - \[(.+?)\]/, 1].to_s.scan(/"([^"]+)"/).flatten
    assert_equal REVIEWED_MATRIX_EXCLUSIONS.sort, excluded.sort,
                     "pr-verification.yml: the matrix's exclusion list is a routing table of its own — a " \
                     "package added to it stops being gated there while every check stays green"
  end

  def test_selects_dependents_but_leaves_owned_lanes_out_of_the_matrix
    %w[animichi-cloudflare-worker animichi-e2e].each do |name|
      assert_includes @source, %Q("#{name}")
    end
    assert_includes @source, '--filter "...[$merge_base]"'
  end

  def test_workflow_and_action_changes_reach_the_edge_suite
    assert_includes @source, '["edge-worker"] | unique'
    assert_equal "${{ steps.paths.outputs.workflows }}", @ci.dig("jobs", "plan", "outputs", "workflows")
  end
end
