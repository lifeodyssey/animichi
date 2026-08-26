# frozen_string_literal: true

# CD's stage chain used `if: !failure() && !cancelled()` with `needs` listing only the
# direct predecessor stage. `failure()`/`cancelled()` only inspect jobs literally present
# in `needs` — a stage that failed for real makes its `if` evaluate false, so *that stage's
# own result* is `skipped`, not `failure`. A downstream stage whose `needs` names only the
# immediate predecessor then sees a clean `skipped` (not a `failure`) and its own `if`
# passes, so it runs anyway — the failure evaporates one hop past where it happened, and
# the leak repeats at every later hop until it reaches promote-production. Fix: every
# downstream stage's `needs` lists every earlier stage directly, so a genuine failure
# anywhere in the chain shows up in `failure()` at every later stage, not only the one
# immediately after it. A stage that is skipped only because its own cohort was empty
# (`route.outputs.<domain> == '[]'`) still reports `skipped` and must NOT trip `failure()`
# — that is the legitimate, non-blocking skip this chain has to keep allowing; distinguishing
# the two is the point of this contract, not just requiring a longer `needs` list.
# docs/specs/2026-08-26-system-health-audit.md §2.2 (`cd.yml:79-107,226-227` at audit time).

require "yaml"

def workflow(path)
  YAML.safe_load(File.read(path), aliases: true)
end

CD_PATH = File.expand_path("../workflows/cd.yml", __dir__)

# Order matters: each entry after the first must see every earlier entry directly.
CHAIN = %w[
  route
  build-release-artifacts
  stage-foundation
  stage-migration
  stage-services
  stage-edge
  stage-web
  post-staging
  promote-production
].freeze

# build-release-artifacts is part of the needs chain everything downstream must see, but
# it isn't itself one of the ordered promotion stages the audit's skip-propagation finding
# is about — it has no `route.outputs.<domain>` gate of its own to preserve.
STAGES = (CHAIN - %w[route build-release-artifacts]).freeze

def assert_full_chain_in_needs(jobs)
  CHAIN.each_with_index do |name, index|
    next if index.zero?

    needs = Array(jobs.fetch(name).fetch("needs"))
    predecessors = CHAIN[0...index]
    missing = predecessors - needs
    next if missing.empty?

    abort "#{name} must list every earlier stage in needs, not just its direct " \
          "predecessor — a failure two or more stages back must reach it directly " \
          "(missing: #{missing.join(', ')})"
  end
end

def assert_failure_and_cancelled_gate(jobs)
  STAGES.each do |name|
    condition = jobs.fetch(name).fetch("if").to_s
    abort "#{name} must gate on !failure()" unless condition.include?("!failure()")
    abort "#{name} must gate on !cancelled()" unless condition.include?("!cancelled()")
  end
end

def assert_planned_skip_still_allowed(jobs)
  # A planned-empty-cohort skip must remain expressible purely through the stage's own
  # `route.outputs.<domain>` check — the accumulated `needs` list must never be paired
  # with a stricter `if` (e.g. requiring every predecessor's `result == 'success'`) that
  # would also block on a predecessor's legitimate empty-cohort skip.
  domain_by_stage = {
    "stage-foundation" => "foundation",
    "stage-migration" => "migration",
    "stage-services" => "services",
    "stage-edge" => "edge",
    "stage-web" => "web",
  }
  domain_by_stage.each do |name, domain|
    condition = jobs.fetch(name).fetch("if").to_s
    abort "#{name} must gate its own run on its own cohort (route.outputs.#{domain})" \
      unless condition.include?("needs.route.outputs.#{domain} != '[]'")
  end
end

def assert_cd_skip_propagation_contract(path)
  jobs = workflow(path).fetch("jobs")
  assert_full_chain_in_needs(jobs)
  assert_failure_and_cancelled_gate(jobs)
  assert_planned_skip_still_allowed(jobs)
  puts "CD skip-propagation contract: every stage sees every earlier stage's failure " \
       "directly; an empty-cohort skip stays non-blocking"
end

assert_cd_skip_propagation_contract(CD_PATH) if $PROGRAM_NAME == __FILE__
