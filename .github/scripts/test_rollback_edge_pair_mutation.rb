# frozen_string_literal: true

require "stringio"
require_relative "test_production_safety_contract"


SOURCE = File.read(".github/workflows/rollback.yml")


def rejected?(source)
  assert_rollback_source(source)
  false
rescue SystemExit
  true
end

def expect_rejected(label, source)
  previous, $stderr = $stderr, StringIO.new
  killed = rejected?(source)
  abort "FAIL: #{label} was accepted" unless killed
  puts "PASS: #{label} rejected"
ensure
  $stderr = previous
end

def replace_occurrence(source, text, replacement, occurrence)
  seen = 0
  source.gsub(text) do |match|
    seen += 1
    seen == occurrence ? replacement : match
  end
end


expect_rejected("missing paired agent download", SOURCE.sub('name: release-${{ inputs.source_sha }}-agent', "name: missing-agent"))
expect_rejected("missing paired agent verification", SOURCE.sub('verify-release-artifact.py "$agent" agent', "true # agent verification removed"))
edge_call = 'bash .github/scripts/promote-release-unit.sh edge production "$SOURCE_SHA" "$RUNNER_TEMP/rollback-release/edge"'
agent_call = SOURCE.match(/bash .github\/scripts\/promote-release-unit.sh agent production[^\n]+/)[0]
expect_rejected("edge promoted before its image", SOURCE.sub(edge_call, agent_call))
expect_rejected("dynamic previous-version rollback", SOURCE + "\npnpm exec wrangler rollback\n")
expect_rejected("selected run identity removed", SOURCE.gsub("run-id: ${{ inputs.release_run_id }}", "run-id: latest"))
paired_latest = replace_occurrence(SOURCE, "run-id: ${{ inputs.release_run_id }}", "run-id: latest", 2)
expect_rejected("paired agent downloaded from latest run", paired_latest)
expect_rejected("artifact-expiry recovery removed", SOURCE.gsub("expired sealed artifact", "unavailable payload"))
ROLLBACK_RUNTIME_SECRETS.each do |name|
  expect_rejected("missing rollback #{name}", SOURCE.sub(/^\s+#{name}:.*$\n/, ""))
end

puts "All rollback edge-pair mutation probes passed."
