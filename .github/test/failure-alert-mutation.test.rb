# SUT: failure-alert.test.rb against mutations of the wiring it guards (#678
# AC1). Every probe copies the workflows, the scripts and the libraries into a
# throwaway root, mutates the copy and runs the contract there; the committed
# tree is never written. A probe that survives is a guard that would pass with
# its subject deleted (the five the repository had shipped before #1687).
require "minitest/autorun"
require "psych"
require "json"
require "open3"
require "fileutils"
require "tmpdir"

class FailureAlertMutationTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  # Named contract sets, so each probe asserts the contract that owns the
  # invariant it breaks, and a probe says which gate it relies on.
  WIRING = %w[failure-alert.test.rb].freeze
  LEDGER = %w[failure-alert-ledger.test.rb].freeze
  # The wiring contract compares the step's `run` string, which still names a file
  # that has been deleted; only the executed contracts notice that.
  WHOLE = %w[failure-alert.test.rb failure-alert-behavior.test.rb failure-alert-ledger.test.rb].freeze
  MISSING_WORKFLOWS = "no unattended workflow"
  MUST_ALERT = "a run that fails must alert"
  MUST_RUN_ON_FAILURE = "must run on a failure only"
  RUN_AFTER_FAILURE = "must run even though a dependency failed"
  LEAST_PRIVILEGE = "publishes issues and reads the run"
  RUN_TOKEN = "no secret context, and no new credential"
  EVERY_JOB = "a failure in any job must reach"
  NO_ALERTER = "no step invokes the alerter"
  PR_FAILURE = "already on the pull request"
  CREDENTIAL = "a new name is a new credential path"
  PER_KEY_GROUP = "must serialize per workflow, not per run"
  NO_ENTRY = "failure-alert.rb"
  # `require_relative` reports the missing file without its extension.
  NO_LEDGER = "lib/alert/plan"
  NO_CONFIG = "must not name a label that has to exist first"
  # The repository has no `failure-alert` label, and `POST /issues` rejects an
  # unknown label with 422 — so naming one would silence the alert at exactly the
  # moment a deploy broke. The needle and its replacement are single-quoted: the
  # `#{repo}` in the source has to stay literal.
  CONFIGURE_LABEL = [[%q{send_json('POST', "repos/#{repo}/issues", payload)},
                      %q{send_json('POST', "repos/#{repo}/issues", payload.merge('labels' => ['failure-alert']))}]].freeze

  # Everything the two contracts read: the workflows they assert on, the scripts
  # and libraries the behavior contract executes, and the `gh` stub it runs
  # against. The contract files come from the committed tree; only
  # TEST_REPOSITORY_ROOT moves.
  def with_root
    Dir.mktmpdir("failure-alert-mutation-") do |dir|
      FileUtils.mkdir_p(File.join(dir, ".github/test"))
      %w[workflows scripts lib].each do |part|
        FileUtils.cp_r(File.join(ROOT, ".github", part), File.join(dir, ".github", part))
      end
      FileUtils.cp_r(File.join(ROOT, ".github/test/fixtures"), File.join(dir, ".github/test/fixtures"))
      yield dir
    end
  end

  def run_check(dir, name)
    out, err, status = Open3.capture3({ "TEST_REPOSITORY_ROOT" => dir }, RbConfig.ruby,
                                      File.join(ROOT, ".github/test", name))
    [name, out + err, status]
  end

  # The diagnostics of whichever named contracts the copy now fails.
  def contract(dir, checks)
    checks.map { |name| run_check(dir, name) }
          .reject { |_name, _message, status| status.success? }
          .map { |name, message, _status| "#{name}\n#{message}" }
          .join("\n")
  end

  def probe(label, consequence, checks: WIRING)
    with_root do |dir|
      yield dir
      message = contract(dir, checks)
      refute_empty message, "mutation survived: #{label}"
      assert_includes message, consequence, "mutation must name its consequence: #{label}"
    end
  end

  def mutate(dir, file)
    path = File.join(dir, ".github/workflows", file)
    source = File.read(path)
    document = Psych.safe_load(source, aliases: true)
    yield document
    changed = Psych.dump(document)
    refute_equal source, changed, "mutation needle missing: #{file}"
    File.write(path, changed)
  end

  def test_rejects_a_deploy_workflow_that_forgot_to_alert
    probe("cd.yml without the alert job", MUST_ALERT) { |dir| mutate(dir, "cd.yml") { |doc| doc.fetch("jobs").delete("alert-failure") } }
  end

  def test_rejects_a_release_build_that_forgot_to_alert
    probe("release-build.yml without the alert job", MUST_ALERT) do |dir|
      mutate(dir, "release-build.yml") { |doc| doc.fetch("jobs").delete("alert-failure") }
    end
  end

  def test_rejects_an_alert_with_no_failure_test_in_its_condition
    probe("alert-failure gated on always() alone", MUST_RUN_ON_FAILURE) do |dir|
      mutate(dir, "cd.yml") { |doc| doc.dig("jobs", "alert-failure")["if"] = "${{ always() }}" }
    end
  end

  def test_rejects_an_alert_that_a_failed_dependency_would_skip
    probe("alert-failure gated without always()", RUN_AFTER_FAILURE) do |dir|
      mutate(dir, "cd.yml") do |doc|
        doc.dig("jobs", "alert-failure")["if"] = "${{ contains(needs.*.result, 'failure') }}"
      end
    end
  end

  def test_rejects_an_alert_that_could_not_open_an_issue
    probe("alert-failure without issues: write", LEAST_PRIVILEGE) do |dir|
      mutate(dir, "release-build.yml") { |doc| doc.dig("jobs", "alert-failure", "permissions")["issues"] = "read" }
    end
  end

  def test_rejects_an_alert_that_was_not_handed_the_run_token
    probe("alert-failure without the run token", RUN_TOKEN) do |dir|
      mutate(dir, "cd.yml") { |doc| doc.dig("jobs", "alert-failure", "steps").last.fetch("env").delete("GH_TOKEN") }
    end
  end

  def test_rejects_an_alert_that_missed_a_sibling_job
    probe("alert-failure needs only some of the workflow", EVERY_JOB) do |dir|
      mutate(dir, "release-build.yml") { |doc| doc.dig("jobs", "alert-failure")["needs"] = ["snapshot"] }
    end
  end

  def test_rejects_a_step_that_calls_something_else
    probe("alert-failure invoking another script", NO_ALERTER) do |dir|
      mutate(dir, "cd.yml") { |doc| doc.dig("jobs", "alert-failure", "steps").last["run"] = "ruby .github/scripts/nothing.rb" }
    end
  end

  # The workflow is unattended now (#1715), so the probe can no longer be the
  # alert's absence: it is the gate that keeps the alert off the pull-request
  # event, which is the property the consequence names.
  def test_rejects_alerting_on_pull_request_failures
    probe("pr-verification.yml alerting on a pull request failure", PR_FAILURE) do |dir|
      mutate(dir, "pr-verification.yml") do |doc|
        doc.dig("jobs", "alert-failure")["if"] = "${{ always() && contains(needs.*.result, 'failure') }}"
      end
    end
  end

  def test_rejects_an_alerter_reading_a_new_credential
    probe("a library reading an undeclared environment name", CREDENTIAL) do |dir|
      path = File.join(dir, ".github/lib/alert/api.rb")
      File.write(path, "#{File.read(path)}\nSLACK = ENV.fetch('SLACK_WEBHOOK')\n")
    end
  end

  def test_rejects_an_alert_that_a_second_run_could_race_into_a_duplicate
    probe("alert-failure grouped per run instead of per key", PER_KEY_GROUP) do |dir|
      mutate(dir, "cd.yml") do |doc|
        doc.dig("jobs", "alert-failure", "concurrency")["group"] = "ops-alert-${{ github.run_id }}"
      end
    end
  end

  def test_rejects_a_tree_whose_alerter_was_deleted
    probe("the alerter entry removed", NO_ENTRY, checks: WHOLE) do |dir|
      FileUtils.rm(File.join(dir, ".github/scripts/alert/failure-alert.rb"))
    end
  end

  def test_rejects_a_tree_whose_dedup_ledger_was_deleted
    probe("the dedup ledger removed", NO_LEDGER, checks: WHOLE) do |dir|
      FileUtils.rm(File.join(dir, ".github/lib/alert/plan.rb"))
    end
  end

  def test_rejects_an_alert_that_names_a_label_the_repository_must_configure
    probe("create_issue sending a label the repository does not have", NO_CONFIG, checks: LEDGER) do |dir|
      path = File.join(dir, ".github/lib/alert/api.rb")
      needle, replacement = CONFIGURE_LABEL.first
      source = File.read(path)
      refute_nil source[needle], "mutation needle missing: api.rb"
      File.write(path, source.sub(needle, replacement))
    end
  end

  def test_rejects_a_root_with_no_workflows_to_guard
    with_root do |dir|
      FileUtils.rm_rf(File.join(dir, ".github/workflows"))
      message = contract(dir, WIRING)
      refute_empty message, "mutation survived: an empty workflow tree"
      assert_includes message, MISSING_WORKFLOWS, "mutation must name its consequence: an empty workflow tree"
    end
  end
end
