#!/usr/bin/env ruby
# frozen_string_literal: true

# SAFE-1 Phase B1: immutable production release manifest resolver.
#
# Reads .github/release-manifests/production-pre-campaign.json (a closed-schema,
# content-addressed pin of the pre-campaign production surface), validates every
# field against the pinned schema + expected component table, and emits a typed
# public output document. It never reads, prints, or forwards secret values —
# the manifest carries secret NAMES only.
#
# A squash merge may replace commit identities, but the referenced manifest
# blob stays content-addressed: this resolver hard-pins both the file SHA-256
# and the Git blob object ID, so altering any manifest field (even while keeping
# the pinned identities) fails closed.
#
# Usage:
#   ruby release-manifest-resolver.rb <manifest.json> <component> [source_revision]
#
# Exit 0 + one JSON document on stdout when valid; exit 1 with one `error:`
# line per failure class on stderr otherwise (never partial stdout output).

require "json"
require "digest"
require "shellwords"
require_relative "release-manifest-validation"

MANIFEST_PATH = ARGV[0]
COMPONENT_KEY = ARGV[1]
SOURCE_REVISION = ARGV[2]

# ── Pinned identities (computed at B1 creation; recompute only with a new
#    manifest version and a deliberate re-pin) ──────────────────────────────
PINNED_MANIFEST_SHA256 = "c266a5ea9cdde5fa94f06a71e511bf03cc7da9a84f66f41d0168933745b00738"
PINNED_MANIFEST_BLOB_ID = "a06984210bfbc4e640fea297e64858b2a4a87f82"

unless MANIFEST_PATH && COMPONENT_KEY
  warn "usage: ruby release-manifest-resolver.rb <manifest.json> <component> [source_revision]"
  exit 1
end

begin
  manifest_text = File.read(MANIFEST_PATH)
rescue Errno::ENOENT
  warn "error: manifest not found: #{MANIFEST_PATH}"
  exit 1
end

begin
  manifest = JSON.parse(manifest_text)
rescue JSON::ParserError => e
  warn "error: manifest is not valid JSON: #{e.message}"
  exit 1
end

errors = []

# ── Pinned identity checks ──────────────────────────────────────────────────
file_sha256 = Digest::SHA256.file(MANIFEST_PATH).hexdigest
unless file_sha256 == PINNED_MANIFEST_SHA256
  add_error(errors, "manifest SHA-256 #{file_sha256} does not match pinned #{PINNED_MANIFEST_SHA256}; altering any field while keeping the pinned identity is not allowed")
end

begin
  blob_id = `git hash-object #{MANIFEST_PATH.shellescape}`.strip
  blob_id = nil unless blob_id.match?(/\A[0-9a-f]{40}\z/)
rescue StandardError
  blob_id = nil
end
if blob_id && blob_id != PINNED_MANIFEST_BLOB_ID
  add_error(errors, "manifest Git blob #{blob_id} does not match pinned #{PINNED_MANIFEST_BLOB_ID}")
end

# ── Closed-schema validation (helpers in release-manifest-validation.rb) ────
validate_manifest(errors, manifest, COMPONENT_KEY)

if errors.any?
  warn errors.join("\n")
  exit 1
end

component = manifest.fetch("components").fetch(COMPONENT_KEY)
revision_matches = !SOURCE_REVISION.nil? && SOURCE_REVISION == manifest.fetch("source_revision")
# Deploy eligibility requires BOTH the candidate match AND the manifest's own
# per-component deploy_eligible flag — a manifest that marks a component
# ineligible must never deploy, even with a matching revision.
deploy_eligible = if SOURCE_REVISION.nil?
  nil
else
  revision_matches && component.fetch("deploy_eligible")
end

reason = if SOURCE_REVISION.nil?
  "no candidate supplied; deploy verdict not computed"
elsif !revision_matches
  "candidate #{SOURCE_REVISION} is not the pinned pre-campaign source #{manifest.fetch('source_revision')}"
elsif !component.fetch("deploy_eligible")
  "component #{COMPONENT_KEY} is marked deploy-ineligible by the pinned manifest"
else
  "candidate matches pinned pre-campaign source #{manifest.fetch('source_revision')}"
end

output = {
  manifest_sha256: file_sha256,
  manifest_blob_id: blob_id,
  source_revision: manifest.fetch("source_revision"),
  atlas: manifest.fetch("atlas"),
  component: {
    key: COMPONENT_KEY,
    working_directory: component.fetch("working_directory"),
    worker_name: component.fetch("worker_name"),
    wrangler_config: component.fetch("wrangler_config"),
    environment: component.fetch("environment"),
    pulumi_stack: component.fetch("pulumi_stack"),
    run_pulumi: component.fetch("run_pulumi"),
    build_filter: component.fetch("build_filter"),
    worker_secrets: component.fetch("worker_secrets"),
    post_deploy_secrets: component.fetch("post_deploy_secrets"),
    depends_on: component.fetch("depends_on"),
    deploy_eligible: component.fetch("deploy_eligible"),
    rollback_eligible: component.fetch("rollback_eligible")
  },
  eligibility: {
    deploy: deploy_eligible,
    rollback: component.fetch("rollback_eligible"),
    reason: reason
  }
}

puts JSON.generate(output)
exit 0
