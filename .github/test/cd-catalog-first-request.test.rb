# SUT: cd.yml times catalog's first database request in the staging job: one step, right after
# the smoke, that runs the probe once against the origin the smoke probes, with nothing beside it
# that could retry it or survive its failure. The production job has no such step.
require "minitest/autorun"
require_relative "repository-yaml"

class CdCatalogFirstRequestTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CD_FILE = File.join(ROOT, ".github/workflows/cd.yml")
  SMOKE_SCRIPT = File.join(ROOT, ".github/scripts/staging-smoke-check.sh")
  PROBE = "bash .github/scripts/catalog-first-request.sh"
  # The staging edge origin, spelled once on the job for every step after the smoke that needs it.
  ORIGIN = "STAGING_EDGE_URL"
  SMOKE_STEP = "Smoke the release"

  def setup
    @cd = RepositoryYaml.load_file(CD_FILE)
  end

  def steps(job)
    @cd.fetch("jobs").fetch(job).fetch("steps")
  end

  # Found by what a step runs, not by its name, so a renamed copy is still found.
  def probe_steps(job)
    steps(job).select { |step| step["run"].to_s.include?(PROBE) }
  end

  def smoke_position
    steps("stage").index { |step| step["name"] == SMOKE_STEP }
  end

  def test_only_the_staging_job_runs_the_probe
    holders = @cd.fetch("jobs").select { |_id, job| job.to_s.include?(PROBE) }.keys
    assert_equal ["stage"], holders, "production's showcase mode answers the public catalog route 403"
  end

  def test_one_step_runs_the_probe_right_after_the_smoke
    assert_equal 1, probe_steps("stage").length
    assert_equal smoke_position + 1, steps("stage").index(probe_steps("stage").first),
                 "a step between the smoke and the probe could reach catalog first and warm it"
  end

  def test_the_probe_is_the_whole_step
    step = probe_steps("stage").first
    assert_equal %(#{PROBE} "$#{ORIGIN}"), step["run"].to_s.strip
    assert_empty step.keys - %w[name run],
                 "an `if`, a retrying action or `continue-on-error` beside the run changes what decides"
  end

  def test_the_probe_reaches_the_origin_the_smoke_probes
    smoke_origin = steps("stage")[smoke_position]["run"].split[2]
    assert_equal smoke_origin, @cd.dig("jobs", "stage", "env", ORIGIN)
  end

  def test_the_shared_smoke_script_requests_no_catalog_route
    refute_includes File.read(SMOKE_SCRIPT), "/catalog/",
                    "production runs the same smoke script, and a catalog request in it would warm catalog first"
  end
end
