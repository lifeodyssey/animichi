# frozen_string_literal: true

# #1013 AC5: tags cannot deploy and production consumes the exact artifacts
# already promoted to staging. The production path must never rebuild.

require "yaml"

WORKFLOWS = File.expand_path("../workflows", __dir__)

def workflow(dir, file)
  text = File.read(File.join(dir, file)).sub(/^on:(?=[ \t#]|$)/, '"on":')
  YAML.safe_load(text, aliases: true)
end

def workflow_triggers(value)
  value["on"] || value[true] || {}
end

def production_source(cd)
  cd.fetch("jobs").fetch("promote-production").fetch("steps")
    .map { |step| step["run"] }.compact.join("\n")
end

def assert_no_tag_trigger(dir, file)
  on = workflow_triggers(workflow(dir, file))
  push = on["push"]
  abort "#{file} must not have a push trigger on tags" if push.is_a?(Hash) && push.key?("tags")
  abort "#{file} must not have a tags trigger" if on.key?("tags")
end

def assert_no_production_build(cd)
  source = production_source(cd)
  forbidden = [/\b(?:docker|pnpm|npm)\s+build\b/, /wrangler\s+deploy.*--dry-run/]
  abort "production promotion must not run a build command" if forbidden.any? { |pattern| source.match?(pattern) }
  abort "production must consume the common immutable adapter" unless source.include?("promote-release-unit.sh")
end

def assert_immutable_consumption(dir, cd)
  source = File.read(File.join(dir, "cd.yml"))
  adapter = File.read(File.expand_path("promote-release-unit.sh", __dir__))
  promotion = File.read(File.expand_path("../actions/promote-release-phase/action.yml", __dir__))
  abort "production must download main-SHA release artifacts" unless source.include?("release-${{ github.sha }}-*")
  abort "promotion must verify the artifact before extraction" unless adapter.index("verify-release-artifact.py") < adapter.index("tar -xzf")
  abort "staging and production must use the same adapter" unless promotion.include?("promote-release-unit.sh")
  assert_no_production_build(cd)
end

def assert_ac5_contract(workflows_dir)
  assert_no_tag_trigger(workflows_dir, "cd.yml")
  abort "reusable build workflow must be deleted" if File.exist?(File.join(workflows_dir, "reusable-build-release-unit.yml"))
  abort "reusable promotion workflow must be deleted" if File.exist?(File.join(workflows_dir, "reusable-promote-release-phase.yml"))
  cd = workflow(workflows_dir, "cd.yml")
  abort "CD must deploy only from main pushes" unless workflow_triggers(cd).dig("push", "branches") == ["main"]
  assert_immutable_consumption(workflows_dir, cd)
  puts "AC5: main-only CD promotes verified main-SHA artifacts; production runs no build command"
end

assert_ac5_contract(WORKFLOWS) if $PROGRAM_NAME == __FILE__
