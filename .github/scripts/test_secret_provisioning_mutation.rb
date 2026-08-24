# frozen_string_literal: true

require "open3"
require "tempfile"

CONTRACT = ".github/scripts/test_secret_provisioning_contract.rb"
SOURCES = {
  "SECRET_CONTRACT_CD" => ".github/workflows/cd.yml",
  "SECRET_CONTRACT_PHASE" => ".github/workflows/reusable-promote-release-phase.yml",
  "SECRET_CONTRACT_ADAPTER" => ".github/scripts/promote-release-unit.sh",
  "SECRET_CONTRACT_SYNC" => ".github/scripts/sync-edge-runtime-secrets.sh",
  "SECRET_CONTRACT_RENDERER" => ".github/scripts/edge-runtime-secrets.py"
}.freeze

def reject_mutation(label, key, before, after)
  source = File.read(SOURCES.fetch(key))
  abort "mutation source missing for #{label}" unless source.include?(before)
  Tempfile.create("secret-contract") do |file|
    file.write(source.sub(before, after)); file.flush
    _out, status = Open3.capture2e({ key => file.path }, "ruby", CONTRACT)
    abort "#{label} passed unexpectedly" if status.success?
  end
  puts "PASS: #{label} rejected"
end

reject_mutation("stage secret omitted", "SECRET_CONTRACT_CD", "      ZEN_GO_API_KEY: ${{ secrets.ZEN_GO_API_KEY }}\n", "")
reject_mutation("bulk regresses to put", "SECRET_CONTRACT_SYNC", "wrangler secret bulk", "wrangler secret put")
reject_mutation("preflight follows deploy", "SECRET_CONTRACT_ADAPTER",
                "  preflight_edge_runtime_secrets\n  run_worker_deploy \"$entry\"",
                "  run_worker_deploy \"$entry\"\n  preflight_edge_runtime_secrets")
reject_mutation("anonymous flag ignored", "SECRET_CONTRACT_RENDERER",
                'config["env"][environment]["vars"]["ANON_ACCESS_ENABLED"]', '"false"')

system("ruby", CONTRACT) || abort("pristine secret provisioning contract failed")
puts "PASS: pristine secret provisioning contract"
