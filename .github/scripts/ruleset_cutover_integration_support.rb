# frozen_string_literal: true

require "json"
require "open3"

module RulesetCutoverIntegrationSupport
  def fail_integration(message)
    abort "FAIL: #{message}"
  end

  def assert(condition, message)
    fail_integration(message) unless condition
  end

  def assert_error(fragment)
    yield
    fail_integration "expected #{fragment.inspect}"
  rescue RulesetCutover::Error => error
    assert(error.message.include?(fragment), "expected #{fragment.inspect}, got #{error.message.inspect}")
  end

  def workflow_run(id, event, sha, branch, path)
    { "id" => id, "event" => event, "head_sha" => sha, "head_branch" => branch, "path" => path,
      "status" => "completed", "conclusion" => "success", "repository" => { "full_name" => "example/repo" } }
  end

  def ruleset
    {
      "id" => 42, "name" => "protect main", "target" => "branch", "source_type" => "Repository",
      "enforcement" => "active",
      "bypass_actors" => [{ "actor_id" => 7, "actor_type" => "User", "bypass_mode" => "always" }],
      "conditions" => { "ref_name" => { "include" => ["~DEFAULT_BRANCH"], "exclude" => [] } },
      "rules" => [
        { "type" => "deletion" },
        { "type" => "pull_request", "parameters" => {
          "dismiss_stale_reviews_on_push" => false, "require_code_owner_review" => false,
          "require_last_push_approval" => false, "required_approving_review_count" => 0,
          "required_review_thread_resolution" => false
        } },
        { "type" => "required_status_checks", "parameters" => {
          "strict_required_status_checks_policy" => true,
          "required_status_checks" => [{ "context" => "Web / test" }, { "context" => "Security / Semgrep" }]
        } },
        { "type" => "code_quality", "parameters" => { "severity" => "all" } }
      ]
    }
  end

  class GitHubApiHarness
    attr_accessor :leave_native
    attr_reader :api, :before, :calls, :put_count, :pr_head, :merge_head

    def initialize(test_context)
      @test_context = test_context
      @before = test_context.ruleset
      @calls = []
      @put_count = 0
      @awaiting_after = false
      @leave_native = false
      @pr_head = "a" * 40
      @merge_head = "b" * 40
      @default_head = "d" * 40
      @api = build_api
    end

    def install
      @original_capture3 = Open3.method(:capture3)
      harness = self
      Open3.define_singleton_method(:capture3) { |*command| harness.capture3(command) }
    end

    def restore
      Open3.define_singleton_method(:capture3, @original_capture3)
    end

    def capture3(command)
      @calls << command
      return handle_put(command) if command.include?("-X")

      path = command.fetch(2)
      response = response_for(path)
      raise "unexpected mocked GitHub API path: #{path}" unless response

      [JSON.generate(response), "", Struct.new(:success?).new(true)]
    end

    private

    def handle_put(command)
      @put_count += 1
      @awaiting_after = true
      payload = JSON.parse(File.read(command.fetch(command.index("--input") + 1)))
      checks = payload.fetch("rules").map { |rule| rule.dig("parameters", "required_status_checks") }.compact
      @test_context.assert(checks.include?(RulesetCutover::REQUIRED_CHECKS),
                           "PUT must carry all approved contexts")
      pull = payload.fetch("rules").find { |rule| rule["type"] == "pull_request" }
      @test_context.assert(pull.dig("parameters", "required_review_thread_resolution") == true,
                           "PUT must require native review-thread resolution")
      @test_context.assert(payload.fetch("rules").none? { |rule| RulesetCutover::RETIRED_RULE_TYPES.include?(rule["type"]) },
                           "PUT must remove unavailable native quality rules")
      ["{}", "", Struct.new(:success?).new(true)]
    end

    def response_for(path)
      response = @api[path]
      response = @before if path == "repos/example/repo/rulesets/42"
      response = { "check_runs" => [] } if !response && path.end_with?("/check-runs?per_page=100")
      return response unless path == "repos/example/repo/rulesets/42" && @awaiting_after

      @awaiting_after = false
      after = RulesetCutover.candidate(@before)
      after["rules"] << { "type" => "code_quality", "parameters" => { "severity" => "all" } } if @leave_native
      after["rules"] = after.fetch("rules").reverse
      after
    end

    def build_api
      ci_path = RulesetCutover::PRODUCER_PATHS.fetch("CI / verify")
      review_path = RulesetCutover::PRODUCER_PATHS.fetch("Review Gate")
      {
        "repos/example/repo" => { "default_branch" => "main" },
        "repos/example/repo/pulls/999" => { "state" => "open", "head" => { "sha" => @pr_head }, "base" => { "ref" => "main" } },
        "repos/example/repo/actions/runs/501" => @test_context.workflow_run(501, "pull_request", @pr_head, "feature", ci_path),
        "repos/example/repo/actions/runs/502" => @test_context.workflow_run(502, "merge_group", @merge_head, "gh-readonly-queue/main/pr-999", ci_path),
        "repos/example/repo/actions/runs/601" => @test_context.workflow_run(601, "pull_request_target", @default_head, "main", review_path),
        "repos/example/repo/actions/runs/602" => @test_context.workflow_run(602, "workflow_run", @default_head, "main", review_path),
        "repos/example/repo/commits/#{@pr_head}/check-runs?per_page=100" => check_runs(701, @pr_head, 501),
        "repos/example/repo/commits/#{@merge_head}/check-runs?per_page=100" => check_runs(702, @merge_head, 502),
        "repos/example/repo/commits/#{@pr_head}/statuses?per_page=100" => statuses(801, @pr_head, 601),
        "repos/example/repo/commits/#{@merge_head}/statuses?per_page=100" => statuses(802, @merge_head, 602)
      }
    end

    def check_runs(id, sha, run_id)
      { "check_runs" => [{ "id" => id, "name" => "CI / verify", "head_sha" => sha, "status" => "completed",
                           "conclusion" => "success", "details_url" => "https://github.com/example/repo/actions/runs/#{run_id}/job/1",
                           "app" => { "slug" => "github-actions" } }] }
    end

    def statuses(id, sha, run_id)
      [{ "id" => id, "context" => "Review Gate", "state" => "success", "sha" => sha,
         "target_url" => "https://github.com/example/repo/actions/runs/#{run_id}/attempts/1",
         "creator" => { "login" => "github-actions[bot]", "type" => "Bot" } }]
    end
  end
end
