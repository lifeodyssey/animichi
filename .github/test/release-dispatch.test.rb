# SUT: release-build.yml dispatches the CD controller for its own main snapshot after a successful build.
require "minitest/autorun"
require "psych"

class ReleaseDispatchTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  DISPATCH = "Dispatch CD for this snapshot"

  def setup
    @build = Psych.safe_load(File.read(File.join(ROOT, ".github/workflows/release-build.yml")), aliases: true)
    @job = @build.fetch("jobs").fetch("dispatch-cd")
  end

  def dispatch
    @job.fetch("steps").find { |step| step["name"] == DISPATCH }.tap { |step| refute_nil step, DISPATCH }
  end

  def test_dispatch_runs_only_for_a_successful_main_snapshot
    assert_equal ["snapshot"], @job["needs"]
    guard = @job["if"].to_s
    assert_includes guard, "github.repository == 'lifeodyssey/animichi'"
    assert_includes guard, "github.ref == 'refs/heads/main'"
    assert_includes guard, "needs.snapshot.result == 'success'"
  end

  # #1717: the snapshot job holds no OIDC identity — the ESC step was its only consumer, so
  # re-adding the permission without one is a standing grant and fails here.
  def test_dispatch_job_holds_only_actions_write
    assert_equal({ "actions" => "write" }, @job["permissions"])
    snapshot = @build.dig("jobs", "snapshot", "permissions")
    assert_equal({ "contents" => "read" }, snapshot)
  end

  def test_dispatch_passes_the_snapshot_jobs_own_artifact_id
    steps = @build.dig("jobs", "snapshot", "steps")
    upload = steps.find { |step| step["id"] == "artifact" }
    refute_nil upload, "the snapshot job exposes no upload step"
    assert_match %r{\Aactions/upload-artifact@[0-9a-f]{40}\z}, upload["uses"]
    assert_equal "${{ steps.artifact.outputs.artifact-id }}", @build.dig("jobs", "snapshot", "outputs", "artifact_id")
    assert_equal "${{ needs.snapshot.outputs.artifact_id }}", dispatch.dig("env", "ARTIFACT_ID")
  end

  def test_dispatch_uses_the_official_workflow_run_command_on_main
    assert_equal "${{ github.token }}", dispatch.dig("env", "GH_TOKEN")
    assert_equal 'gh workflow run cd.yml --repo lifeodyssey/animichi --ref main -f artifact_id="$ARTIFACT_ID"',
                 dispatch["run"]
  end
end
