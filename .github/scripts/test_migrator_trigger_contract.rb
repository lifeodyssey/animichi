#!/usr/bin/env ruby
# frozen_string_literal: true

# #1051 / US-24 (amendment 3) — the migrator trigger contract, asserted
# statically against the checked-in deploy workflows:
#   1. The migrator trigger job (migrate-staging in ci.yml) exists AHEAD of
#      every component deploy — each component deploy job names migrate-staging
#      in its needs (schema before app).
#   2. The trigger job carries its GitHub OIDC identity (id-token: write),
#      requests the fixed migrator audience via ACTIONS_ID_TOKEN_REQUEST_URL,
#      and contains NO Atlas invocation and NO database-credential reference
#      (NEON_DATABASE_URL / NEON_API_KEY / MIGRATOR_DATABASE_URL).
#   3. The migrator deploy caller (deploy-migrator-staging) uploads no worker
#      secrets and references no database credential; the migrator's DSN comes
#      solely from the Cloudflare Secrets Store binding in
#      workers/migrator/wrangler.toml, and only that worker references it.
# The end-state "no Atlas anywhere in the shared reusable component" is reached
# once the cutover removes the per-component Atlas step (production is #1055);
# this test already fences the new migrator path against any Atlas/db-cred.

require 'yaml'

WORKFLOWS = '.github/workflows'
ABORTIONS = []

def fail(message)
  ABORTIONS << message
end

def load_workflow(file)
  text = File.read(File.join(WORKFLOWS, file)).sub(/^on:(?=[ \t#]|$)/, '"on":')
  YAML.safe_load(text, aliases: true)
end


MAD_AUDIENCE = 'animichi:github-actions:migrator'
DB_CREDS = %w[NEON_DATABASE_URL NEON_API_KEY MIGRATOR_DATABASE_URL].freeze

ci = load_workflow('ci.yml')
ci_jobs = ci.fetch('jobs')

# 1) The trigger job exists ahead of every component deploy.
%w[deploy-staging deploy-web-staging deploy-users-staging deploy-root-staging].each do |job_id|
  needs = Array(ci_jobs.fetch(job_id).fetch('needs'))
  unless needs.include?('migrate-staging')
    fail("#{job_id} must depend on migrate-staging so schema applies before it deploys")
  end
end

# 2) The trigger job is OIDC-gated, audience-pinned, and contains no Atlas /
#    database-credential reference.
trigger = ci_jobs.fetch('migrate-staging')
perms = trigger.fetch('permissions')
unless perms['id-token'] == 'write'
  fail('migrate-staging must request id-token: write to obtain the GitHub OIDC token')
end
unless trigger.fetch('environment') == 'staging'
  fail('migrate-staging must run under the staging environment so the OIDC token carries environment=staging')
end
trigger_source = File.read(File.join(WORKFLOWS, 'ci.yml'))
lines = trigger_source.lines
trigger_segment = lines
  .drop_while { |line| !line.include?('migrate-staging:') }
  .take_while { |line| !line.match?(/^  [a-z][a-z0-9-]*:/) || line.include?('migrate-staging:') }
  .join
DB_CREDS.each do |cred|
  if trigger_segment.include?(cred)
    fail("migrate-staging must not reference #{cred}")
  end
end
if trigger_segment =~ /\batlas\b/
  fail('migrate-staging must not invoke Atlas')
end
unless trigger_segment.include?(MAD_AUDIENCE)
  fail('migrate-staging must request the fixed migrator audience via ACTIONS_ID_TOKEN_REQUEST_URL')
end
unless trigger_segment.include?('ACTIONS_ID_TOKEN_REQUEST_URL')
  fail('migrate-staging must retrieve the token from ACTIONS_ID_TOKEN_REQUEST_URL')
end

# 3) The migrator deploy caller uploads no secrets and references no creds.
mig_deploy = ci_jobs.fetch('deploy-migrator-staging')
mig_with = mig_deploy.fetch('with')
if Array(mig_with['worker_secrets'].to_s.lines.flat_map(&:split)).any?
  fail('deploy-migrator-staging must upload no worker secrets (DSN arrives via the Store binding)')
end
mig_secrets = mig_deploy.fetch('secrets')
DB_CREDS.each do |cred|
  if mig_secrets.keys.include?(cred)
    fail("deploy-migrator-staging must not pass #{cred} to the reusable deploy")
  end
end

# The migrator's DSN lives in the migrator worker's Secrets Store binding only.
mig_toml = File.read('workers/migrator/wrangler.toml')
unless mig_toml.include?('secret_name = "MIGRATOR_DATABASE_URL"') &&
       mig_toml.include?('binding = "MIGRATOR_DATABASE_URL"') &&
       mig_toml.include?('secrets_store_secrets')
  fail('workers/migrator/wrangler.toml must bind MIGRATOR_DATABASE_URL via a Secrets Store binding')
end
%w[catalog users edge jobs].each do |worker|
  toml = File.read("workers/#{worker}/wrangler.toml")
  if toml.include?('MIGRATOR_DATABASE_URL')
    fail("workers/#{worker}/wrangler.toml must not reference MIGRATOR_DATABASE_URL")
  end
end

if ABORTIONS.empty?
  puts 'MIGRATOR TRIGGER CONTRACT: trigger precedes component deploys; OIDC-audience-pinned; no Atlas/db-cred in the migrator path'
else
  ABORTIONS.each { |m| warn "#{m}
" }
  abort "MIGRATOR TRIGGER CONTRACT violated (#{ABORTIONS.length} issue(s))"
end