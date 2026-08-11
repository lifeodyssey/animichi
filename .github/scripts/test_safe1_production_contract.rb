#!/usr/bin/env ruby
# frozen_string_literal: true

# SAFE-1 production freeze contract (Phase A characterization → target
# invariants after Phase B2 wired the guard).
#
# Pins the release semantics of the production deploy surface after the
# SAFE-1 promotion-eligibility changes land. Semantics only — never whitespace
# trivia:
#
#   1. ci.yml and deploy.yml expose the same five production component
#      mappings (component -> working directory), root included, with root's
#      config at workers/edge/wrangler.toml.
#   2. The retained Jobs production surface: maintenance -> workers/jobs,
#      AGENT_DATABASE_URL, the jobs_svc grants, and both cron schedules.
#   3. Atlas head is 20260809000031 and migrations/neon/atlas.sum hashes to
#      the pinned SHA-256.
#   4. SAFE-1 target invariants: every production entry point gates on the
#      eligibility workflow; rollback has no caller version_id and stops
#      before Wrangler when ineligible; production checkout, Atlas target,
#      build metadata, and smoke expectations resolve from the pinned
#      revision, never github.sha.

require "yaml"
require "digest"

WORKFLOWS = ".github/workflows"

# The five production component mappings (component -> working directory),
# shared verbatim by ci.yml and deploy.yml. catalog's job is `deploy-prod`,
# not `deploy-catalog-prod`; every other component uses `deploy-<name>-prod`.
PROD_COMPONENT_DIRS = {
  "catalog" => "workers/catalog",
  "web" => "apps/web",
  "users" => "workers/users",
  "maintenance" => "workers/jobs",
  "root" => "."
}.freeze

def prod_job_id(component)
  component == "catalog" ? "deploy-prod" : "deploy-#{component}-prod"
end

