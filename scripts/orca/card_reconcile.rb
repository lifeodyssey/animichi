# frozen_string_literal: true

require_relative "card_reconcile/errors"
require_relative "card_reconcile/receipt"
require_relative "card_reconcile/command"
require_relative "card_reconcile/lanes"
require_relative "card_reconcile/verdicts"
require_relative "card_reconcile/git_facts"
require_relative "card_reconcile/mailbox"
require_relative "card_reconcile/settlement"
require_relative "card_reconcile/github"
require_relative "card_reconcile/holds"
require_relative "card_reconcile/process_probe"
require_relative "card_reconcile/snapshot"
require_relative "card_reconcile/collector"
require_relative "card_reconcile/row"
require_relative "card_reconcile/short"
require_relative "card_reconcile/card_visibility"
require_relative "card_reconcile/lane_rows"
require_relative "card_reconcile/pull_request_decision"
require_relative "card_reconcile/verdict_rows"
require_relative "card_reconcile/derive"
require_relative "card_reconcile/report"

module Orca
  module CardReconcile
    module_function

    def rows(config = Config.new(Dir.pwd, "/private/tmp", "lifeodyssey/animichi", nil, nil, nil,
                                 -> { Time.now.utc }), now: Time.now.utc, command: Command.new)
      Derivation.new(Collector.new(config, command).snapshot, now).rows
    end
  end
end

require_relative "card_reconcile/cli"
