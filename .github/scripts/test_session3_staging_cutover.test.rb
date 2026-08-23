#!/usr/bin/env ruby
# frozen_string_literal: true

# Behavioral tests for the SESSION-3 Pulumi Cloud OIDC matcher (#1077),
# the #1152 Pulumi CLI pin, and the #1154 close-ingress gate token.

require "fileutils"
require "tmpdir"
require_relative "test_session3_staging_cutover"

JOB_C = "cutover-phase-c-close-ingress"
AUTH_STEP = [
  "      - name: Authenticate with Pulumi Cloud",
  "        uses: pulumi/auth-actions@141415910c3beb54e03b48e9057c204c97b956f2 # v2.1.0"
].join("\n")
JOB_C_GATE_TOKEN_BLOCK = [
  "          STAGING_GATE_TOKEN: ${{ secrets.STAGING_GATE_TOKEN }}",
  "          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
  "          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}"
].join("\n")
JOB_C_GATE_TOKEN_REMOVED = [
  "          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
  "          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}"
].join("\n")
JOB_C_GATE_TOKEN_BACKUP = [
  "          STAGING_GATE_TOKEN: ${{ secrets.STAGING_GATE_TOKEN_BACKUP }}",
  "          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
  "          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}"
].join("\n")

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
  Dir.mktmpdir("session3-cloud") do |dir|
    path = File.join(dir, "staging-cutover.yml")
    FileUtils.cp(WORKFLOW, path)
    File.write(path, yield(File.read(path)))
    pulumi_cloud_backend_violations(load_workflow(path))
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

def with_mutated_gate_token
  Dir.mktmpdir("session3-gate") do |dir|
    path = File.join(dir, "staging-cutover.yml")
    FileUtils.cp(WORKFLOW, path)
    File.write(path, yield(File.read(path)))
    close_ingress_gate_token_violations(load_workflow(path))
  end
end

assert_violation(
  "job C Pulumi Cloud auth step removed",
  with_mutated_workflow { |text| text.sub("#{AUTH_STEP}\n", "") },
  "#{JOB_C}: pulumi-executing job must authenticate with pulumi/auth-actions org lifeodyssey"
)

assert_violation(
  "job C DIY backend URL restored",
  with_mutated_workflow { |text|
    text.sub(
      "          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}\n        run: bash .github/scripts/cutover-close-ingress.sh",
      "          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}\n          PULUMI_BACKEND_URL: ${{ secrets.PULUMI_BACKEND_URL }}\n        run: bash .github/scripts/cutover-close-ingress.sh"
    )
  },
  "#{JOB_C}: pulumi-executing step must not set PULUMI_BACKEND_URL"
)

assert_clean("pristine staging-cutover.yml", pulumi_cloud_backend_violations(load_workflow(WORKFLOW)))

assert_violation(
  "job C pulumi-version-file replaced with an inline 3.257.0 pin",
  with_mutated_pin { |text| text.sub(
    "pulumi-version-file: .pulumi.version",
    "pulumi-version: 3.257.0"
  ) },
  "#{JOB_C}: pulumi-executing job must install CLI via pulumi-version-file: .pulumi.version"
)

assert_clean("pristine staging-cutover.yml Pulumi CLI pin", pulumi_cli_pin_violations(load_workflow(WORKFLOW)))

assert_violation(
  "job C STAGING_GATE_TOKEN mapping removed",
  with_mutated_gate_token { |text| text.sub(JOB_C_GATE_TOKEN_BLOCK, JOB_C_GATE_TOKEN_REMOVED) },
  "#{JOB_C}: close-ingress step must provide STAGING_GATE_TOKEN"
)

assert_violation(
  "job C STAGING_GATE_TOKEN_BACKUP on the close-ingress step",
  with_mutated_gate_token { |text| text.sub(JOB_C_GATE_TOKEN_BLOCK, JOB_C_GATE_TOKEN_BACKUP) },
  "#{JOB_C}: STAGING_GATE_TOKEN must source from secrets.STAGING_GATE_TOKEN"
)

assert_clean(
  "pristine staging-cutover.yml close-ingress gate token",
  close_ingress_gate_token_violations(load_workflow(WORKFLOW))
)

puts "All test_session3_staging_cutover Pulumi Cloud OIDC, Pulumi CLI pin, and close-ingress gate token tests passed."
