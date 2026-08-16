# frozen_string_literal: true

# #1074 — main-stack pulumi up leaves catalog; dedicated infra jobs apply it.

require "yaml"

INFRA_REUSABLE = "./.github/workflows/reusable-deploy-infra.yml"
STAGING_PUBLISH = %w[deploy-staging deploy-web-staging deploy-users-staging deploy-root-staging].freeze
PROD_PUBLISH = %w[deploy-prod deploy-web-prod deploy-users-prod deploy-maintenance-prod deploy-root-prod].freeze

def job_needs(job)
  Array(job.fetch("needs"))
end

def assert_no_path_skip(job, label)
  abort "#{label} must not declare paths" if job.key?("paths")
  abort "#{label} must not path-filter the deploy lane" if job["if"].to_s.match?(/paths/)
end

def assert_infra_job(jobs, label, infra_id)
  infra = jobs.fetch(infra_id)
  abort "#{label}: #{infra_id} must call #{INFRA_REUSABLE}" unless infra.fetch("uses") == INFRA_REUSABLE
  assert_no_path_skip(infra, "#{label} #{infra_id}")
end

def assert_catalog_no_pulumi(jobs, label, catalog_id)
  abort "#{label}: #{catalog_id} must pass run_pulumi: false" \
    unless jobs.fetch(catalog_id).fetch("with")["run_pulumi"] == false
end

def assert_publish_needs(jobs, label, publish, infra_id)
  publish.each do |id|
    abort "#{label}: #{id} must need #{infra_id}" unless job_needs(jobs.fetch(id)).include?(infra_id)
  end
end

def assert_staging_infra_split(jobs, label)
  assert_infra_job(jobs, label, "deploy-infra-staging")
  abort "#{label}: infra must not need migrate-staging" \
    if job_needs(jobs.fetch("deploy-infra-staging")).include?("migrate-staging")
  assert_catalog_no_pulumi(jobs, label, "deploy-staging")
  assert_publish_needs(jobs, label, STAGING_PUBLISH, "deploy-infra-staging")
  assert_publish_needs(jobs, label, STAGING_PUBLISH, "migrate-staging")
end

def assert_prod_infra_split(jobs, label)
  assert_infra_job(jobs, label, "deploy-infra-prod")
  assert_catalog_no_pulumi(jobs, label, "deploy-prod")
  assert_publish_needs(jobs, label, PROD_PUBLISH, "deploy-infra-prod")
end

ci_jobs = YAML.safe_load(File.read(".github/workflows/ci.yml")).fetch("jobs")
assert_staging_infra_split(ci_jobs, "ci staging")
assert_prod_infra_split(ci_jobs, "ci prod")
deploy_jobs = YAML.safe_load(File.read(".github/workflows/deploy.yml")).fetch("jobs")
assert_prod_infra_split(deploy_jobs, "deploy.yml")

infra_src = File.read(".github/workflows/reusable-deploy-infra.yml")
abort "infra reusable must apply work-dir infra" unless infra_src.include?("work-dir: infra")
abort "infra reusable must not apply neon-secrets" if infra_src.include?("infra/neon-secrets")
abort "infra reusable must not invoke wrangler-action" if infra_src.include?("cloudflare/wrangler-action")
abort "infra reusable must not invoke Atlas" if infra_src.include?("atlas migrate")
%w[PULUMI_CONFIG_PASSPHRASE PULUMI_BACKEND_URL CLOUDFLARE_PULUMI_API_TOKEN
   CLOUDFLARE_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY].each do |name|
  abort "infra reusable must declare #{name}" unless infra_src.include?(name)
end
puts "CI contract: #1074 infra split (catalog run_pulumi false; infra job applies main stack)"

def expect_reject(label)
  begin
    yield
  rescue SystemExit => e
    abort "FAIL mutation: #{label} aborted with success" if e.status.zero?
    puts "PASS: #{label} rejected"
    return
  end
  abort "FAIL mutation: #{label} must be rejected"
end

expect_reject("catalog run_pulumi true") do
  copy = Marshal.load(Marshal.dump(ci_jobs))
  copy.fetch("deploy-staging").fetch("with")["run_pulumi"] = true
  assert_staging_infra_split(copy, "mut")
end
expect_reject("publish job drops infra need") do
  copy = Marshal.load(Marshal.dump(ci_jobs))
  copy.fetch("deploy-web-staging")["needs"] = %w[security ci-cross-stack-e2e migrate-staging]
  assert_staging_infra_split(copy, "mut")
end
expect_reject("infra job path-filtered") do
  copy = Marshal.load(Marshal.dump(ci_jobs))
  copy.fetch("deploy-infra-staging")["if"] = "${{ needs.changes.outputs.paths }}"
  assert_staging_infra_split(copy, "mut")
end
