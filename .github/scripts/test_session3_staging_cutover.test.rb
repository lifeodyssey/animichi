#!/usr/bin/env ruby
# frozen_string_literal: true

# Behavioral tests for the SESSION-3 R2 backend credential-source matcher
# and the #1152 Pulumi CLI pin (`r2_backend_source_violations` /
# `pulumi_cli_pin_violations` in test_session3_staging_cutover.rb).
#
# The contract script had no host of its own. This file is that host, in the
# same abort-on-fail / throwaway-copy shape as assert-workflow-invariants.test.rb
# and test_promotion_ac5_mutation.rb: require the contract (main is guarded),
# then red/green probes. Mutation copies staging-cutover.yml into a tmpdir so
# the checked-in workflow is never the thing that makes a probe green.

require "fileutils"
require "tmpdir"
require_relative "test_session3_staging_cutover"

JOB_C = "cutover-phase-c-close-ingress"
# Explicit indentation (no squiggly heredoc): <<~ would strip the 10-space
# env indent and the deletion probe would no-op against the real workflow.
JOB_C_R2_BLOCK = [
  "          AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}",
  "          AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}",
  "          AWS_DEFAULT_REGION: auto"
].join("\n")

def valid_r2_env(overrides = {})
  {
    "AWS_ACCESS_KEY_ID" => "${{ secrets.R2_ACCESS_KEY_ID }}",
    "AWS_SECRET_ACCESS_KEY" => "${{ secrets.R2_SECRET_ACCESS_KEY }}",
    "AWS_DEFAULT_REGION" => "auto"
  }.merge(overrides)
end

def assert_clean(label, found)
  abort "FAIL: #{label} must pass, got #{found.inspect}" unless found.empty?
  puts "PASS: #{label}"
end

def assert_violation(label, found, fragment)
  abort "FAIL: #{label} must be rejected, got #{found.inspect}" if found.empty?
  abort "FAIL: #{label} expected #{fragment.inspect}:\n#{found.join("\n")}" unless found.any? { |line| line.include?(fragment) }
  puts "PASS: #{label} rejected (#{fragment})"
end

def with_mutated_workflow
  Dir.mktmpdir("session3-r2") do |dir|
    path = File.join(dir, "staging-cutover.yml")
    FileUtils.cp(WORKFLOW, path)
    text = File.read(path)
    File.write(path, yield(text))
    pulumi_r2_backend_violations(load_workflow(path))
  end
end

def with_mutated_pin
  Dir.mktmpdir("session3-pin") do |dir|
    path = File.join(dir, "staging-cutover.yml")
    FileUtils.cp(WORKFLOW, path)
    File.write(path, yield(File.read(path)))
    pulumi_cli_pin_violations(load_workflow(path))
  end
end

# ── Red: prefix-matching other secret (the CodeRabbit false negative) ──────
assert_violation(
  "prefix-matching R2_ACCESS_KEY_ID_BACKUP",
  r2_backend_source_violations(JOB_C, valid_r2_env(
    "AWS_ACCESS_KEY_ID" => "${{ secrets.R2_ACCESS_KEY_ID_BACKUP }}"
  )),
  "AWS_ACCESS_KEY_ID must source from secrets.R2_ACCESS_KEY_ID"
)

assert_violation(
  "prefix-matching R2_SECRET_ACCESS_KEY_BACKUP",
  r2_backend_source_violations(JOB_C, valid_r2_env(
    "AWS_SECRET_ACCESS_KEY" => "${{ secrets.R2_SECRET_ACCESS_KEY_BACKUP }}"
  )),
  "AWS_SECRET_ACCESS_KEY must source from secrets.R2_SECRET_ACCESS_KEY"
)

# ── Green: exact expression, plus inner-whitespace variation ───────────────
assert_clean("exact R2 expressions", r2_backend_source_violations(JOB_C, valid_r2_env))
assert_clean(
  "inner whitespace around secret names",
  r2_backend_source_violations(JOB_C, valid_r2_env(
    "AWS_ACCESS_KEY_ID" => "${{secrets.R2_ACCESS_KEY_ID}}",
    "AWS_SECRET_ACCESS_KEY" => "${{  secrets.R2_SECRET_ACCESS_KEY  }}"
  ))
)

# ── Red: throwaway copy — job C pulumi step uses a prefix-matching secret ──
assert_violation(
  "job C AWS_ACCESS_KEY_ID_BACKUP on a pulumi-executing step",
  with_mutated_workflow { |text| text.sub(
    "AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}",
    "AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID_BACKUP }}"
  ) },
  "#{JOB_C}: AWS_ACCESS_KEY_ID must source from secrets.R2_ACCESS_KEY_ID"
)

# ── Red: throwaway copy — job C drops the three R2 backend keys ────────────
assert_violation(
  "job C R2 env block removed",
  with_mutated_workflow { |text| text.sub("#{JOB_C_R2_BLOCK}\n", "") },
  "#{JOB_C}: pulumi-executing step must provide R2 backend credentials"
)

# ── Green: the checked-in workflow still satisfies the R2 source contract ──
assert_clean("pristine staging-cutover.yml", pulumi_r2_backend_violations(load_workflow(WORKFLOW)))

# ── Red: throwaway copy — job C drops the .pulumi.version pin (#1152) ─────
assert_violation(
  "job C pulumi-version-file replaced with an inline 3.257.0 pin",
  with_mutated_pin { |text| text.sub(
    "pulumi-version-file: .pulumi.version",
    "pulumi-version: 3.257.0"
  ) },
  "#{JOB_C}: pulumi-executing job must install CLI via pulumi-version-file: .pulumi.version"
)

# ── Green: the checked-in workflow pins every pulumi-executing job ────────
assert_clean("pristine staging-cutover.yml Pulumi CLI pin", pulumi_cli_pin_violations(load_workflow(WORKFLOW)))

puts "All test_session3_staging_cutover R2 source and Pulumi CLI pin tests passed."
