#!/usr/bin/env ruby
# frozen_string_literal: true

# SAFE-1 Phase B1: immutable production release manifest resolver.
#
# Reads .github/release-manifests/production-pre-campaign.json (a closed-schema,
# content-addressed pin of the pre-campaign production surface), validates every
# field against the pinned schema + expected component table below, and emits a
# typed public output document. It never reads, prints, or forwards secret
# values — the manifest carries secret NAMES only.
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

MANIFEST_PATH = ARGV[0]
COMPONENT_KEY = ARGV[1]
SOURCE_REVISION = ARGV[2]

# ── Pinned identities (computed at B1 creation; recompute only with a new
#    manifest version and a deliberate re-pin) ──────────────────────────────
PINNED_MANIFEST_SHA256 = "1ffcfe1bf4815e0e0e890193cbfdeb28d9748f94bb98db88106000af708f536c"
PINNED_MANIFEST_BLOB_ID = "2aef389878e321ddc3d4d86922fde30ad2ab6491"
PINNED_ATLAS_DIGEST_SHA256 = "e0428e7a9b25745a8d1f22f8fbcec5c915a8e18d56a7a45f5fe3554158b6ab80"
PINNED_ATLAS_TARGET = "20260809000031"

SCHEMA_VERSION = 1
FULL_SHA_RE = /\A[0-9a-f]{40}\z/
SHA256_RE = /\A[0-9a-f]{64}\z/
ATLAS_TARGET_RE = /\A\d{14}\z/
SECRET_NAME_RE = /\A[A-Z][A-Z0-9_]*\z/

# Expected component surface (from SAFE-1 §2 and the ci.yml/deploy.yml
# production jobs). The manifest must match this exactly — a drift in worker
# name, directory, config, flags, or secret list fails closed.
EXPECTED_COMPONENTS = {
  "catalog" => {
    working_directory: "workers/catalog",
    worker_name: "catalog",
    wrangler_config: "workers/catalog/wrangler.toml",
    environment: "production",
    pulumi_stack: "prod",
    run_pulumi: true,
    build_filter: "",
    worker_secrets: %w[DATABASE_URL],
    post_deploy_secrets: [],
    depends_on: []
  },
  "web" => {
    working_directory: "apps/web",
    worker_name: "animichi-web",
    wrangler_config: "apps/web/wrangler.jsonc",
    environment: "production",
    pulumi_stack: "prod",
    run_pulumi: false,
    build_filter: "web",
    worker_secrets: [],
    post_deploy_secrets: [],
    depends_on: []
  },
  "users" => {
    working_directory: "workers/users",
    worker_name: "users",
    wrangler_config: "workers/users/wrangler.toml",
    environment: "production",
    pulumi_stack: "prod",
    run_pulumi: false,
    build_filter: "",
    worker_secrets: %w[DATABASE_URL NEON_AUTH_JWKS_URL],
    post_deploy_secrets: [],
    depends_on: %w[catalog]
  },
  "maintenance" => {
    working_directory: "workers/jobs",
    worker_name: "jobs",
    wrangler_config: "workers/jobs/wrangler.toml",
    environment: "production",
    pulumi_stack: "prod",
    run_pulumi: false,
    build_filter: "",
    worker_secrets: %w[AGENT_DATABASE_URL],
    post_deploy_secrets: [],
    depends_on: %w[catalog]
  },
  "root" => {
    working_directory: ".",
    worker_name: "animichi",
    wrangler_config: "workers/edge/wrangler.toml",
    environment: "production",
    pulumi_stack: "prod",
    run_pulumi: false,
    build_filter: "",
    worker_secrets: %w[
      SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL
      MIMO_API_KEY DEEPSEEK_API_KEY GOOGLE_MAPS_API_KEY LOGFIRE_TOKEN
      CORS_ALLOWED_ORIGIN
    ],
    post_deploy_secrets: %w[TURNSTILE_SECRET ANON_ID_SECRET],
    depends_on: %w[users]
  }
}.freeze

# Allowed top-level keys. Closed schema: anything else is a validation failure.
ALLOWED_TOP_LEVEL_KEYS = %w[
  schema_version release_name description source_revision atlas components
].freeze

ALLOWED_COMPONENT_KEYS = %w[
  working_directory worker_name wrangler_config environment pulumi_stack
  run_pulumi build_filter worker_secrets post_deploy_secrets depends_on
  deploy_eligible rollback_eligible
].freeze

errors = []

def add_error(errors, message)
  errors << "error: #{message}"
end

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

# ── Closed-schema validation ────────────────────────────────────────────────
unless manifest.is_a?(Hash)
  add_error(errors, "manifest root must be an object")
end

