#!/usr/bin/env ruby
# frozen_string_literal: true

require "yaml"

catalog = File.read("workers/catalog/wrangler.toml")
users = File.read("workers/users/wrangler.toml")
edge = File.read("workers/edge/wrangler.toml")
cd = File.read(".github/workflows/cd.yml")
staging = File.read(".github/actions/promote-release-phase/action.yml")
adapter = File.read(".github/scripts/promote-release-unit.sh")

# The production env block only. `edge` declares [env.production] BEFORE
# [env.staging], so reading to end-of-file would let a staging binding satisfy a
# production assertion; every block stops at the next top-level env header.
def production_block(source)
  source.lines.drop_while { |line| line.chomp != "[env.production]" }
        .take_while { |line| !line.chomp.match?(/\A\[env\.(?!production)/) }.join
end

bindings = {
  "catalog" => [catalog, "DATABASE_URL", "CATALOG_DATABASE_URL_PROD"],
  "users" => [users, "DATABASE_URL", "USERS_DATABASE_URL_PROD"],
  # W4-1 (#1314): the agent container's DSN reaches it through the edge Worker's
  # binding, so the edge is the third runtime consumer of a role-scoped store
  # secret — and the _PROD suffix is what keeps the one shared store's
  # production entry distinct from staging's.
  "edge" => [edge, "AGENT_SVC_DATABASE_URL", "AGENT_SVC_DATABASE_URL_PROD"],
}
bindings.each do |worker, (source, binding, secret_name)|
  production = production_block(source)
  abort "#{worker} production must bind #{binding} from Secrets Store" unless production.include?("[[env.production.secrets_store_secrets]]") && production.include?("binding = \"#{binding}\"")
  abort "#{worker} production must use #{secret_name}" unless production.include?("secret_name = \"#{secret_name}\"")
end

production_steps = YAML.safe_load(cd, aliases: true)
                       .fetch("jobs").fetch("promote-production").fetch("steps").map { |step| step["name"] }
foundation_at = production_steps.index("Promote production foundation payloads")
edge_at = production_steps.index("Promote production edge payload")
abort "production promotion must keep its foundation and edge steps" unless foundation_at && edge_at
abort "the production edge deploy must follow the Pulumi apply that writes its store secret" unless foundation_at < edge_at

abort "staging promotion must not receive the production database DSN" if staging.include?("NEON_DATABASE_URL")
abort "production database migration must receive its scoped DSN" unless cd.include?('NEON_DATABASE_URL: ${{ secrets.NEON_DATABASE_URL }}')
abort "production migration must scope Atlas to the public schema" unless adapter.include?("search_path=public") && adapter.include?("--revisions-schema public")
abort "Worker promotion must never upload DATABASE_URL" if adapter.match?(/wrangler secret (put|bulk).*DATABASE_URL/)

puts "Database credential boundary: runtime Workers use Secrets Store; only production migration consumes the owner DSN"
