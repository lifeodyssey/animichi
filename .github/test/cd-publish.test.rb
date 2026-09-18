# SUT: cd.yml invokes pinned native Wrangler with selected source tags and sealed environment configs.
require "minitest/autorun"
require "psych"
require "json"

class CdPublishTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  TARGETS = { "stage" => "staging", "promote-production" => "production" }.freeze

  def setup
    @cd = Psych.safe_load(File.read(File.join(ROOT, ".github/workflows/cd.yml")), aliases: true)
  end

  # cd.yml runs the workspace's own `pnpm exec wrangler`. An exact pin is what
  # makes a deploy reproducible; since #1672 it lives in the default catalog and
  # the manifest reaches it through `catalog:`.
  def test_native_wrangler_is_pinned_in_the_installed_workspace
    declared = JSON.parse(File.read(File.join(ROOT, "package.json"))).dig("devDependencies", "wrangler")
    catalog = Psych.safe_load(File.read(File.join(ROOT, "pnpm-workspace.yaml"))).fetch("catalog")
    assert_match(/\A\d+\.\d+\.\d+\z/, declared == "catalog:" ? catalog.fetch("wrangler") : declared)
  end

  def test_migrator_publication_uses_sealed_config_and_selected_source
    TARGETS.each do |job, environment|
      steps = @cd.dig("jobs", job, "steps").select { |step| step["run"].to_s.include?("wrangler deploy") }
      assert_equal 1, steps.length
      expected = %(pnpm exec wrangler deploy --no-bundle --config release/migrator/wrangler.json --env #{environment} --tag "sha-$SOURCE_SHA")
      assert_equal expected, steps.first.fetch("run")
      assert_equal "${{ needs.select.outputs.source_sha }}", steps.first.dig("env", "SOURCE_SHA")
    end
  end

  def test_service_publication_uses_the_native_entry_and_selected_source
    TARGETS.each do |job, environment|
      steps = @cd.dig("jobs", job, "steps").select { |step| step["run"].to_s.include?("publish-services.sh") }
      assert_equal 1, steps.length
      assert_equal "bash .github/scripts/release/publish-services.sh #{environment}", steps.first.fetch("run")
      assert_equal "${{ needs.select.outputs.source_sha }}", steps.first.dig("env", "SOURCE_SHA")
    end
  end

  def test_selection_job_cannot_publish
    refute_match(/wrangler deploy|publish-services|command.*up/, @cd.dig("jobs", "select").to_s)
  end
end
