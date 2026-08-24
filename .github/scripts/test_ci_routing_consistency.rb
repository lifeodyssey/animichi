# frozen_string_literal: true

# Local changed-package routing and the CI manifest must own the same roots.
require "json"
require "open3"

ROOT = File.expand_path("../..", __dir__)
WORKSPACE_LIB = File.join(ROOT, "scripts/local-gates/workspace-packages.sh")
ROUTER = File.join(ROOT, "scripts/local-gates/changed-packages.sh")
MANIFEST = JSON.parse(File.read(File.join(ROOT, ".github/ci/components.json")))

def mapped_workspace(path)
  script = 'set -euo pipefail; source "$1"; load_workspace_packages; match_workspace_package "$2"; printf "%s" "$matched_pkg"'
  output, status = Open3.capture2({ "GATE_REPO_ROOT" => ROOT }, "bash", "-c", script, "bash", WORKSPACE_LIB, path)
  status.success? ? output : nil
end

roots = MANIFEST.fetch("components").to_h do |component|
  patterns = component.fetch("paths") - component.fetch("test_triggers", [])
  abort "component must own one root: #{component.fetch('name')}" unless patterns.size == 1
  [patterns.first.delete_suffix("/**"), component.fetch("name")]
end

roots.each do |root, component|
  next if %w[db docs].include?(component)
  mapped = mapped_workspace("#{root}/probe.ts")
  abort "manifest/local router drift for #{root}: #{component} != #{mapped}" unless mapped == component
end

router = File.read(ROUTER)
abort "local router lost migrations -> db" unless router.include?('migrations/*) packages+="db"')
abort "local router lost docs -> docs" unless router.include?('docs/*) packages+="docs"')
puts "CI routing: manifest and local changed-package roots agree"
