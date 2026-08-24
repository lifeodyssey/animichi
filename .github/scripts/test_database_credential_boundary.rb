#!/usr/bin/env ruby
# frozen_string_literal: true

catalog = File.read("workers/catalog/wrangler.toml")
users = File.read("workers/users/wrangler.toml")
cd = File.read(".github/workflows/cd.yml")
staging = File.read(".github/actions/promote-release-phase/action.yml")
adapter = File.read(".github/scripts/promote-release-unit.sh")

bindings = {
  "catalog" => [catalog, "CATALOG_DATABASE_URL_PROD"],
  "users" => [users, "USERS_DATABASE_URL_PROD"],
}
bindings.each do |worker, (source, secret_name)|
  production = source.lines.drop_while { |line| line.chomp != "[env.production]" }.join
  abort "#{worker} production must bind DATABASE_URL from Secrets Store" unless production.include?("[[env.production.secrets_store_secrets]]") && production.include?('binding = "DATABASE_URL"')
  abort "#{worker} production must use #{secret_name}" unless production.include?("secret_name = \"#{secret_name}\"")
end

abort "staging promotion must not receive the production database DSN" if staging.include?("NEON_DATABASE_URL")
abort "production database migration must receive its scoped DSN" unless cd.include?('NEON_DATABASE_URL: ${{ secrets.NEON_DATABASE_URL }}')
abort "production migration must scope Atlas to the public schema" unless adapter.include?("search_path=public") && adapter.include?("--revisions-schema public")
abort "Worker promotion must never upload DATABASE_URL" if adapter.match?(/wrangler secret (put|bulk).*DATABASE_URL/)

puts "Database credential boundary: runtime Workers use Secrets Store; only production migration consumes the owner DSN"
