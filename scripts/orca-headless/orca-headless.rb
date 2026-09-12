#!/usr/bin/env ruby
# frozen_string_literal: true

File.umask(0o077)

require_relative "orca_headless"

exit OrcaHeadless::CLI.run(ARGV)
