#!/usr/bin/env ruby
# frozen_string_literal: true

# #1048 production runtime DSN cutover contract: replicate the staging Secrets
# Store DSN pattern to PRODUCTION and stop uploading DATABASE_URL as a worker
# secret for the production catalog/users jobs.
#
# Asserts, statically against the checked-in files:
#   1. In BOTH ci.yml and deploy.yml, the production catalog (deploy-prod) and
#      production users (deploy-users-prod) jobs no longer name DATABASE_URL
#      in their `with.worker_secrets` list — the wrangler binding supersedes
#      the old owner-DSN upload. NEON_DATABASE_URL is still passed in the
#      `secrets:` block (it feeds the pinned Atlas apply), so removing it from
#      worker_secrets is the precise assertion, not removing the secret.
#   2. The production catalog/users wrangler.toml environments declare a
#      Secrets Store binding for DATABASE_URL pointing at the infra/neon-secrets
#      prod-stack secrets (catalog_svc/users_svc role DSNs, "_PROD"-suffixed
#      because staging and production share the account's single Secrets Store).

require 'yaml'

WORKFLOWS = '.github/workflows'
ABORTIONS = []

def fail(message)
  ABORTIONS << message
end

# The worker_secrets input is a plain string (newline- or space-separated).
# Returns true when it names DATABASE_URL.
def uploads_database_url?(with_block)
  value = with_block['worker_secrets'].to_s
  value.lines.flat_map(&:split).include?('DATABASE_URL')
end

def load_workflow(file)
  text = File.read(File.join(WORKFLOWS, file)).sub(/^on:(?=[ \\t#]|$)/, '"on":')
  YAML.safe_load(text, aliases: true)
end

%w[ci.yml deploy.yml].each do |file|
  jobs = load_workflow(file).fetch('jobs')
  catalog = jobs.fetch('deploy-prod').fetch('with')
  users = jobs.fetch('deploy-users-prod').fetch('with')
  if uploads_database_url?(catalog)
    fail("#{file}: production catalog deploy-prod must not upload DATABASE_URL as a worker secret")
  end
  if uploads_database_url?(users)
    fail("#{file}: production users deploy-users-prod must not upload DATABASE_URL as a worker secret")
  end
  # NEON_DATABASE_URL must still be passed to the reusable deploy for the
  # pinned Atlas apply — it just must not reach the Worker as a secret.
  catalog_secrets = jobs.fetch('deploy-prod').fetch('secrets')
  users_secrets = jobs.fetch('deploy-users-prod').fetch('secrets')
  unless catalog_secrets.key?('NEON_DATABASE_URL')
    fail("#{file}: deploy-prod must keep passing NEON_DATABASE_URL for the Atlas apply")
  end
  unless users_secrets.key?('NEON_DATABASE_URL')
    fail("#{file}: deploy-users-prod must keep passing NEON_DATABASE_URL for the Atlas apply")
  end
end

# Production wrangler.toml Secrets Store bindings.
catalog_toml = File.read('workers/catalog/wrangler.toml')
users_toml = File.read('workers/users/wrangler.toml')
unless catalog_toml.include?('[[env.production.secrets_store_secrets]]') &&
       catalog_toml.include?('binding = "DATABASE_URL"') &&
       catalog_toml.include?('secret_name = "CATALOG_DATABASE_URL_PROD"')
  fail('workers/catalog/wrangler.toml production must bind DATABASE_URL to the CATALOG_DATABASE_URL_PROD store secret')
end
unless users_toml.include?('[[env.production.secrets_store_secrets]]') &&
       users_toml.include?('binding = "DATABASE_URL"') &&
       users_toml.include?('secret_name = "USERS_DATABASE_URL_PROD"')
  fail('workers/users/wrangler.toml production must bind DATABASE_URL to the USERS_DATABASE_URL_PROD store secret')
end

if ABORTIONS.empty?
  puts 'PROD DSN STORE CONTRACT: production catalog/users no longer upload DATABASE_URL; wrangler bindings source the _PROD store secrets'
else
  ABORTIONS.each { |m| warn "#{m}\n" }
  abort "PROD DSN STORE CONTRACT violated (#{ABORTIONS.length} issue(s))"
end

