#!/usr/bin/env ruby
# frozen_string_literal: true

require_relative "card_reconcile"

exit Orca::CardReconcile::CLI.run(ARGV)
