# frozen_string_literal: true

# #1077 — infra and neon-secrets jobs log into Pulumi Cloud with GitHub OIDC.
# They must not `pulumi login` an R2/S3 URL and must not reference the DIY
# backend secret names. Production catalog still applies the main stack via
# reusable-deploy-component.yml on R2 (#1074 left prod unsplit).

require "yaml"

CLOUD_INFRA_REUSABLE = ".github/workflows/reusable-deploy-infra.yml"
CLOUD_NEON_REUSABLE = ".github/workflows/reusable-deploy-neon-secrets.yml"
CLOUD_CI_WORKFLOW = ".github/workflows/ci.yml"
CLOUD_DEPLOY_WORKFLOW = ".github/workflows/deploy.yml"
AUTH_ACTION = "pulumi/auth-actions"
PULUMI_ORG = "lifeodyssey"
DIY_NAMES = %w[
  PULUMI_BACKEND_URL
  PULUMI_CONFIG_PASSPHRASE
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
].freeze
INFRA_USES = "./.github/workflows/reusable-deploy-infra.yml"
NEON_USES = "./.github/workflows/reusable-deploy-neon-secrets.yml"

def load_yaml(path)
  YAML.safe_load(File.read(path))
end

def caller_secrets(jobs, job_id)
  jobs.fetch(job_id).fetch("secrets", {})
end

def caller_grants_oidc?(jobs, job_id)
  jobs.fetch(job_id).dig("permissions", "id-token") == "write"
end

def diy_hits(text)
  DIY_NAMES.select { |name| text.include?(name) }
end

def assert_cloud_reusable(path, label)
  src = File.read(path)
  abort "#{label} must authenticate with #{AUTH_ACTION}" unless src.include?(AUTH_ACTION)
  abort "#{label} must name Pulumi org #{PULUMI_ORG}" unless src.include?(PULUMI_ORG)
  abort "#{label} must request a personal access token" unless src.include?("access_token:personal")
  abort "#{label} must scope the personal token to user:lifeodyssey" unless src.include?("user:lifeodyssey")
  abort "#{label} must grant id-token: write" unless src.match?(/id-token:\s*write/)
  abort "#{label} must not pulumi login a backend URL" if src.match?(/pulumi login\s+"\$/)
  hits = diy_hits(src)
  abort "#{label} must not reference DIY backend secrets: #{hits.join(', ')}" unless hits.empty?
  abort "#{label} must not export state to R2" if src.include?("aws s3 cp")
  abort "#{label} must not take a Pulumi stack export backup" if src.include?("Pulumi stack export")
end

def assert_caller(jobs, label, job_id)
  abort "#{label}: #{job_id} must grant id-token: write" unless caller_grants_oidc?(jobs, job_id)
  secrets = caller_secrets(jobs, job_id)
  hits = DIY_NAMES.select { |name| secrets.key?(name) }
  abort "#{label}: #{job_id} must not pass DIY backend secrets: #{hits.join(', ')}" unless hits.empty?
end

def cloud_callers(jobs)
  jobs.select do |_id, job|
    job.is_a?(Hash) && [INFRA_USES, NEON_USES].include?(job["uses"].to_s)
  end
end

assert_cloud_reusable(CLOUD_INFRA_REUSABLE, "infra reusable")
assert_cloud_reusable(CLOUD_NEON_REUSABLE, "neon-secrets reusable")
preview_src = File.read(".github/workflows/pipeline-infra.yml")
abort "pipeline-infra must authenticate with #{AUTH_ACTION}" unless preview_src.include?(AUTH_ACTION)
abort "pipeline-infra must request a personal access token" unless preview_src.include?("access_token:personal")
hits = diy_hits(preview_src)
abort "pipeline-infra must not reference DIY backend secrets: #{hits.join(', ')}" unless hits.empty?

infra_src = File.read(CLOUD_INFRA_REUSABLE)
abort "infra reusable must apply work-dir infra" unless infra_src.include?("work-dir: infra")
abort "infra reusable must pass CLOUDFLARE_ACCOUNT_ID" unless infra_src.include?("CLOUDFLARE_ACCOUNT_ID")
abort "infra reusable must pass CLOUDFLARE_PULUMI_API_TOKEN" unless infra_src.include?("CLOUDFLARE_PULUMI_API_TOKEN")

ci_jobs = load_yaml(CLOUD_CI_WORKFLOW).fetch("jobs")
cloud_callers(ci_jobs).each { |id, _job| assert_caller(ci_jobs, "ci.yml", id) }

deploy_jobs = load_yaml(CLOUD_DEPLOY_WORKFLOW).fetch("jobs")
cloud_callers(deploy_jobs).each { |id, _job| assert_caller(deploy_jobs, "deploy.yml", id) }

puts "CI contract: #1077 Pulumi Cloud OIDC (infra + neon-secrets; no DIY backend secrets)"
