# frozen_string_literal: true

# YAML load + merge-gating workflow walk for the CI↔pre-push parity contract
# (#1114). Behavioral: a workflow is in-universe when it triggers on
# pull_request / push / merge_group; local `uses: ./.github/workflows/*`
# reusables are followed. Job names and line numbers are not the identity.

require "yaml"

MERGE_EVENTS = %w[pull_request push merge_group].freeze

SKIP_USES_PREFIX = %w[
  actions/checkout
  actions/setup-node
  actions/setup-python
  actions/cache
  actions/upload-artifact
  actions/download-artifact
  actions/github-script
  pnpm/action-setup
  astral-sh/setup-uv
  dorny/paths-filter
  docker/
  .github/actions/setup
  .github/actions/install-atlas
].freeze

def load_yaml_file(path)
  text = File.read(path).sub(/^on:(?=[ \t#]|$)/, '"on":')
  YAML.safe_load(text, permitted_classes: [], permitted_symbols: [], aliases: true)
end

def workflow_triggers(wf)
  return nil unless wf.is_a?(Hash)

  raw = wf.key?("on") ? wf["on"] : wf[true]
  return raw if raw.is_a?(Hash)
  return { raw => nil } if raw.is_a?(String)
  return raw.to_h { |event| [event, nil] } if raw.is_a?(Array)

  nil
end

def merge_gating_workflow?(wf)
  on = workflow_triggers(wf)
  on.is_a?(Hash) && MERGE_EVENTS.any? { |event| on.key?(event) }
end

def uses_action_name(uses)
  uses.to_s.sub(%r{^\./}, "").split("@", 2).first.to_s
end

def skip_uses_action?(uses)
  name = uses_action_name(uses)
  SKIP_USES_PREFIX.any? { |prefix| name == prefix || name.start_with?(prefix) }
end

def skip_dependabot_job?(job)
  job["if"].to_s.include?("dependabot[bot]")
end

def job_working_directory(job)
  job.dig("defaults", "run", "working-directory")
end

def local_reusable?(uses)
  uses_action_name(uses).start_with?(".github/workflows/")
end

def local_composite?(uses)
  uses_action_name(uses).start_with?(".github/actions/")
end

def enqueue_merge_gating(workflows_dir)
  Dir.glob(File.join(workflows_dir, "*.yml")).sort.select do |path|
    merge_gating_workflow?(load_yaml_file(path))
  end
end

