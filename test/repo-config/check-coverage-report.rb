#!/usr/bin/env ruby
# Refuses a coverage report that measured nothing (#1766), run where the threshold is:
#
#   ruby test/repo-config/check-coverage-report.rb [<package-dir>]   # default: the cwd
#
# The pre-push gate and CI's `affected` job run it through `pnpm exec` over the packages
# whose scripts they just ran, after those scripts, so it reads the report that run wrote.
# A package whose manifest runs no node coverage exits 0 untouched: which packages are gated
# is read from their scripts (`coverage_gate.rb`), so a package that starts measuring
# coverage is checked from the push that adds it. TEST_REPOSITORY_ROOT points the check at
# a throwaway workspace, as the contract's own tests do.
require "pathname"
require_relative "coverage_gate"

root = File.realpath(ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__)))
package = Pathname.new(File.realpath(ARGV.fetch(0, Dir.pwd))).relative_path_from(Pathname.new(root)).to_s
refusals = CoverageGate.declared_in(root, package).flat_map(&:refusals)
refusals.each { |refusal| warn "check-coverage-report: #{refusal}" }
exit(refusals.empty? ? 0 : 1)
