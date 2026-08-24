#!/usr/bin/env ruby
# frozen_string_literal: true

# Behavioral tests for assert-workflow-invariants.rb. The support and probe
# parts remain separate so every test source stays below the repository's
# 200-line test-file limit while this entry point preserves the original run.

require_relative "assert_workflow_invariants_test_support"
require_relative "assert_workflow_invariants_test_part_1"
require_relative "assert_workflow_invariants_test_part_2"
require_relative "assert_workflow_invariants_test_part_3"
require_relative "assert_workflow_invariants_test_part_4"
require_relative "assert_workflow_invariants_test_part_5"
