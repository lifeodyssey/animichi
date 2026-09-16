# SUT: cd.yml dispatch selects an artifact while execution uses the trusted main controller.
require "minitest/autorun"
require "psych"

class CdSelectionTest < Minitest::Test
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

  # The only step this contract lets precede checkout is the repository's variable
  # refusal: it declares no action and no inputs, and its `run` is nothing but the
  # `for key in NAME` guard loop, so it cannot fetch code or touch the workspace.
  # Every other step must follow the checkout that fixes the tree under test.
  def refusal_only?(step)
    return false unless step["uses"].nil? && step["with"].nil?
    lines = step["run"].to_s.lines.map(&:strip).reject(&:empty?)
    lines.length == 3 && lines[0].match?(/\Afor key in [A-Z0-9_ ]+; do\z/) &&
      lines[1] == '[ -n "${!key:-}" ] || { echo "::error::$key is missing"; exit 1; }' &&
      lines[2] == "done"
  end

  def test_main_dispatch_is_the_only_deploy_trigger
    events = @cd["on"] || @cd[true]
    assert_equal ["workflow_dispatch"], events.keys
    assert_equal({ "description" => "Complete release snapshot artifact ID", "required" => true,
                   "type" => "string" }, events.dig("workflow_dispatch", "inputs", "artifact_id"))
  end

  def test_all_consumers_use_main_controller_code_with_repository_identity
    %w[select stage promote-production].each do |job|
      assert_includes @cd.dig("jobs", job, "if"), "github.repository == 'lifeodyssey/animichi'"
      assert_includes @cd.dig("jobs", job, "if"), "github.ref == 'refs/heads/main'"
      checkout = steps(job).index { |step| step["uses"].to_s.start_with?("actions/checkout@") }
      refute_nil checkout, "#{job}: the job must check out the main controller code"
      assert_equal "${{ github.sha }}", steps(job).fetch(checkout).dig("with", "ref")
      assert_equal 0, steps(job).fetch(checkout).dig("with", "fetch-depth")
      assert_empty steps(job).take(checkout).reject { |step| refusal_only?(step) },
                   "#{job}: nothing that could fetch code or change the tree may run before checkout"
      assert_equal "read", @cd.dig("jobs", job, "permissions", "actions")
      assert_equal "ruby .github/scripts/release/resolve.rb", step(job, "Resolve the selected artifact")["run"]
    end
  end

  def test_selection_outputs_and_revalidation_bind_the_same_digest
    assert_equal %w[artifact_digest artifact_id source_sha], @cd.dig("jobs", "select", "outputs").keys.sort
    %w[stage promote-production].each do |job|
      resolve = step(job, "Resolve the selected artifact")
      assert_equal "${{ inputs.artifact_id }}", resolve.dig("env", "ARTIFACT_ID")
      assert_equal "${{ needs.select.outputs.artifact_digest }}", resolve.dig("env", "EXPECTED_DIGEST")
    end
  end

  def test_snapshot_and_native_config_verification_precede_credentials
    %w[stage promote-production].each do |job|
      login = position(job, "Log into Pulumi Cloud")
      assert_operator position(job, "Verify the selected snapshot"), :<, login
      assert_operator position(job, "Verify selected deploy configurations"), :<, login
    end
  end
end
