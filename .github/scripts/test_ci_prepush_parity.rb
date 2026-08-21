#!/usr/bin/env ruby
# frozen_string_literal: true

# CI↔pre-push parity contract (#1114). Discover CI checkpoints by parsing
# workflow run steps and the scripts they invoke; diff against pre-push
# coverage; require the remainder on an exemption list with a CI-only reason.
#
# Usage: ruby .github/scripts/test_ci_prepush_parity.rb

require_relative "ci_prepush_parity"

assert_parity! if $PROGRAM_NAME == __FILE__
