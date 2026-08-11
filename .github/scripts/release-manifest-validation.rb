# frozen_string_literal: true

# SAFE-1 Phase B1: manifest validation helpers shared with
# release-manifest-resolver.rb (kept under the repo's 300-line file limit).
# This module owns the closed-schema rules; the resolver owns reading,
# pinned-identity checks, and typed output.

SCHEMA_VERSION = 1
FULL_SHA_RE = /\A[0-9a-f]{40}\z/
SHA256_RE = /\A[0-9a-f]{64}\z/
ATLAS_TARGET_RE = /\A\d{14}\z/
SECRET_NAME_RE = /\A[A-Z][A-Z0-9_]*\z/

PINNED_ATLAS_TARGET = "20260811000000"
PINNED_ATLAS_DIGEST_SHA256 = "17ff1c806187b1b71e42825aaa5005a29b82e4aba2a298fcb7c7672bafc90888"

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

ALLOWED_TOP_LEVEL_KEYS = %w[
  schema_version release_name description source_revision atlas components
].freeze

ALLOWED_COMPONENT_KEYS = %w[
  working_directory worker_name wrangler_config environment pulumi_stack
  run_pulumi build_filter worker_secrets post_deploy_secrets depends_on
  deploy_eligible rollback_eligible
].freeze

def add_error(errors, message)
  errors << "error: #{message}"
end

def validate_component_fields(errors, key, comp, expected)
  unknown_comp = comp.keys - ALLOWED_COMPONENT_KEYS
  add_error(errors, "component #{key}: unknown field(s): #{unknown_comp.sort.join(', ')}") unless unknown_comp.empty?
  expected.each do |field, value|
    add_error(errors, "component #{key}: #{field} must be #{value.inspect}, got #{comp[field.to_s].inspect}") unless comp[field.to_s] == value
  end
end

def validate_secret_names(errors, key, names, field)
  unless names.is_a?(Array)
    add_error(errors, "component #{key}: #{field} names must be an array, got #{names.inspect}")
    return
  end
  names.each do |name|
    unless name.is_a?(String) && name.match?(SECRET_NAME_RE)
      add_error(errors, "component #{key}: #{field} name #{name.inspect} must match #{SECRET_NAME_RE}")
    end
  end
end

def validate_depends_on(errors, key, deps)
  unless deps.is_a?(Array)
    add_error(errors, "component #{key}: depends_on must be an array, got #{deps.inspect}")
    return
  end
  deps.each do |dep|
    add_error(errors, "component #{key}: depends_on #{dep.inspect} is not a known component") unless EXPECTED_COMPONENTS.key?(dep)
  end
end

def validate_component_eligibility(errors, key, comp)
  %w[deploy_eligible rollback_eligible].each do |field|
    unless comp[field] == true || comp[field] == false
      add_error(errors, "component #{key}: #{field} must be a boolean, got #{comp[field].inspect}")
    end
  end
end

def validate_atlas(errors, atlas)
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

def validate_components(errors, components, requested_key)
  return add_error(errors, "components must be an object") unless components.is_a?(Hash)

  unknown = components.keys - EXPECTED_COMPONENTS.keys
  add_error(errors, "unknown component(s): #{unknown.sort.join(', ')}") unless unknown.empty?
  missing = EXPECTED_COMPONENTS.keys - components.keys
  add_error(errors, "missing component(s): #{missing.sort.join(', ')}") unless missing.empty?
  unless EXPECTED_COMPONENTS.key?(requested_key)
    add_error(errors, "requested component #{requested_key.inspect} is not in the manifest; known: #{EXPECTED_COMPONENTS.keys.sort.join(', ')}")
  end

  EXPECTED_COMPONENTS.each do |key, expected|
    comp = components[key]
    unless comp.is_a?(Hash)
      add_error(errors, "component #{key} must be an object")
      next
    end
    validate_component_fields(errors, key, comp, expected)
    validate_secret_names(errors, key, comp["worker_secrets"], "secret")
    validate_secret_names(errors, key, comp["post_deploy_secrets"], "post-deploy secret")
    validate_depends_on(errors, key, comp["depends_on"])
    validate_component_eligibility(errors, key, comp)
  end
end

def validate_manifest(errors, manifest, requested_key)
  return add_error(errors, "manifest root must be an object") unless manifest.is_a?(Hash)

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
  if atlas.is_a?(Hash)
    validate_atlas(errors, atlas)
  else
    add_error(errors, "atlas must be an object")
  end
  validate_components(errors, manifest["components"], requested_key)
end