# `on:` is a YAML 1.1 boolean, so old psych parses it as the key `true`;
# accept both spellings (same stance as test_ci_contract.rb).
def load_workflow(file)
  text = File.read(File.join(WORKFLOWS, file)).sub(/^on:(?=[ \t#]|$)/, '"on":')
  YAML.safe_load(text, aliases: true)
end

def triggers(wf)
  wf["on"] || wf[true]
end

def fetch_prod_job(jobs, component)
  job = jobs.fetch(prod_job_id(component))
  abort "deploy-#{component}-prod must call reusable-deploy-component.yml" \
    unless job.fetch("uses") == "./.github/workflows/reusable-deploy-component.yml"
  job
end

# ── 1. The five production component mappings, identical in both callers ──
%w[ci.yml deploy.yml].each do |file|
  jobs = load_workflow(file).fetch("jobs")
  PROD_COMPONENT_DIRS.each do |component, dir|
    with = fetch_prod_job(jobs, component).fetch("with")
    abort "#{file}: #{component} must map to #{dir}, got #{with['working_directory'].inspect}" \
      unless with["working_directory"] == dir
    abort "#{file}: #{component} must target environment production" unless with["environment"] == "production"
    abort "#{file}: #{component} must target pulumi stack prod" unless with["pulumi_stack"] == "prod"
    abort "#{file}: #{component} must declare component #{component}" unless with["component"] == component
  end
end

# Root's config lives at workers/edge/wrangler.toml while its working
# directory stays "." — wrangler is pointed at it explicitly (#853).
deploy_source = File.read(File.join(WORKFLOWS, "reusable-deploy-component.yml"))
abort "reusable deploy must point root at workers/edge/wrangler.toml" \
  unless deploy_source.include?("deploy -c workers/edge/wrangler.toml")
rollback_source = File.read(File.join(WORKFLOWS, "rollback.yml"))
abort "rollback must point root at workers/edge/wrangler.toml" \
  unless rollback_source.include?("-c workers/edge/wrangler.toml")

# ── 2. Retained Jobs production surface (maintenance -> workers/jobs) ──
%w[ci.yml deploy.yml].each do |file|
  with = load_workflow(file).fetch("jobs").fetch("deploy-maintenance-prod").fetch("with")
  abort "#{file}: maintenance prod must keep worker_secrets AGENT_DATABASE_URL" \
    unless with["worker_secrets"] == "AGENT_DATABASE_URL"
end

grants = File.read("migrations/neon/20260809000030_grants.sql")
abort "jobs_svc must exist as a role" \
  unless File.read("migrations/neon/20260809000001_roles.sql").include?("CREATE ROLE jobs_svc")
expected_grants = [
  "GRANT SELECT,DELETE ON TABLE public.anon_daily_message_count TO jobs_svc;",
  "GRANT SELECT,DELETE ON TABLE public.conversation_messages TO jobs_svc;",
  "GRANT SELECT,DELETE ON TABLE public.conversations TO jobs_svc;",
  "GRANT SELECT ON TABLE public.saved_routes TO jobs_svc;",
  "GRANT SELECT,DELETE ON TABLE public.sessions TO jobs_svc;"
]
missing = expected_grants.reject { |line| grants.include?(line) }
abort "jobs_svc grants missing: #{missing.join('; ')}" unless missing.empty?

jobs_toml = File.read("workers/jobs/wrangler.toml")
abort "jobs wrangler.toml must declare both crons in base and production" \
  unless jobs_toml.scan('crons = ["37 18 * * *", "37 19 * * *"]').size == 2

# Production identity, scoped to the [env.production] subtree: the worker
# deployed to production must be named `jobs`, and its secrets.required must
# be exactly the AGENT_DATABASE_URL upload chain (#912 keeps production off
# the staging Secrets Store so prod can never bind staging-role DSNs).
prod_section = jobs_toml.lines
  .drop_while { |line| line.chomp != "[env.production]" }
  .take_while { |line| line.start_with?("[env.production") || !line.start_with?("[") }
  .join
abort "jobs wrangler.toml must declare [env.production]" if prod_section.empty?
abort "jobs production Worker name must be exactly \"jobs\"" \
  unless prod_section[/^\s*name\s*=\s*"([^"]+)"/, 1] == "jobs"
abort "jobs production secrets.required must be exactly AGENT_DATABASE_URL" \
  unless prod_section[/^\s*required\s*=\s*\[(.*?)\]/, 1]&.strip == '"AGENT_DATABASE_URL"'

# ── 3. Atlas head + pinned atlas.sum integrity ──
heads = Dir[File.join("migrations/neon", "*.sql")].map { |f| File.basename(f)[/\A\d+/] }.compact
abort "Atlas head must be 20260809000032, got #{heads.max.inspect}" unless heads.max == "20260811000000"
sum = Digest::SHA256.file("migrations/neon/atlas.sum").hexdigest
abort "atlas.sum SHA-256 must be e0428e7a9b25745a8d1f22f8fbcec5c915a8e18d56a7a45f5fe3554158b6ab80, got #{sum}" \
  unless sum == "5d968ca2b05f93b882c56a14af618ebbcf5aa67ab2605c61721b171ddf585960"

# ── 4. SAFE-1 target invariants (the guard is now wired) ────────────────────
# 4a. Every production entry point routes through the eligibility workflow and
#     only runs when the pinned manifest marks the candidate eligible.
eligibility_source = File.read(File.join(WORKFLOWS, "reusable-production-eligibility.yml"))
abort "eligibility workflow must resolve the pinned manifest via the GitHub API" \
  unless eligibility_source.include?("release-eligibility.sh")
abort "eligibility workflow must expose eligible/source_revision/reason outputs" \
  unless %w[eligible source_revision reason].all? { |o| eligibility_source.include?(o) }

%w[ci.yml deploy.yml].each do |file|
  jobs = load_workflow(file).fetch("jobs")
  abort "#{file}: must call reusable-production-eligibility.yml" \
    unless jobs.fetch("production-eligibility").fetch("uses") == "./.github/workflows/reusable-production-eligibility.yml"
  PROD_COMPONENT_DIRS.each_key do |component|
    job = fetch_prod_job(jobs, component)
    abort "#{file}: #{prod_job_id(component)} must depend on production-eligibility" \
      unless job.fetch("needs").include?("production-eligibility")
    abort "#{file}: #{prod_job_id(component)} must gate on eligible == 'true'" \
      unless job.fetch("if") == "${{ needs.production-eligibility.outputs.eligible == 'true' }}"
  end
  post = jobs.fetch("post-prod")
  abort "#{file}: post-prod must depend on production-eligibility" \
    unless post.fetch("needs").include?("production-eligibility")
  abort "#{file}: post-prod must gate on eligible == 'true'" \
    unless post.fetch("if") == "${{ needs.production-eligibility.outputs.eligible == 'true' }}"
  abort "#{file}: post-prod must pass the resolved source revision" \
    unless post.fetch("with")["expected_source_revision"] == "${{ needs.production-eligibility.outputs.source_revision }}"
end

# 4b. Rollback: no caller version_id; eligibility resolves from the pinned
#     manifest BEFORE checkout; ineligible stops before checkout or Wrangler.
rollback = load_workflow("rollback.yml")
rollback_source = File.read(File.join(WORKFLOWS, "rollback.yml"))
abort "rollback.yml must not accept a caller-supplied version_id input" \
  if triggers(rollback).fetch("workflow_dispatch").fetch("inputs").key?("version_id")
abort "rollback.yml must verify the pinned manifest SHA-256 inline" \
  unless rollback_source.include?("PINNED_MANIFEST_SHA256")
abort "rollback.yml must gate BEFORE checkout" \
  unless rollback_source.index("Resolve manifest rollback eligibility") < rollback_source.index("actions/checkout")
abort "rollback.yml must fail closed on rollback-ineligible components" \
  unless rollback_source.include?("rollback-ineligible")

# 4c. The reusable deploy resolves the pinned manifest, checks out the pinned
#     source revision, verifies HEAD + atlas.sum, applies the pinned Atlas
#     target — staging keeps caller-SHA behavior.
reusable = load_workflow("reusable-deploy-component.yml")
reusable_source = File.read(File.join(WORKFLOWS, "reusable-deploy-component.yml"))
abort "reusable deploy must resolve the pinned manifest for production" \
  unless reusable_source.include?("Resolve pinned production release manifest")
abort "reusable deploy must check out the pinned production source" \
  unless reusable_source.include?("Checkout pinned production source")
abort "reusable deploy must verify HEAD against the pinned source revision" \
  unless reusable_source.include?("does not match pinned source revision")
abort "reusable deploy must verify atlas.sum against the pinned digest" \
  unless reusable_source.include?("Verify pinned atlas.sum")
abort "reusable deploy must apply the pinned Atlas target for production" \
  unless reusable_source.include?("--to-version")

# 4d. Post-deploy smokes: production expects the resolved revision, never the
#     campaign github.sha.
%w[reusable-deploy-component.yml reusable-post-deploy-test.yml].each do |file|
  source = File.read(File.join(WORKFLOWS, file))
  abort "#{file} must not expect github.sha unconditionally as the deployed commit" \
    if source.include?("EXPECTED_GIT_COMMIT: ${{ github.sha }}")
  abort "#{file} must resolve the expected deployed commit for production" \
    unless source.include?("expected_source_revision") || source.include?("steps.release.outputs.source_revision")
end
abort "reusable deploy must bake the pinned revision for production" \
  unless reusable_source.include?("pinned-pre-campaign")

puts "SAFE-1 freeze: eligibility gate on all production entry points; rollback version_id " \
     "removed; pinned manifest resolution for checkout, Atlas target, build metadata, smokes"
