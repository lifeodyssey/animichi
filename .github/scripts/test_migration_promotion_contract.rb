#!/usr/bin/env ruby
# frozen_string_literal: true

require "yaml"

def workflow(path)
  text = File.read(path).sub(/^on:(?=[ \t#]|$)/, '"on":')
  YAML.safe_load(text, aliases: true)
end

cd = workflow(".github/workflows/cd.yml")
action = workflow(".github/actions/promote-release-phase/action.yml")
adapter = File.read(".github/scripts/promote-release-unit.sh")

migration = cd.fetch("jobs").fetch("stage-migration")
abort "migration phase must follow foundation" unless Array(migration.fetch("needs")).include?("stage-foundation")
abort "migration phase must request GitHub OIDC" unless migration.dig("permissions", "id-token") == "write"
migration_action = migration.fetch("steps").find { |step| step["uses"] == "./.github/actions/promote-release-phase" }
abort "migration phase must use the local promotion action" unless migration_action
inputs = migration_action.fetch("with")
abort "migration phase must not receive a database credential" unless (inputs.keys & %w[neon_database_url neon_api_key migrator_database_url]).empty?
abort "migration phase must receive only the staging migrator URL" unless inputs["migrator_url"] == "${{ vars.MIGRATOR_STAGING_URL }}"

services = cd.fetch("jobs").fetch("stage-services")
abort "services must wait for migration" unless Array(services.fetch("needs")).include?("stage-migration")

promote_steps = action.fetch("runs").fetch("steps")
migration_step = promote_steps.find { |step| step["name"] == "Promote migration payloads" }
abort "local promotion must expose the staging migrator URL only to migration" unless migration_step&.dig("env", "MIGRATOR_URL") == "${{ inputs.migrator_url }}"

abort "staging migration must use the fixed OIDC audience" unless adapter.include?("animichi:github-actions:migrator")
abort "staging migration must verify the applied sealed head" unless adapter.include?(".success == true and .appliedHead == $head")
staging_function = adapter[/^migrate_staging\(\) \{.*?^\}/m].to_s
abort "staging migration function must exist" if staging_function.empty?
abort "migration adapter must not use a database credential for staging" if staging_function.match?(/DATABASE_URL|NEON_API_KEY/)

migrator = File.read("workers/migrator/wrangler.toml")
abort "migrator DSN must come from the staging Secrets Store" unless migrator.include?('[[env.staging.secrets_store_secrets]]') && migrator.include?('binding = "MIGRATOR_DATABASE_URL"')

puts "Migration promotion contract: OIDC staging migrator precedes services and owns no database credential"
