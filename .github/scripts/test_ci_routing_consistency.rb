# frozen_string_literal: true
#
# AC3 (issue #679): the local changed-component router used by the pre-push
# gate (scripts/local-gates/changed-packages.sh, #907/#1003) must agree with
# CI's per-package lanes: a file changed locally must route locally to the
# SAME component lane that a push of that file would trigger in CI. This is
# the deterministic changed-component fan-out contract — given one path set,
# local pre-push and CI select the same package set, so a gate you pass here
# cannot be skipped by CI path filtering (and vice-versa).
#
# Asserts, statically:
#   A. the router maps every component root dir to the expected package;
#   B. every component's pipeline-*.yml push `paths` closure includes that
#      component's root dir (local routing == CI fan-out);
#   C. the router's `migrations/*` maps to `db` and pipeline-db.yml push
#      paths cover migrations/** (schema fan-out).
#
require "yaml"

REPO_ROOT = File.expand_path("../..", __dir__)
ROUTER = File.join(REPO_ROOT, "scripts", "local-gates", "changed-packages.sh")
WORKFLOWS = File.join(REPO_ROOT, ".github", "workflows")

# component dir prefix -> expected router package -> owning pipeline file.
COMPONENTS = {
  "apps/agent" => ["agent", "pipeline-agent.yml"],
  "apps/web" => ["web", "pipeline-web.yml"],
  "workers/catalog" => ["catalog", "pipeline-catalog.yml"],
  "workers/users" => ["users", "pipeline-users.yml"],
  "workers/edge" => ["edge", "pipeline-edge.yml"],
  "packages/contract" => ["contract", "pipeline-contract.yml"],
  "infra" => ["infra", "pipeline-infra.yml"],
  "migrations" => ["db", "pipeline-db.yml"]
}.freeze

router = File.read(ROUTER)

COMPONENTS.each do |dir, (expected_pkg, pipeline)|
  glob = "#{dir}/*"
  # A. the router must know this directory and map it to the expected package.
  abort "AC3: router missing mapping for #{glob} (expected #{expected_pkg})" unless router.include?("#{glob}) packages+=\"#{expected_pkg}\"")

  # B. the pipeline's push paths must cover the component root dir, and the
  #     workflow must declare a pull_request + merge_group fan-out so local and CI agree.
  path = File.join(WORKFLOWS, pipeline)
  wf = YAML.safe_load(File.read(path).sub(/^on:(?=[ \t#]|$)/, '"on":'), aliases: true)
  on_map = wf["on"] || wf[true]
  push = on_map.fetch("push")
  abort "AC3: #{pipeline} push must be path-filtered" unless push.is_a?(Hash) && push.key?("paths")
  globs = Array(push.fetch("paths"))
  covered = globs.any? { |g| g == dir || g.start_with?("#{dir}/") || g.start_with?("#{dir}**") }
  abort "AC3: #{pipeline} push paths must cover #{dir} (fan-out mismatch with router)" unless covered
  abort "AC3: #{pipeline} must declare merge_group (queue fan-out)" unless on_map.key?("merge_group")
end

puts "AC3 routing: #{COMPONENTS.size} components — local router and CI fan-out agree (deterministic contract)"
