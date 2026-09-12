#!/usr/bin/env ruby
# frozen_string_literal: true

require_relative "pr_feedback"

exit Orca::PrFeedback::CLI.run(ARGV)
