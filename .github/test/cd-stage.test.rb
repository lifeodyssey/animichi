# SUT: cd.yml keeps ordered foundation, migration, service publication and smoke in each environment lock.
require "minitest/autorun"
require "psych"

class CdStageTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))

  def setup
    @cd = Psych.safe_load(File.read(File.join(ROOT, ".github/workflows/cd.yml")), aliases: true)
  end

  def steps(job)
    @cd.fetch("jobs").fetch(job).fetch("steps")
  end

  def step(job, name)
    steps(job).find { |item| item["name"] == name }.tap { |item| refute_nil item, name }
  end

  def position(job, name)
    steps(job).index(step(job, name))
  end

  CHAIN = ["Retire the migrator container application", "Publish the selected migrator", "Preview the selected native migration graph", "Apply database access", "Apply topology",
           "Apply the selected migration chain", "Verify the promoted catalog schema", "Publish the selected services", "Smoke the release"].freeze

  def test_each_environment_runs_the_complete_ordered_chain
    %w[stage promote-production].each do |job|
      positions = CHAIN.map { |name| position(job, name) }
      assert_equal positions.sort, positions
      CHAIN.each { |name| refute step(job, name).key?("if"), "#{job}: #{name} must not omit a snapshot unit" }
    end
  end

  # The Prisma flip (#1625) meets a staging database still carrying the retired Atlas chain's
  # objects, and the baseline would CREATE onto them (42710). The owner approved rebuilding
  # staging, and a deploy happens only in CD, so the rebuild is a step of the staging job: after
  # the migrator it would be refused by is published, before that migrator's preview. The step
  # carries no `if:` — the script's own gate (reset-staging-baseline.test.sh) makes every later
  # run a no-op, and a workflow condition could only skip the cutover it exists for.
  RESET = "Rebuild a staging schema stranded on the Atlas chain".freeze

  def test_staging_rebuilds_a_stranded_schema_between_the_publish_and_the_preview
    reset = step("stage", RESET)
    assert_equal "bash infra/database-access/reset-staging-baseline.sh", reset["run"]
    refute reset.key?("if"), "the script's gate decides whether to rebuild, not the workflow"
    assert_operator position("stage", "Publish the selected migrator"), :<, position("stage", RESET)
    assert_operator position("stage", RESET), :<, position("stage", "Preview the selected native migration graph")
  end

  def test_only_the_staging_environment_runs_the_rebuild
    assert_equal "staging", @cd.dig("jobs", "stage", "environment")
    holders = @cd.fetch("jobs").select { |_id, job| job.to_s.include?("reset-staging") }.keys
    assert_equal ["stage"], holders
  end

  def test_no_affected_package_filter
    refute_match(/needs\.plan|fromJSON/, @cd.to_s)
  end

  def test_only_read_only_observation_and_receipt_upload_follow_smoke
    %w[stage promote-production].each do |job|
      after = steps(job).drop(position(job, "Smoke the release") + 1)
      assert_equal 2, after.length
      assert_equal "Record observed deployment identities", after.first["name"]
      assert_match %r{\Aactions/upload-artifact@}, after.last["uses"]
      refute_match(/wrangler deploy|publish-services|migrate-through-worker|command.*up/, after.to_s)
    end
  end
end
