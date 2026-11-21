# SUT: cd.yml invokes the lockfile-pinned native Wrangler with selected source tags and sealed
# environment configs.
require "minitest/autorun"
require_relative "repository-yaml"

class CdPublishTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  TARGETS = { "stage" => "staging", "promote-production" => "production" }.freeze
  FROZEN_INSTALL = "pnpm install --frozen-lockfile --ignore-scripts"
  PUBLISH = /wrangler deploy|publish-services/

  def setup
    @cd = RepositoryYaml.load_file(File.join(ROOT, ".github/workflows/cd.yml"))
  end

  # cd.yml runs the workspace's own `pnpm exec wrangler`, so a deploy is as reproducible as the
  # wrangler that job installed. The catalog declares wrangler as a range and pnpm-lock.yaml pins
  # the version (docs/agents/package-managers.md); the frozen install is what holds a publish to
  # that version, because it installs exactly what the lockfile records or fails. It has to come
  # before every publish step of the job, or that step runs whatever wrangler is on disk.
  def test_every_publish_runs_the_wrangler_the_frozen_lockfile_installed
    TARGETS.each_key do |job|
      steps = @cd.dig("jobs", job, "steps")
      install = steps.index { |step| step["run"] == FROZEN_INSTALL }
      publishes = steps.each_index.select { |index| steps[index]["run"].to_s.match?(PUBLISH) }
      refute_nil install, "cd.yml:#{job}: no `#{FROZEN_INSTALL}`, so no lockfile decides the wrangler it runs"
      assert_operator publishes.min, :>, install, "cd.yml:#{job}: a publish step runs before the frozen install"
    end
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
