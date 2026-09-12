#!/usr/bin/env ruby
# frozen_string_literal: true

require "optparse"

File.umask(0o077)

require_relative "orca_headless"

values = {}
OptionParser.new do |parser|
  parser.on("--state PATH") { |value| values[:state] = value }
  parser.on("--timeout SECONDS") { |value| values[:timeout] = value }
end.parse!(ARGV)

abort "runner requires --state and --timeout" unless values[:state] && values[:timeout]
exit OrcaHeadless::Runner.new(values[:state], Integer(values[:timeout], 10)).call
