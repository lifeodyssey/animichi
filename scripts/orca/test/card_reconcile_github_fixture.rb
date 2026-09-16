# frozen_string_literal: true

require_relative "card_reconcile_fixtures"

# The `gh pr list` items and `statusCheckRollup` shapes the pull-request tests build from: what
# GitHub reported on 2026-09-17, when every open pull request read `BLOCKED` with an empty
# `reviewDecision` while required checks were still running.
module GitHubFixture
  module_function

  # A check run while it is in progress: `conclusion` holds the empty string.
  PENDING_RUN = { "__typename" => "CheckRun", "conclusion" => "", "name" => "CI / agent",
                  "status" => "IN_PROGRESS", "workflowName" => "CI" }.freeze
  # A legacy check: a `StatusContext` entry whose state is the conclusion.
  SUCCESS_CONTEXT = { "__typename" => "StatusContext", "context" => "CodeRabbit",
                      "state" => "SUCCESS", "targetUrl" => "" }.freeze

  def pull_item(merge_state, rollup, card: 1702, head: ReconcileFixtures::SHA)
    { "number" => 1739, "state" => "OPEN", "mergeStateStatus" => merge_state,
      "headRefName" => "lifeodyssey/orca-#{card}-lane", "headRefOid" => head,
      "baseRefName" => "main", "updatedAt" => "2026-09-17T01:22:00Z", "files" => [],
      "statusCheckRollup" => rollup }
  end

  # The pull request `PullRequest.from_gh` reads, so a test's rollup goes through the same
  # classification the live run uses.
  def pull_request(merge_state, rollup, card: 1702, head: ReconcileFixtures::SHA)
    Orca::CardReconcile::PullRequest.from_gh(pull_item(merge_state, rollup, card: card, head: head))
  end

  # #1739 at 01:22Z: 28 checks green, `CI / agent` still in progress.
  def blocked_with_pending_checks(card: 1702)
    pull_request("BLOCKED", green_runs(27) + [PENDING_RUN, SUCCESS_CONTEXT], card: card)
  end

  # The same pull request once every check has finished, with no review thread open.
  def blocked_all_green(card: 1702)
    pull_request("BLOCKED", green_runs(28) + [SUCCESS_CONTEXT], card: card)
  end

  def green_runs(count)
    Array.new(count) { { "__typename" => "CheckRun", "conclusion" => "SUCCESS",
                         "name" => "CI / verifications", "status" => "COMPLETED",
                         "workflowName" => "CI" } }
  end
end
