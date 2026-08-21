# frozen_string_literal: true
#
# AC3 (issue #679): the local changed-component router used by the pre-push
# gate (scripts/local-gates/changed-packages.sh, #907/#1003/#1113) must agree
# with CI's per-package lanes: a file changed locally must route locally to the
# SAME component lane that a push of that file would trigger in CI. This is
# the deterministic changed-component fan-out contract — given one path set,
# local pre-push and CI select the same package set, so a gate you pass here
# cannot be skipped by CI path filtering (and vice-versa).
#
# Asserts:
#   A. the router maps every component root dir to the expected package
#      (workspace-derived match; `migrations` stays an explicit path bucket);
#   B. every component's pipeline-*.yml push `paths` closure includes that
#      component's root dir (local routing == CI fan-out);
#   C. the router's `migrations/*` maps to `db` and pipeline-db.yml push
#      paths cover migrations/** (schema fan-out).
#
require "open3"
require "yaml"

REPO_ROOT = File.expand_path("../..", __dir__)
WORKSPACE_LIB = File.join(REPO_ROOT, "scripts", "local-gates", "workspace-packages.sh")
ROUTER = File.join(REPO_ROOT, "scripts", "local-gates", "changed-packages.sh")
WORKFLOWS = File.join(REPO_ROOT, ".github", "workflows")

# component dir prefix -> expected router package -> owning pipeline file.
COMPONENTS = {
  "apps/agent" => ["agent", "pipeline-agent.yml"],
  "apps/web" => ["web", "pipeline-web.yml"],
  "workers/catalog" => ["catalog", "pipeline-catalog.yml"],
  "workers/users" => ["users", "pipeline-users.yml"],
  "workers/edge" => ["edge", "pipeline-edge.yml"],
  "workers/migrator" => ["migrator", "pipeline-migrator.yml"],
  "workers/doorbell" => ["doorbell", "pipeline-doorbell.yml"],
  "packages/contract" => ["contract", "pipeline-contract.yml"],
  "infra" => ["infra", "pipeline-infra.yml"],
  "migrations" => ["db", "pipeline-db.yml"]
}.freeze

def mapped_workspace_package(path)
  script = 'set -euo pipefail; source "$1"; load_workspace_packages; match_workspace_package "$2"; printf "%s\n" "$matched_pkg"'
  stdout, status = Open3.capture2({ "GATE_REPO_ROOT" => REPO_ROOT }, "bash", "-c", script, "bash", WORKSPACE_LIB, path)
  stdout.strip if status.success?
end

def mapped_package(dir, expected_pkg)
  glob = "#{dir}/*"
  return "db" if expected_pkg == "db" && File.read(ROUTER).include?("#{glob}) packages+=\"db\"")

  mapped_workspace_package("#{dir}/probe.ts")
end

def pipeline_covers?(pipeline, dir)
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

COMPONENTS.each do |dir, (expected_pkg, pipeline)|
  glob = "#{dir}/*"
  mapped = mapped_package(dir, expected_pkg)
  abort "AC3: router missing mapping for #{glob} (expected #{expected_pkg})" unless mapped == expected_pkg
  pipeline_covers?(pipeline, dir)
end

puts "AC3 routing: #{COMPONENTS.size} components — local router and CI fan-out agree (deterministic contract)"
