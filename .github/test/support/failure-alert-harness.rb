# frozen_string_literal: true
# The shared driver for the failure-alert contracts (#678 AC1): it installs the
# committed `gh` stub, writes a run's jobs payload, and runs the committed alerter
# against it. A case then asserts on the alert that was actually published instead
# of on a double of the code under test, so the three mutations an operator
# depends on — fail once, fail again on the same cause, come back green — are
# driven for real.
#
# Not a `*.test.rb`, so `workflow-invocations.test.rb` does not ask PR verification
# to invoke it; both contracts below `require_relative` it instead.
require "minitest/autorun"
require "json"
require "open3"
require "fileutils"
require "tmpdir"

class FailureAlertCase < Minitest::Test
  WORKFLOW = "CD"
  SELF_JOB = "Ops / failure alert"
  REPO = "lifeodyssey/animichi"
  SERVER = "https://github.com"
  # A fixture value, not a credential: it exists so a case can prove the token the
  # step is handed never reaches a payload, an output or the recorded calls.
  TOKEN = "fixture-gh-token"
  API_VERSION = "X-GitHub-Api-Version: 2026-03-10"
  RUN_ID = 35_045_881_568
  OTHER_RUN_ID = 35_012_593_842
  HEAD_SHA = "c3b5f3a61b81532e1a5221d4c30252a03fd6f4b2"
  STARTED = "2026-09-16T01:54:03Z"
  # The failure surface of run 35045881568 (read from the repository's own API).
  STEP = "Record observed deployment identities"

  def setup
    root = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../../..", __dir__))
    @script = File.join(root, ".github/scripts/alert/failure-alert.rb")
    @dir = Dir.mktmpdir("failure-alert-")
    @bin = File.join(@dir, "bin")
    @fixtures = File.join(@dir, "fixtures")
    FileUtils.mkdir_p([@bin, @fixtures])
    FileUtils.cp(File.join(root, ".github/test/fixtures/failure-alert/gh-stub.rb"), File.join(@bin, "gh"))
    FileUtils.chmod(0o755, File.join(@bin, "gh"))
    @calls = File.join(@dir, "calls.jsonl")
    @state = File.join(@dir, "issues.json")
  end

  def teardown
    FileUtils.remove_entry(@dir)
  end

  def failed(name, step = STEP)
    { "name" => name, "conclusion" => "failure", "steps" => [{ "name" => step, "conclusion" => "failure" }] }
  end

  def concluded(name, conclusion)
    { "name" => name, "conclusion" => conclusion, "steps" => [] }
  end

  def staging_failure(job: "CD / staging")
    [concluded("CD / select artifact", "success"), failed(job), concluded("CD / production", "skipped"),
     concluded(SELF_JOB, nil)]
  end

  def restored
    [concluded("CD / select artifact", "success"), concluded("CD / staging", "success"), concluded(SELF_JOB, nil)]
  end

  def scenario(jobs, run_id: RUN_ID, attempt: 1)
    run = { "id" => run_id, "name" => WORKFLOW, "event" => "workflow_dispatch", "run_attempt" => attempt,
            "head_sha" => HEAD_SHA, "run_started_at" => STARTED }
    File.write(File.join(@fixtures, "jobs.json"), JSON.generate("total_count" => jobs.length, "jobs" => jobs))
    File.write(File.join(@fixtures, "run.json"), JSON.generate(run))
  end

  def alert(run_id: RUN_ID, attempt: 1, refusal: "", repo: REPO, drop_assignees: false)
    environment = { "PATH" => "#{@bin}:#{ENV.fetch('PATH')}", "GH_TOKEN" => TOKEN, "GITHUB_REPOSITORY" => repo,
                    "GITHUB_WORKFLOW" => WORKFLOW, "GITHUB_REF_NAME" => "main", "GITHUB_RUN_ID" => run_id.to_s,
                    "GITHUB_RUN_ATTEMPT" => attempt.to_s, "GITHUB_SERVER_URL" => SERVER,
                    "ALERT_SELF_JOB" => SELF_JOB, "ALERT_FIXTURES" => @fixtures, "ALERT_CALLS" => @calls,
                    "ALERT_STATE" => @state, "ALERT_STUB_FAIL" => refusal,
                    "ALERT_STUB_DROP_ASSIGNEES" => drop_assignees ? "1" : "" }
    Open3.capture3(environment, "ruby", @script, unsetenv_others: true)
  end

  def issues
    File.exist?(@state) ? JSON.parse(File.read(@state)).fetch("issues") : []
  end

  def seed(open_issues)
    File.write(@state, JSON.generate("issues" => open_issues, "next" => 901))
  end

  def calls
    File.exist?(@calls) ? File.readlines(@calls).map { |line| JSON.parse(line) } : []
  end

  def writes
    calls.select { |call| call.include?("POST") || call.include?("PATCH") }
  end

  def only_alert
    assert_equal 1, issues.length, "a failing run must publish exactly one alert"
    issues.first
  end

  def ledger_read
    calls.find { |call| call.join(" ").include?("/issues?") }.join(" ")
  end
end
