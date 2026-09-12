# frozen_string_literal: true

require_relative "pr_feedback/errors"
require_relative "pr_feedback/transport"
require_relative "pr_feedback/metadata"
require_relative "pr_feedback/queries"
require_relative "pr_feedback/pagination"
require_relative "pr_feedback/records"
require_relative "pr_feedback/collector"

module Orca
  module PrFeedback
    module_function

    def capture(repository:, pr:, transport: GhTransport.new, clock: -> { Time.now })
      repo = Repository.parse(repository)
      number = PullRequestNumber.parse(pr)
      Collector.new(repo, number, transport, clock).collect
    end
  end
end

require_relative "pr_feedback/cli"
