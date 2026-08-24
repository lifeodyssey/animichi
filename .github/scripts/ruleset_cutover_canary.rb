# frozen_string_literal: true

module RulesetCutover
  CANARY_SCHEMA = "ruleset-canary/v3"
  CANARY_MAX_AGE = 86_400
  PRODUCER_PATHS = {
    "CI / verify" => ".github/workflows/pr-verification.yml",
    "Review Gate" => ".github/workflows/review-gate.yml"
  }.freeze
  CI_CONTEXT = "CI / verify"
  REVIEW_CONTEXT = "Review Gate"
  REVIEW_EVENTS = %w[pull_request_target pull_request_review pull_request_review_comment issue_comment workflow_run].freeze
end

require_relative "ruleset_cutover_canary_capture"
require_relative "ruleset_cutover_canary_validation"
