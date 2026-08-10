#!/usr/bin/env ruby
# frozen_string_literal: true

# RETENTION-1 absence contract (issue #940).
#
# Proves that no live staging source, workflow, config, script, or runbook can
# re-create the retired automated-retention surface, while the exact
# SAFE-1 allowlist keeps the pinned production declarations. The four retired
# vocabulary terms — `workers/jobs`, `jobs_svc`, `AGENT_DATABASE_URL`, and
# `purge` — plus the staging trigger/Worker identities must appear only in:
#
#   * immutable history: docs/archive/, docs/iterations/, docs/specs/;
#   * SAFE-1's pinned production surface: the release manifest, its resolver/
#     validation scripts, the SAFE-1 contract script, ci.yml/deploy.yml
#     production maintenance jobs, reusable-deploy-component.yml's production
#     credential mapping, workers/jobs/wrangler.toml ([env.production] and the
#     base schedule), and the applied role/grant migrations;
#   * unrelated vocabulary collisions: catalog's Neon orphan-branch purge
#     spike tooling and the applied anon-prefix SQL migration comment.
#
# Structural assertions pin the staging retirement itself: no staging Worker
# env section, no staging deploy job, no fallback workflows, no pipeline lane,
# and no staging role/credential declaration in the neon-secrets stack.

require "set"

ROOT = File.expand_path("../..", __dir__)
WORKFLOWS = File.join(ROOT, ".github/workflows")
SCRIPTS = File.join(ROOT, ".github/scripts")

# Immutable decision/history records: archived specs and plans, iteration
# records, and dated ADRs.
HISTORICAL_DIRS = %w[docs/archive docs/iterations docs/specs docs/adr].freeze

# Exact-path allowlist for each retired vocabulary term. Paths are relative to
# ROOT; a trailing "/**" prefix-matches a directory.
ALLOWLISTS = {
  "workers/jobs" => Set.new(
    [
      ".github/release-manifests/production-pre-campaign.json",
      ".github/scripts/test_safe1_production_contract.rb",
      ".github/scripts/release-manifest-validation.rb",
      ".github/workflows/ci.yml",
      ".github/workflows/deploy.yml",
      "workers/jobs/wrangler.toml",
    ],
  ),
  "jobs_svc" => Set.new(
    [
      ".github/scripts/test_safe1_production_contract.rb",
      "migrations/neon/20260809000001_roles.sql",
      "migrations/neon/20260809000030_grants.sql",
      # Live cutover runbook referencing the immutable role matrix and the
      # SAFE-1-pinned production grants, not staging execution.
      "docs/ops/prod-dsn-cutover.md",
    ],
  ),
  "AGENT_DATABASE_URL" => Set.new(
    [
      ".github/release-manifests/production-pre-campaign.json",
      ".github/scripts/test_safe1_production_contract.rb",
      ".github/scripts/release-manifest-validation.rb",
      ".github/workflows/ci.yml",
      ".github/workflows/deploy.yml",
      ".github/workflows/reusable-deploy-component.yml",
      # Live secret inventory rows for the SAFE-1-pinned production credential
      # and the retired staging credential cleanup action.
      "docs/ops/secrets.md",
      # Live cutover runbook for the pinned production credential.
      "docs/ops/prod-dsn-cutover.md",
      "workers/jobs/wrangler.toml",
    ],
  ),
  "purge" => Set.new(
    [
      "supabase/migrations/20260728000001_conversations_user_id_pattern_ops.sql",
      "workers/catalog/test/spike-db-global.ts",
      "workers/catalog/test/spike-db-global/neon-api.ts",
      # Dated review-debt log (historical snapshot).
      "docs/ops/pr-comment-debt-2026-08-06.md",
    ],
  ),
  "maintenance-staging" => Set.new([]),
  "deploy-maintenance-staging" => Set.new([]),
  "pipeline-maintenance" => Set.new([]),
  "purge-anonymous-sessions" => Set.new([]),
  "purge-anon-quota-counts" => Set.new([]),
}.freeze

def allowed?(pattern, path)
  ALLOWLISTS.fetch(pattern).include?(path) ||
    HISTORICAL_DIRS.any? { |dir| path == dir || path.start_with?("#{dir}/") }
end

def tracked_files
  Dir.glob(File.join(ROOT, "**/*"), File::FNM_DOTMATCH).map do |entry|
    rel = entry.delete_prefix("#{ROOT}/")
    next if rel.empty?
    next unless File.file?(entry)
    next if rel == ".github/scripts/test_retention1_absence.rb"
    next if rel.start_with?(".git/")
    next if rel.include?("/node_modules/") || rel.start_with?("node_modules/")
    next if rel.include?("/.venv/") || rel.include?("/coverage/") || rel.include?("/dist/")
    next if rel.include?("/test-results/") || rel.include?("/playwright-report/")
    next if rel.end_with?(".sum") || rel.end_with?("pnpm-lock.yaml") || rel.end_with?(".json") && rel.start_with?("infra/Pulumi")
    rel
  end.compact
end

def violations
  found = []
  tracked_files.each do |rel|
    text = File.read(File.join(ROOT, rel))
    ALLOWLISTS.each_key do |pattern|
      next if allowed?(pattern, rel)
      next unless text.include?(pattern)
      found << "#{rel}: #{pattern}"
    end
  end
  found.sort
end

def structural_violations
  found = []
  jobs_toml = File.read(File.join(ROOT, "workers/jobs/wrangler.toml"))
  found << "workers/jobs/wrangler.toml must not declare a staging env section" if jobs_toml.include?("[env.staging]")
  found << "ci.yml must not declare deploy-maintenance-staging" if File.read(File.join(WORKFLOWS, "ci.yml")).include?("deploy-maintenance-staging")
  %w[purge-anonymous-sessions.yml purge-anon-quota-counts.yml pipeline-maintenance.yml].each do |file|
    found << ".github/workflows/#{file} must not exist" if File.exist?(File.join(WORKFLOWS, file))
  end
  neon = File.read(File.join(ROOT, "infra/neon-secrets/index.ts"))
  found << "infra/neon-secrets must not declare the jobs_svc role" if neon.include?("jobs_svc")
  found << "infra/neon-secrets must not declare AGENT_DATABASE_URL" if neon.include?("AGENT_DATABASE_URL")
  found
end

issues = violations + structural_violations
if issues.empty?
  puts "OK: no live source/workflow/config/script references the retired retention surface"
else
  puts issues
  abort "RETENTION-1 absence contract violated (#{issues.length} issue(s))"
end
