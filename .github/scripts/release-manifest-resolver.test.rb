#!/usr/bin/env ruby
# frozen_string_literal: true

# Behavioral tests for release-manifest-resolver.rb (SAFE-1 Phase B1).
#
# The resolver is content-addressed: the checked-in manifest is pinned by
# SHA-256 (and Git blob id). Green cases run against the real pinned manifest;
# red cases mutate a throwaway COPY (tmpdir) so the real pinned blob is never
# altered, and assert the resolver fails closed on the exact error class.

require "open3"
require "tmpdir"
require "fileutils"
require "json"

ROOT = File.expand_path("../..", __dir__)
SCRIPT = File.join(ROOT, ".github/scripts/release-manifest-resolver.rb")
MANIFEST = File.join(ROOT, ".github/release-manifests/production-pre-campaign.json")
PINNED_SOURCE_REVISION = "b94c30ab6a519f1cce9eb0a3f7885953f8ff54cf"

def run_resolver(manifest, component, revision = PINNED_SOURCE_REVISION)
  args = [RbConfig.ruby, SCRIPT, manifest, component]
  args << revision unless revision.nil?
  out, err, status = Open3.capture3(*args)
  [status.exitstatus, out, err]
end

def green_case(name, manifest, component, revision = PINNED_SOURCE_REVISION)
  rc, out, err = run_resolver(manifest, component, revision)
  abort "FAIL: #{name}: expected exit 0, got #{rc}\n#{err}" unless rc.zero?
  parsed = JSON.parse(out)
  abort "FAIL: #{name}: output must carry manifest_sha256" unless parsed["manifest_sha256"].is_a?(String)
  abort "FAIL: #{name}: output component key must be #{component}" unless parsed.dig("component", "key") == component
  puts "PASS: #{name}"
  parsed
end

def red_case(name, manifest, component, expected_lines, revision = PINNED_SOURCE_REVISION)
  rc, out, err = run_resolver(manifest, component, revision)
  abort "FAIL: #{name}: expected non-zero exit, got #{rc}\nstdout: #{out}\nstderr: #{err}" if rc.zero?
  expected_lines.each do |line|
    abort "FAIL: #{name}: expected #{line.inspect} in stderr:\n#{err}" unless err.include?(line)
  end
  abort "FAIL: #{name}: must not print partial stdout on failure\nstdout: #{out}" unless out.empty?
  puts "PASS: #{name} fails with #{expected_lines.size} expected error line(s)"
end

def mutate_manifest(copy_path, &block)
  manifest = JSON.parse(File.read(copy_path))
  block.call(manifest)
  File.write(copy_path, JSON.generate(manifest))
end


def with_copy(name)
  Dir.mktmpdir(name) do |dir|
    copy = File.join(dir, "manifest.json")
    FileUtils.cp(MANIFEST, copy)
    yield copy
  end
end

# ── Green: the real pinned manifest, every component ─────────────────────────
%w[catalog web users maintenance root].each do |component|
  green_case("pinned manifest resolves #{component}", MANIFEST, component)
end

# ── Green: eligibility verdicts ──────────────────────────────────────────────
green = green_case("matching revision is deploy-eligible", MANIFEST, "root")
abort "FAIL: matching revision must be deploy eligible" unless green.dig("eligibility", "deploy") == true
abort "FAIL: rollback must be ineligible per manifest policy" unless green.dig("eligibility", "rollback") == false

stale = green_case("stale revision is deploy-ineligible", MANIFEST, "root", "0" * 40)
abort "FAIL: stale revision must be deploy ineligible" unless stale.dig("eligibility", "deploy") == false

no_rev = green_case("revision omitted omits deploy verdict", MANIFEST, "catalog", nil)
abort "FAIL: omitted revision must omit deploy verdict" unless no_rev["eligibility"].key?("deploy") && no_rev.dig("eligibility", "deploy").nil?

# ── Red: tampered manifest — altering any field fails the pinned identity ───
with_copy("b1-tamper") do |copy|
  mutate_manifest(copy) { |m| m["atlas"]["target"] = "20260909000000" }
  red_case("altered atlas target fails pinned identity", copy, "root", ["manifest SHA-256", "atlas.target must be pinned 20260811000002"])
end

# ── Red: unknown top-level field ────────────────────────────────────────────
with_copy("b1-unknown-top") do |copy|
  mutate_manifest(copy) { |m| m["surprise"] = true }
  red_case("unknown top-level field", copy, "root", ["manifest SHA-256", "unknown top-level field(s): surprise"])
end

# ── Red: unknown component key ──────────────────────────────────────────────
with_copy("b1-unknown-comp") do |copy|
  mutate_manifest(copy) { |m| m["components"]["sidecar"] = m["components"]["root"] }
  red_case("unknown component key", copy, "root", ["manifest SHA-256", "unknown component(s): sidecar"])
end

