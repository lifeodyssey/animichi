# SUT: .github/workflows/production-topology.yml — the owner-dispatched production topology run
# (ADR 0010). It selects and verifies a snapshot and that snapshot's staging receipt, previews the
# prod stack's topology into the job summary, and applies it only when the dispatch asks, under its
# own concurrency group and a refusal while a full promotion is running. It deploys, migrates,
# publishes and records nothing else.
require "minitest/autorun"
require_relative "repository-yaml"

class ProductionTopologyTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CHECK = "ruby .github/scripts/release/refuse-during-promotion.rb"
  REFUSE = "Refuse while a full promotion is running"
  RECEIPT = ["Resolve the staging receipt", "Download the staging receipt", "Verify the staging receipt"].freeze
  SELECT = ["actions/checkout", "ruby/setup-ruby", REFUSE, "Resolve the selected artifact",
            "Verify the selected snapshot", *RECEIPT].freeze
  APPLY = ["actions/checkout", "ruby/setup-ruby", "Resolve the selected artifact", "Verify the selected snapshot",
           *RECEIPT, "pnpm/action-setup", "actions/setup-node", "pnpm install --frozen-lockfile --ignore-scripts",
           "Verify selected deploy configurations", "pulumi/actions", "Log into Pulumi Cloud",
           "Open the environment configuration", "Require environment credentials",
           "Install sealed foundation dependencies", "Preview topology", REFUSE, "Apply topology"].freeze
  # What the full promotion does and this workflow never does. It is matched in the parsed workflow,
  # so a comment that names one is not a hit.
  FORBIDDEN = /wrangler|publish-services|call-migrator|database-access|pulumi\ install|reset-staging|retire-|
               record-receipt|record-evidence|upload-artifact|smoke|MIGRATOR_|NEON_API_KEY|cd-production|queue/x
  TOPOLOGY = { "stack-name" => "lifeodyssey/prod", "work-dir" => "release/foundation/infra" }.freeze

  def setup
    @workflow = RepositoryYaml.load_file(File.join(ROOT, ".github/workflows/production-topology.yml"))
    @cd = RepositoryYaml.load_file(File.join(ROOT, ".github/workflows/cd.yml"))
  end

  def job(id)
    @workflow.fetch("jobs").fetch(id)
  end

  def steps(id)
    job(id).fetch("steps")
  end

  # A step's name, else the action it uses without its pin, else its command.
  def label(step)
    step["name"] || step["uses"]&.split("@")&.first || step["run"]
  end

  def step(id, name)
    steps(id).find { |item| item["name"] == name }.tap { |item| refute_nil item, "#{id}: #{name}" }
  end

  def position(id, name)
    steps(id).index(step(id, name))
  end

  def inputs
    RepositoryYaml.triggers(@workflow).dig("workflow_dispatch", "inputs")
  end

  def test_only_a_dispatch_naming_a_snapshot_and_its_receipt_starts_it
    assert_equal ["workflow_dispatch"], RepositoryYaml.triggers(@workflow).keys
    assert_equal %w[artifact_id staging_receipt_id apply show_diff], inputs.keys
    assert_equal RepositoryYaml.triggers(@cd).dig("workflow_dispatch", "inputs", "artifact_id"), inputs.fetch("artifact_id")
    assert_equal({ "required" => true, "type" => "string" }, inputs.fetch("staging_receipt_id").slice("required", "type"))
  end

  def test_a_dispatch_that_does_not_ask_to_apply_only_previews
    assert_equal({ "required" => false, "type" => "boolean", "default" => false },
                 inputs.fetch("apply").slice("required", "type", "default"))
  end

  # The log is public: the preview prints property values only when the dispatch asks for them, and
  # the input that asks is read nowhere else.
  def test_the_preview_prints_values_only_when_the_dispatch_asks
    assert_equal({ "required" => false, "type" => "boolean", "default" => false },
                 inputs.fetch("show_diff").slice("required", "type", "default"))
    assert_equal "${{ inputs.show_diff }}", step("apply-topology", "Preview topology").dig("with", "diff")
    assert_equal 1, @workflow.fetch("jobs").to_s.scan("inputs.show_diff").length
  end

  def test_neither_pulumi_step_prints_stack_outputs
    ["Preview topology", "Apply topology"].each do |name|
      assert_equal true, step("apply-topology", name).dig("with", "suppress-outputs"), name
    end
  end

  def test_the_jobs_are_selection_the_approved_apply_and_the_alert
    assert_equal %w[select apply-topology alert-failure], @workflow.fetch("jobs").keys
    assert_equal "${{ github.repository == 'lifeodyssey/animichi' && github.ref == 'refs/heads/main' }}",
                 job("select").fetch("if")
    assert_equal "${{ !failure() && !cancelled() && github.repository == 'lifeodyssey/animichi' && " \
                 "github.ref == 'refs/heads/main' && needs.select.result == 'success' }}",
                 job("apply-topology").fetch("if")
    assert_equal ["select"], job("apply-topology").fetch("needs")
    assert_includes job("apply-topology").fetch("if"), "needs.select.result == 'success'"
  end

  def test_apply_waits_for_the_production_approval_in_its_own_group
    assert_equal "production", job("apply-topology").fetch("environment")
    assert_equal({ "group" => "production-topology", "cancel-in-progress" => false },
                 job("apply-topology").fetch("concurrency"))
    refute job("select").key?("environment"), "select refuses a bad dispatch before any approval prompt"
    refute @workflow.key?("concurrency")
  end

  def test_each_job_runs_exactly_its_steps_in_order
    assert_equal SELECT, steps("select").map { |item| label(item) }
    assert_equal APPLY, steps("apply-topology").map { |item| label(item) }
  end

  def test_the_promotion_check_opens_select_and_runs_immediately_before_up
    assert_equal CHECK, step("select", REFUSE).fetch("run")
    assert_operator position("select", REFUSE), :<, position("select", "Resolve the selected artifact")
    check, up = steps("apply-topology").last(2)
    assert_equal [CHECK, "Apply topology"], [check["run"], up["name"]]
    assert_equal ["${{ inputs.apply }}"] * 2, [check["if"], up["if"]]
  end

  def test_the_preview_always_reaches_the_summary_and_up_runs_only_when_asked
    preview = step("apply-topology", "Preview topology")
    assert_equal TOPOLOGY.merge("command" => "preview", "diff" => "${{ inputs.show_diff }}", "suppress-outputs" => true,
                                "comment-on-summary" => true), preview.fetch("with")
    refute preview.key?("if"), "the preview is every run's output, whether or not it applies"
    assert_equal TOPOLOGY.merge("command" => "up", "suppress-outputs" => true),
                 step("apply-topology", "Apply topology").fetch("with")
  end

  def test_nothing_deploys_migrates_publishes_or_records
    refute_match FORBIDDEN, @workflow.fetch("jobs").to_s
    commands = steps("apply-topology").select { |item| item["uses"].to_s.start_with?("pulumi/actions@") }
                                      .map { |item| item.dig("with", "command") }.compact
    assert_equal %w[preview up], commands
  end

  # Inputs and event values reach a script through `env:`. Spliced into a `run:` block, GitHub would
  # write them into the shell text before the script starts.
  def test_no_run_block_splices_an_input_or_event_value
    steps = @workflow.fetch("jobs").values.flat_map { |item| item.fetch("steps") }
    steps.filter_map { |item| item["run"] }.each do |script|
      refute_match(/\$\{\{[^}]*\b(?:inputs|github\.event)\b/, script, "pass it through env: instead: #{script}")
    end
  end

  def test_each_job_holds_only_the_permissions_it_uses
    assert_equal({ "contents" => "read" }, @workflow.fetch("permissions"))
    assert_equal({ "contents" => "read", "actions" => "read" }, job("select").fetch("permissions"))
    assert_equal({ "contents" => "read", "actions" => "read", "id-token" => "write" },
                 job("apply-topology").fetch("permissions"))
  end

  def test_every_action_is_pinned_to_the_commit_cd_pins
    pins = @cd.fetch("jobs").values.flat_map { |item| item.fetch("steps") }.map { |item| item["uses"].to_s }
              .grep(/@/).to_h { |ref| ref.split("@") }
    used = @workflow.fetch("jobs").values.flat_map { |item| item.fetch("steps") }.filter_map { |item| item["uses"] }
    (used - ["$/.github/actions/hydrate-release"]).each do |ref|
      assert_match(%r{\A[\w.-]+/[\w.-]+@[0-9a-f]{40}\z}, ref)
      assert_equal pins.fetch(ref.split("@").first), ref.split("@").last, "#{ref}: not the pin cd.yml uses"
    end
  end

  def test_production_credentials_open_only_after_everything_is_verified
    promote = @cd.dig("jobs", "promote-production", "steps")
    assert_equal promote.find { |item| item["name"] == "Log into Pulumi Cloud" }.fetch("with"),
                 step("apply-topology", "Log into Pulumi Cloud").fetch("with")
    assert_equal({ "environment" => "lifeodyssey/animichi/prod", "export-environment-variables" => "CLOUDFLARE_API_TOKEN" },
                 step("apply-topology", "Open the environment configuration").fetch("with"))
    assert_includes step("apply-topology", "Require environment credentials").fetch("run"), "for key in CLOUDFLARE_API_TOKEN; do"
    ["Verify the staging receipt", "Verify selected deploy configurations"].each do |name|
      assert_operator position("apply-topology", name), :<, position("apply-topology", "Log into Pulumi Cloud")
    end
  end

  def test_both_jobs_check_out_the_full_history_the_ancestry_check_needs
    %w[select apply-topology].each do |id|
      assert_equal({ "ref" => "${{ github.sha }}", "fetch-depth" => 0, "persist-credentials" => false },
                   steps(id).first.fetch("with"), "#{id}: a shallow clone cannot show staging's controller is an ancestor")
    end
  end

  def test_the_receipt_is_downloaded_digest_checked_from_the_run_that_produced_it
    %w[select apply-topology].each do |id|
      assert_equal ["receipt", "ruby .github/scripts/release/verify-staged-receipt.rb metadata"],
                   step(id, RECEIPT[0]).values_at("id", "run")
      assert_equal({ "artifact-ids" => "${{ inputs.staging_receipt_id }}", "run-id" => "${{ steps.receipt.outputs.run_id }}",
                     "repository" => "lifeodyssey/animichi", "github-token" => "${{ github.token }}",
                     "digest-mismatch" => "error", "path" => "staging-receipt" }, step(id, RECEIPT[1]).fetch("with"))
      assert_equal "ruby .github/scripts/release/verify-staged-receipt.rb content", step(id, RECEIPT[2]).fetch("run")
    end
  end

  def test_apply_accepts_only_what_select_verified_before_the_prompt
    assert_equal({ "artifact_digest" => "${{ steps.selection.outputs.artifact_digest }}",
                   "receipt_digest" => "${{ steps.receipt.outputs.digest }}" }, job("select").fetch("outputs"))
    assert_equal "${{ needs.select.outputs.artifact_digest }}",
                 step("apply-topology", "Resolve the selected artifact").dig("env", "EXPECTED_DIGEST")
    assert_equal "${{ needs.select.outputs.receipt_digest }}", step("apply-topology", RECEIPT[0]).dig("env", "EXPECTED_DIGEST")
  end
end
