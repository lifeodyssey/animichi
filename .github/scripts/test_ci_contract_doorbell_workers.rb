# frozen_string_literal: true

# #1076 — staging catalog, users, and root ring the Builds doorbell.
# Path filters skip those rings on infra-only changes; infra stays unfiltered.

require "yaml"

WORKERS_CI = ".github/workflows/ci.yml"
WORKERS_RING = ".github/workflows/reusable-ring-doorbell.yml"
WORKERS_USES = "./.github/workflows/reusable-ring-doorbell.yml"
PATHS_JOB = "staging-worker-paths"
COMPONENTS = {
  "deploy-staging" => "catalog",
  "deploy-users-staging" => "users",
  "deploy-root-staging" => "root"
}.freeze
INFRA_ONLY = %w[infra/src/hardening.ts infra/index.ts].freeze
WORKER_TOUCH = {
  "catalog" => %w[workers/catalog/src/index.ts],
  "users" => %w[workers/users/src/index.ts],
  "root" => %w[workers/edge/src/entry.ts]
}.freeze
AGENT_TOUCH = %w[apps/agent/src/animichi/foo.py].freeze

def workers_needs(job)
  Array(job.fetch("needs"))
end

def caller_segment(job_id)
  lines = File.readlines(WORKERS_CI)
  start = lines.index { |line| line == "  #{job_id}:\n" }
  abort "ci.yml must contain a #{job_id} job" unless start
  stop = start + 1
  stop += 1 while stop < lines.length && !lines[stop].match?(/^  [a-z][a-z0-9-]*:$/)
  lines[start...stop].join
end

def publish_surface
  "#{COMPONENTS.keys.map { |id| caller_segment(id) }.join}\n#{File.read(WORKERS_RING)}"
end

def assert_absent(blob, needle, label)
  abort "#{label} must not contain #{needle}" if blob.include?(needle)
end

def assert_no_worker_creds(blob, label)
  ["CLOUDFLARE_API_TOKEN", "wrangler-action", "pulumi up", "esc-action", "esc run"].each do |n|
    assert_absent(blob, n, label)
  end
end

def assert_ring_caller(job, job_id, component)
  abort "#{job_id} must call #{WORKERS_USES}" unless job.fetch("uses") == WORKERS_USES
  abort "#{job_id} must ring #{component}" unless job.fetch("with")["component"] == component
  abort "#{job_id} must target staging" unless job.fetch("with")["environment"] == "staging"
  abort "#{job_id} must grant id-token: write" unless job.dig("permissions", "id-token") == "write"
end

def assert_ring_needs(job, job_id)
  needs = workers_needs(job)
  abort "#{job_id} must need deploy-infra-staging" unless needs.include?("deploy-infra-staging")
  abort "#{job_id} must need migrate-staging" unless needs.include?("migrate-staging")
  abort "#{job_id} must need #{PATHS_JOB}" unless needs.include?(PATHS_JOB)
end

def assert_ring_path_guard(job, job_id, component)
  guard = job.fetch("if")
  abort "#{job_id} must keep !failure() && !cancelled()" unless guard.include?("!failure()") && guard.include?("!cancelled()")
  abort "#{job_id} must skip when #{component} is unchanged" unless guard.include?("needs.#{PATHS_JOB}.outputs.#{component} == 'true'")
end

def assert_ring_job(jobs, job_id, component)
  job = jobs.fetch(job_id)
  assert_ring_caller(job, job_id, component)
  assert_ring_needs(job, job_id)
  assert_ring_path_guard(job, job_id, component)
end

def path_filters(jobs)
  job = jobs.fetch(PATHS_JOB)
  step = Array(job["steps"]).find { |s| s["uses"].to_s.include?("dorny/paths-filter") }
  abort "#{PATHS_JOB} must use dorny/paths-filter" if step.nil?
  YAML.safe_load(step.fetch("with").fetch("filters"))
end

