# SUT: each CD environment reads the three catalog tables back from ITS OWN
# migrator after the selected chain applies (#1230 Phase 1). The check exists
# because production held zero catalog tables while staging held three, and a
# release that verifies the wrong environment's schema would have reported that
# as green.
require "minitest/autorun"
require "psych"

class CdSchemaVerificationTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CD_FILE = File.join(ROOT, ".github", "workflows", "cd.yml")
  SCRIPT = "scripts/delivery/verify-catalog-schema.sh"
  TARGETS = { "stage" => ["staging", "vars.MIGRATOR_STAGING_URL"],
              "promote-production" => ["production", "vars.MIGRATOR_PRODUCTION_URL"] }.freeze

  def setup
    @cd = Psych.safe_load(File.read(CD_FILE), aliases: true)
  end

  def steps(job)
    @cd.fetch("jobs").fetch(job).fetch("steps")
  end

  def verification_step(job, environment)
    steps(job).find { |step| step["run"] == "bash #{SCRIPT} #{environment}" }
  end

  def test_every_environment_verifies_its_own_promoted_catalog_schema
    TARGETS.each do |job, (environment, variable)|
      step = verification_step(job, environment)
      refute_nil step, "cd.yml:#{job}: must run `bash #{SCRIPT} #{environment}`"
      assert step.dig("env", "MIGRATOR_URL").to_s.include?(variable),
             "cd.yml:#{job}: the #{environment} catalog must be read through #{variable}, not another environment's"
    end
  end

  def test_the_verification_is_not_skipped_and_owns_the_migrator_url
    TARGETS.each do |job, (environment, variable)|
      step = verification_step(job, environment)
      # Named here too, not left to the other test: a removed step would
      # otherwise fail this one with a bare NoMethodError on nil.
      refute_nil step, "cd.yml:#{job}: must run `bash #{SCRIPT} #{environment}`"
      refute step.key?("if"), "cd.yml:#{job}: the #{environment} schema check must not be conditional"
      assert_equal variable, step.dig("env", "MIGRATOR_URL").to_s[/vars\.[A-Z0-9_]+/],
                   "cd.yml:#{job}: #{environment} must be the only migrator this step reads"
    end
  end
end