# ── Red: requested component not in manifest ────────────────────────────────
red_case("unknown requested component", MANIFEST, "sidecar", ["requested component \"sidecar\" is not in the manifest"])

# ── Red: schema_version must be exactly 1 ───────────────────────────────────
with_copy("b1-schema") do |copy|
  mutate_manifest(copy) { |m| m["schema_version"] = 2 }
  red_case("schema_version 2 rejected", copy, "root", ["manifest SHA-256", "schema_version must be 1, got 2"])
end

# ── Red: source_revision must be a full 40-hex SHA ──────────────────────────
with_copy("b1-rev") do |copy|
  mutate_manifest(copy) { |m| m["source_revision"] = "deadbeef" }
  red_case("short source_revision rejected", copy, "root", ["manifest SHA-256", "source_revision must be a full 40-hex SHA"])
end

# ── Red: atlas digest must match the pinned digest exactly ──────────────────
with_copy("b1-digest") do |copy|
  mutate_manifest(copy) { |m| m["atlas"]["digest_sha256"] = "e" * 64 }
  red_case("altered atlas digest rejected", copy, "root", ["manifest SHA-256", "atlas.digest_sha256 must be pinned"])
end

# ── Red: atlas directory must be migrations/neon ────────────────────────────
with_copy("b1-atlas-dir") do |copy|
  mutate_manifest(copy) { |m| m["atlas"]["directory"] = "db/migrations" }
  red_case("altered atlas directory rejected", copy, "root", ["manifest SHA-256", "atlas.directory must be migrations/neon"])
end

# ── Red: non-boolean eligibility ────────────────────────────────────────────
with_copy("b1-elig") do |copy|
  mutate_manifest(copy) { |m| m["components"]["root"]["rollback_eligible"] = "maybe" }
  red_case("non-boolean rollback_eligible rejected", copy, "root", ["manifest SHA-256", "component root: rollback_eligible must be a boolean"])
end

# ── Red: invalid secret name ────────────────────────────────────────────────
with_copy("b1-secret") do |copy|
  mutate_manifest(copy) { |m| m["components"]["catalog"]["worker_secrets"] = ["bad-name!"] }
  red_case("invalid secret name rejected", copy, "root", ["manifest SHA-256", "component catalog: secret name \"bad-name!\" must match"])
end

# ── Red: depends_on referencing an unknown component ────────────────────────
with_copy("b1-dep") do |copy|
  mutate_manifest(copy) { |m| m["components"]["root"]["depends_on"] = ["phantom"] }
  red_case("depends_on unknown component rejected", copy, "root", ["manifest SHA-256", "component root: depends_on \"phantom\" is not a known component"])
end

# ── Red: component drift from the expected surface (worker name) ────────────
with_copy("b1-drift") do |copy|
  mutate_manifest(copy) { |m| m["components"]["web"]["worker_name"] = "animichi-web-renamed" }
  red_case("worker-name drift rejected", copy, "root", ["manifest SHA-256", "component web: worker_name must be \"animichi-web\""])
end

# ── Red: missing component ──────────────────────────────────────────────────
with_copy("b1-missing") do |copy|
  mutate_manifest(copy) { |m| m["components"].delete("maintenance") }
  red_case("missing component rejected", copy, "root", ["manifest SHA-256", "missing component(s): maintenance"])
end

# ── Red: manifest must be valid JSON ────────────────────────────────────────
Dir.mktmpdir("b1-json") do |dir|
  copy = File.join(dir, "manifest.json")
  File.write(copy, "{ not json")
  red_case("invalid JSON rejected", copy, "root", ["manifest is not valid JSON"])
end

# ── Red: component marked deploy_eligible=false stays ineligible even with a
#    matching revision. The pinned blob cannot hold such a component, so this
#    is verified structurally: eligibility.deploy must AND the flag with the
#    revision match (a tampered copy fails on the pinned identity first).
resolver_source = File.read(SCRIPT)
unless resolver_source.include?("revision_matches && component.fetch(\"deploy_eligible\")")
  abort "FAIL: resolver must enforce component.deploy_eligible in the deploy verdict"
end
puts "PASS: resolver enforces component.deploy_eligible in the deploy verdict"

# ── Green: manifest_blob_id is the COMPUTED blob id (never mistaken for a
#    verified constant when the computation was unavailable) ─────────────────
# Args passed as a vector (never interpolated into a shell string) so a
# checkout path with shell metacharacters cannot break out of git -C.
stdout, = Open3.capture2("git", "-C", ROOT, "hash-object",
                         ".github/release-manifests/production-pre-campaign.json")
computed = stdout.strip
parsed = green_case("computed blob id reported", MANIFEST, "root")
abort "FAIL: manifest_blob_id must be the computed #{computed}, got #{parsed['manifest_blob_id'].inspect}" \
  unless parsed["manifest_blob_id"] == computed
puts "PASS: manifest_blob_id is the computed blob id"

puts "All release-manifest-resolver.rb behavioral tests passed."