def glob_hit?(glob, path)
  stem = glob.delete_suffix("/**")
  return path == stem || path.start_with?("#{stem}/") if glob.end_with?("/**")
  path == glob
end

def rings?(filters, component, paths)
  Array(filters.fetch(component)).any? { |glob| paths.any? { |p| glob_hit?(glob, p) } }
end

def assert_silent_on_infra(filters)
  %w[catalog users root].each do |name|
    abort "infra-only must not ring #{name}" if rings?(filters, name, INFRA_ONLY)
  end
end

def assert_worker_rings(filters)
  WORKER_TOUCH.each do |name, paths|
    abort "#{paths} must ring #{name}" unless rings?(filters, name, paths)
  end
  abort "apps/agent must ring root" unless rings?(filters, "root", AGENT_TOUCH)
end

def assert_paths_job(jobs)
  job = jobs.fetch(PATHS_JOB)
  abort "#{PATHS_JOB} must run on push to main" unless job["if"].to_s.include?("refs/heads/main")
  %w[catalog users root].each do |name|
    abort "#{PATHS_JOB} must output #{name}" unless job.fetch("outputs").key?(name)
  end
end

def assert_infra_unfiltered(jobs)
  infra = jobs.fetch("deploy-infra-staging")
  abort "infra must not need #{PATHS_JOB}" if workers_needs(infra).include?(PATHS_JOB)
  abort "infra must not skip on worker paths" if infra["if"].to_s.include?(PATHS_JOB)
end

def assert_web_unfiltered(jobs)
  abort "web must not skip on worker paths" if jobs.fetch("deploy-web-staging")["if"].to_s.include?(PATHS_JOB)
end

def assert_root_full_deploy
  script = File.read("workers/edge/scripts/builds-staging.sh")
  abort "root Builds script must wrangler deploy" unless script.include?("wrangler deploy")
  abort "root Builds script must not versions-upload" if script.match?(/\bwrangler\s+versions/)
  toml = File.read("workers/edge/wrangler.toml")
  abort "wrangler.toml must document builds-staging.sh" unless toml.include?("builds-staging.sh")
end

def expect_worker_reject(label)
  begin
    yield
  rescue SystemExit => e
    abort "FAIL mutation: #{label} aborted with success" if e.status.zero?
    puts "PASS: #{label} rejected"
    return
  end
  abort "FAIL mutation: #{label} must be rejected"
end

ci_jobs = YAML.safe_load(File.read(WORKERS_CI)).fetch("jobs")
assert_no_worker_creds(publish_surface, "ci")
COMPONENTS.each { |id, name| assert_ring_job(ci_jobs, id, name) }
assert_paths_job(ci_jobs)
assert_infra_unfiltered(ci_jobs)
assert_web_unfiltered(ci_jobs)
filters = path_filters(ci_jobs)
assert_silent_on_infra(filters)
assert_worker_rings(filters)
assert_root_full_deploy
puts "CI contract: #1076 staging catalog/users/root ring doorbell (infra-only does not)"

expect_worker_reject("catalog gains CLOUDFLARE_API_TOKEN") do
  assert_no_worker_creds("#{caller_segment('deploy-staging')}\nCLOUDFLARE_API_TOKEN", "mut")
end
expect_worker_reject("catalog drops deploy-infra-staging need") do
  copy = Marshal.load(Marshal.dump(ci_jobs))
  copy.fetch("deploy-staging")["needs"] = %w[security ci-cross-stack-e2e migrate-staging staging-worker-paths]
  assert_ring_job(copy, "deploy-staging", "catalog")
end
expect_worker_reject("infra-only path set still rings a worker") do
  mutated = Marshal.load(Marshal.dump(filters))
  mutated["catalog"] = Array(mutated["catalog"]) + ["infra/**"]
  assert_silent_on_infra(mutated)
end
expect_worker_reject("worker path set does not ring") do
  mutated = Marshal.load(Marshal.dump(filters))
  mutated["catalog"] = []
  assert_worker_rings(mutated)
end
