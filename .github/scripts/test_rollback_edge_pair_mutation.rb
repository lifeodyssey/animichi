# frozen_string_literal: true

require "stringio"
require_relative "test_production_safety_contract"


WORKFLOW_SOURCE = File.read(".github/workflows/rollback.yml")
ACTION_SOURCE = File.read(".github/actions/rollback-release/action.yml")


def rejected?(source, assertion)
  assertion.call(source)
  false
rescue SystemExit
  true
end

def expect_rejected(label, source, assertion = method(:assert_rollback_action_source))
  previous, $stderr = $stderr, StringIO.new
  killed = rejected?(source, assertion)
  abort "FAIL: #{label} was accepted" unless killed
  puts "PASS: #{label} rejected"
ensure
  $stderr = previous
end

def replace_occurrence(source, text, replacement, occurrence)
  seen = 0
  result = source.gsub(text) do |match|
    seen += 1
    seen == occurrence ? replacement : match
  end
  abort "FAIL: mutation occurrence #{occurrence} not found" if seen < occurrence
  result
end


expect_rejected("missing paired agent download", ACTION_SOURCE.sub('name: release-${{ inputs.source_sha }}-agent', "name: missing-agent"))
expect_rejected("missing paired agent verification", ACTION_SOURCE.sub('verify-release-artifact.py "$agent" agent', "true # agent verification removed"))
edge_call = 'bash .github/scripts/promote-release-unit.sh edge production "$SOURCE_SHA" "$RUNNER_TEMP/rollback-release/edge"'
agent_call = ACTION_SOURCE.match(/bash .github\/scripts\/promote-release-unit.sh agent production[^\n]+/)[0]
expect_rejected("edge promoted before its image", ACTION_SOURCE.sub(edge_call, agent_call))
summary = '          echo "Run the manual checks in docs/ops/deployment.md before closing the incident."'
dynamic = ACTION_SOURCE.sub(summary, "          pnpm exec wrangler rollback\n#{summary}")
expect_rejected("dynamic previous-version rollback", dynamic)
expect_rejected("selected run identity removed", ACTION_SOURCE.gsub("run-id: ${{ inputs.release_run_id }}", "run-id: latest"))
paired_latest = replace_occurrence(ACTION_SOURCE, "run-id: ${{ inputs.release_run_id }}", "run-id: latest", 2)
expect_rejected("paired agent downloaded from latest run", paired_latest)
expect_rejected("artifact-expiry recovery removed", ACTION_SOURCE.gsub("expired sealed artifact", "unavailable payload"))
expect_rejected("composite boundary removed", ACTION_SOURCE.sub("using: composite", "using: node24"))
expect_rejected("optional rollback action input", ACTION_SOURCE.sub("required: true", "required: false"))
secret_override = /^\s+#{ROLLBACK_SECRETS.first}: ""$\n/
expect_rejected("child action secret isolation removed", ACTION_SOURCE.sub(secret_override, ""))
boundary = method(:assert_rollback_workflow_boundary)
expect_rejected("local rollback action removed", WORKFLOW_SOURCE.sub(ROLLBACK_ACTION, "./missing-action"), boundary)
expect_rejected("untrusted rollback checkout", WORKFLOW_SOURCE.sub("ref: refs/heads/main", "ref: refs/heads/feature"), boundary)
expect_rejected("credential-persisting checkout", WORKFLOW_SOURCE.sub("persist-credentials: false", "persist-credentials: true"), boundary)
ROLLBACK_INPUTS.each_key do |name|
  expect_rejected("rollback #{name} input drift", WORKFLOW_SOURCE.sub("#{name}: ${{ inputs.#{name} }}", "#{name}: wrong"), boundary)
end
(ROLLBACK_SECRETS + ROLLBACK_VARS).each do |name|
  expect_rejected("missing rollback #{name}", WORKFLOW_SOURCE.sub(/^\s+#{name}:.*$\n/, ""), boundary)
end

puts "All rollback edge-pair mutation probes passed."
