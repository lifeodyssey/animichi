# frozen_string_literal: true

require "yaml"

source = File.read(".github/workflows/cd.yml")
adapter = File.read(".github/scripts/promote-release-unit.sh")
abort "retired doorbell must not remain in CD" if source.match?(/doorbell|legacy-cd/)
abort "retired doorbell workflow must be absent" if File.exist?(".github/workflows/reusable-ring-doorbell.yml")
abort "Workers must deploy sealed bundles without rebuilding" unless adapter.include?("wrangler deploy") && adapter.include?("--no-bundle")
abort "web must deploy its sealed output" unless adapter.include?("apps/web/.output/server/index.mjs")
abort "web runtime config must be injected at promotion" unless adapter.include?("inject-release-web-runtime-config.mjs")

puts "Worker promotion contract: direct sealed staging promotion with no doorbell hop"
