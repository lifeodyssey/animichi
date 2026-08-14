# frozen_string_literal: true

# #1013 AC5 contract: production workflow contains no build command for a
# promoted component, and tag creation cannot trigger deployment.
#
#   1. Tag-trigger ban: neither deploy.yml nor ci.yml (the only production
#      entry points) may declare a tags: trigger, and the reusable deploy
#      workflow must not either.
#   2. No build command for a promoted component: when a promoted artifact
#      digest is supplied, reusable-deploy-component.yml runs NO build command -
#      the build and build-once manifest steps are gated off and a consume step
#      takes their place.
#
# Exposes assert_ac5_contract(workflows_dir) so the mutation wrapper
# (test_promotion_ac5_mutation.rb) can run red/green probes against throwaway
# copies. Runs against the real workflows dir when invoked directly.
#
# Run: ruby .github/scripts/test_promotion_ac5_contract.rb

require "yaml"

WORKFLOWS = File.expand_path("../workflows", __dir__)

# `on:` is a YAML 1.1 boolean; accept both spellings (test_ci_contract.rb stance).
def load_workflow(dir, file)
  path = File.join(dir, file)
  text = File.read(path).sub(/^on:(?=[ \t#]|$)/, "\"on\":")
  YAML.safe_load(text, aliases: true)
end

def triggers(wf)
  wf["on"] || wf[true]
end

def assert_ac5_contract(workflows_dir)
  # ---- 1. Tag creation cannot trigger deployment ----
  %w[ci.yml deploy.yml].each do |file|
    wf = load_workflow(workflows_dir, file)
    on = triggers(wf)
    abort "#{file} must declare on:" unless on.is_a?(Hash)
    push = on["push"]
    pushtags = push.is_a?(Hash) && push.key?("tags")
    abort "#{file} must not have a push trigger on tags" if pushtags
    abort "#{file} must not have a tags trigger" if on.key?("tags")
  end
  reusable = load_workflow(workflows_dir, "reusable-deploy-component.yml")
  reusable_on = triggers(reusable)
  abort "reusable-deploy-component.yml must not have a tags trigger" if reusable_on.is_a?(Hash) && reusable_on.key?("tags")
  puts "AC5: deployment cannot be triggered by tag creation (workflow push/tags ban)"

  # ---- 2. No build command for a promoted component ----
  deploy_component = File.read(File.join(workflows_dir, "reusable-deploy-component.yml"))
  abort "must have a Consume approved promotion artifact step (no-build consume)" unless deploy_component.include?("Consume approved promotion artifact")
  abort "consume step must fail closed when no artifact can be loaded" unless deploy_component.include?("Refusing to deploy a promoted component with no artifact")

  build_steps = deploy_component.scan(/name: Build component|name: Build-once promotion manifest/).size
  gated = deploy_component.scan(/promotion_artifact_digest == ''/).size
  abort "expected every build step gated by promotion_artifact_digest == '', found #{gated} gate(s)" if gated < build_steps

  puts "AC5: promoted components deploy by consuming the approved artifact; no build command runs in the promoted path"
end

# Run against the real workflows dir when invoked directly.
assert_ac5_contract(WORKFLOWS) if $PROGRAM_NAME == __FILE__
