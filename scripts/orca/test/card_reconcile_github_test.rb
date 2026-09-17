# frozen_string_literal: true

require_relative "card_reconcile_fixtures"
require_relative "scripted_shell"

class ChecksTest < Minitest::Test
  def test_summarizes_check_runs_and_status_contexts
    checks = Orca::CardReconcile::CheckStates.summarize(mixed_rollup)
    assert_equal [2, 2, 2], [checks.passed, checks.failed, checks.pending]
    assert_equal false, checks.green?
    assert_equal true, checks.red?
    assert_equal "2/6 green", checks.text
  end

  private

  def mixed_rollup
    [{ "status" => "COMPLETED", "conclusion" => "SUCCESS" },
     { "status" => "COMPLETED", "conclusion" => "SKIPPED" },
     { "status" => "IN_PROGRESS", "conclusion" => nil },
     { "state" => "PENDING" },
     { "status" => "COMPLETED", "conclusion" => "FAILURE" },
     { "state" => "ERROR" }]
  end
end

class GitHubFactsTest < Minitest::Test
  include ReconcileFixtures

  PR = { "number" => 1711, "state" => "OPEN", "mergeStateStatus" => "BLOCKED",
         "headRefName" => "lifeodyssey/orca-1601-ac5", "headRefOid" => SHA,
         "baseRefName" => "main", "updatedAt" => "2026-09-16T19:00:00Z",
         "statusCheckRollup" => [{ "status" => "COMPLETED", "conclusion" => "SUCCESS" }],
         "files" => [{ "path" => "a.ts" }, { "path" => "pnpm-lock.yaml" }] }.freeze

  def test_lists_open_pull_requests_with_checks_files_and_state
    facts = github("gh pr list --repo lifeodyssey/animichi --state open" => JSON.generate([PR]))
    pull = facts.open_pull_requests.first
    assert_equal 1711, pull.number
    assert_equal "BLOCKED", pull.merge_state
    assert_equal ["a.ts", "pnpm-lock.yaml"], pull.files
    assert_equal false, pull.files_truncated
    assert_equal true, pull.open?
    assert_equal Time.utc(2026, 9, 16, 19), pull.updated_at
  end

  def test_marks_a_file_list_at_the_api_cap_as_truncated
    item = PR.merge("files" => Array.new(100) { |index| { "path" => "f#{index}" } })
    facts = github("gh pr list --repo lifeodyssey/animichi --state open" => JSON.generate([item]))
    assert_equal true, facts.open_pull_requests.first.files_truncated
  end

  def test_counts_only_unresolved_review_threads
    payload = { "data" => { "repository" => { "pullRequest" => { "reviewThreads" => {
      "nodes" => [{ "isResolved" => true }, { "isResolved" => false }] } } } } }
    facts = github("gh api graphql" => JSON.generate(payload))
    assert_equal 1, facts.unresolved_threads(1711)
  end

  # An unavailable thread read is unknown, never zero: the merge ladder needs the count, and a
  # failed source must not read as a clear review.
  def test_a_failed_thread_read_is_unknown_not_zero
    notes = []
    facts = Orca::CardReconcile::GitHubFacts.new(failing_graphql, "lifeodyssey/animichi", notes)
    assert_nil facts.unresolved_threads(1711)
    assert_equal 1, notes.length
  end

  def test_merged_heads_indexes_the_head_sha_of_each_merged_pull_request
    items = [{ "headRefName" => "lifeodyssey/orca-1601-ac5", "headRefOid" => SHA }]
    facts = github("gh pr list --repo lifeodyssey/animichi --state merged" => JSON.generate(items))
    assert_equal({ SHA => "lifeodyssey/orca-1601-ac5" }, facts.merged_heads)
  end

  def test_a_failed_gh_call_reports_an_unknown_pull_request_list
    notes = []
    facts = Orca::CardReconcile::GitHubFacts.new(failing_command, "lifeodyssey/animichi", notes)
    assert_nil facts.open_pull_requests
    assert_equal 1, notes.length
  end

  private

  def github(responses)
    Orca::CardReconcile::GitHubFacts.new(Orca::CardReconcile::Command.new(ScriptedShell.new(responses)),
                                        "lifeodyssey/animichi", [])
  end

  def failing_command
    Orca::CardReconcile::Command.new(
      ScriptedShell.new("gh pr list" => Orca::CardReconcile::Command::Result.new("", "boom", 1))
    )
  end

  def failing_graphql
    Orca::CardReconcile::Command.new(
      ScriptedShell.new("gh api graphql" => Orca::CardReconcile::Command::Result.new("", "boom", 1))
    )
  end
end