if manifest.is_a?(Hash)
  unknown = manifest.keys - ALLOWED_TOP_LEVEL_KEYS
  add_error(errors, "unknown top-level field(s): #{unknown.sort.join(', ')}") unless unknown.empty?

  unless manifest["schema_version"] == SCHEMA_VERSION
    add_error(errors, "schema_version must be #{SCHEMA_VERSION}, got #{manifest['schema_version'].inspect}")
  end

  revision = manifest["source_revision"]
  unless revision.is_a?(String) && revision.match?(FULL_SHA_RE)
    add_error(errors, "source_revision must be a full 40-hex SHA, got #{revision.inspect}")
  end

  atlas = manifest["atlas"]
  unless atlas.is_a?(Hash)
    add_error(errors, "atlas must be an object")
  else
    unknown_atlas = atlas.keys - %w[directory target digest_sha256]
    add_error(errors, "unknown atlas field(s): #{unknown_atlas.sort.join(', ')}") unless unknown_atlas.empty?
    add_error(errors, "atlas.directory must be migrations/neon, got #{atlas['directory'].inspect}") unless atlas["directory"] == "migrations/neon"
    target = atlas["target"]
    unless target.is_a?(String) && target.match?(ATLAS_TARGET_RE)
      add_error(errors, "atlas.target must be a 14-digit migration timestamp, got #{target.inspect}")
    end
    add_error(errors, "atlas.target must be pinned #{PINNED_ATLAS_TARGET}, got #{target.inspect}") unless target == PINNED_ATLAS_TARGET
    digest = atlas["digest_sha256"]
    unless digest.is_a?(String) && digest.match?(SHA256_RE)
      add_error(errors, "atlas.digest_sha256 must be a 64-hex SHA-256, got #{digest.inspect}")
    end
    add_error(errors, "atlas.digest_sha256 must be pinned #{PINNED_ATLAS_DIGEST_SHA256}, got #{digest.inspect}") unless digest == PINNED_ATLAS_DIGEST_SHA256
  end

  components = manifest["components"]
  unless components.is_a?(Hash)
    add_error(errors, "components must be an object")
  else
    unknown_components = components.keys - EXPECTED_COMPONENTS.keys
    add_error(errors, "unknown component(s): #{unknown_components.sort.join(', ')}") unless unknown_components.empty?
    missing_components = EXPECTED_COMPONENTS.keys - components.keys
    add_error(errors, "missing component(s): #{missing_components.sort.join(', ')}") unless missing_components.empty?

    EXPECTED_COMPONENTS.each do |key, expected|
      comp = components[key]
      unless comp.is_a?(Hash)
        add_error(errors, "component #{key} must be an object")
        next
      end
      unknown_comp = comp.keys - ALLOWED_COMPONENT_KEYS
      add_error(errors, "component #{key}: unknown field(s): #{unknown_comp.sort.join(', ')}") unless unknown_comp.empty?

      expected.each do |field, value|
        actual = comp[field.to_s]
        if field == :worker_secrets || field == :post_deploy_secrets || field == :depends_on
          unless actual.is_a?(Array) && actual == value
            add_error(errors, "component #{key}: #{field} must be #{value.inspect}, got #{actual.inspect}")
          end
        elsif field == :run_pulumi
          add_error(errors, "component #{key}: #{field} must be #{value}, got #{actual.inspect}") unless actual == value
        else
          add_error(errors, "component #{key}: #{field} must be #{value.inspect}, got #{actual.inspect}") unless actual == value
        end
      end

      (comp["worker_secrets"] || []).each do |name|
        add_error(errors, "component #{key}: secret name #{name.inspect} must match #{SECRET_NAME_RE}") unless name.is_a?(String) && name.match?(SECRET_NAME_RE)
      end
      (comp["post_deploy_secrets"] || []).each do |name|
        add_error(errors, "component #{key}: post-deploy secret name #{name.inspect} must match #{SECRET_NAME_RE}") unless name.is_a?(String) && name.match?(SECRET_NAME_RE)
      end
      (comp["depends_on"] || []).each do |dep|
        add_error(errors, "component #{key}: depends_on #{dep.inspect} is not a known component") unless EXPECTED_COMPONENTS.key?(dep)
      end

      %w[deploy_eligible rollback_eligible].each do |field|
        add_error(errors, "component #{key}: #{field} must be a boolean, got #{comp[field].inspect}") unless comp[field] == true || comp[field] == false
      end
    end

    unless EXPECTED_COMPONENTS.key?(COMPONENT_KEY)
      add_error(errors, "requested component #{COMPONENT_KEY.inspect} is not in the manifest; known: #{EXPECTED_COMPONENTS.keys.sort.join(', ')}")
    end
  end
end

if errors.any?
  warn errors.join("\n")
  exit 1
end

component = manifest.fetch("components").fetch(COMPONENT_KEY)
deploy_eligible = SOURCE_REVISION.nil? ? nil : (SOURCE_REVISION == manifest.fetch("source_revision"))

output = {
  manifest_sha256: file_sha256,
  manifest_blob_id: PINNED_MANIFEST_BLOB_ID,
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
    rollback: component.fetch("rollback_eligible")
  }
}

puts JSON.generate(output)
exit 0
