# frozen_string_literal: true

# #1075 — staging web rings the Builds doorbell: deploy-web-staging calls
# reusable-ring-doorbell.yml (no Wrangler, no Pulumi, no ESC, no secrets)
# instead of reusable-deploy-component.yml.

require "yaml"

CI_PATH = ".github/workflows/ci.yml"
REUSABLE_PATH = ".github/workflows/reusable-ring-doorbell.yml"
DOORBELL_USES = "./.github/workflows/reusable-ring-doorbell.yml"

def job_needs(job)
  Array(job.fetch("needs"))
end

# Slice ci.yml from `  deploy-web-staging:` to the next two-space job header.
def caller_segment
  lines = File.readlines(CI_PATH)
  start = lines.index { |line| line == "  deploy-web-staging:\n" }
  abort "ci.yml must contain a deploy-web-staging job" unless start
  stop = start + 1
  stop += 1 while stop < lines.length && !lines[stop].match?(/^  [a-z][a-z0-9-]*:$/)
  lines[start...stop].join
end

# Caller job source segment + the reusable file text (the two files are
# deployed together; the caller must not smuggle publish credentials in).
def surface(_jobs, _ci_src)
  "#{caller_segment}\n#{File.read(REUSABLE_PATH)}"
end

def assert_uses_doorbell(job)
  abort "#{job.fetch("name")} must call #{DOORBELL_USES}" unless job.fetch("uses") == DOORBELL_USES
end

def assert_absent(blob, needle, label)
  abort "#{label} must not contain #{needle}" if blob.include?(needle)
end

def assert_no_publish_creds(blob, label)
  [
    "CLOUDFLARE_API_TOKEN",
    "wrangler-action",
    "pulumi up",
    "esc-action",
    "esc run"
  ].each do |needle|
    assert_absent(blob, needle, label)
  end
end

def assert_rings_doorbell(blob)
  abort "doorbell reusable must POST $DOORBELL_URL/builds" unless blob.include?("-X POST") && blob.include?("$DOORBELL_URL/builds")
  abort "doorbell reusable must poll GET $DOORBELL_URL/builds/" unless blob.include?("$DOORBELL_URL/builds/")
end

def assert_web_needs(job)
  needs = job_needs(job)
  abort "deploy-web-staging must need deploy-infra-staging" unless needs.include?("deploy-infra-staging")
  abort "deploy-web-staging must need migrate-staging" unless needs.include?("migrate-staging")
end

def assert_preview_urls_off
  jsonc = File.read("apps/web/wrangler.jsonc")
  abort "apps/web/wrangler.jsonc must keep preview_urls false" unless jsonc.include?('"preview_urls": false')
end

def assert_doorbell_trusts_ring_workflow
  policy = File.read("workers/doorbell/src/policy.ts")
  abort "doorbell policy.ts must trust reusable-ring-doorbell.yml" unless policy.include?("reusable-ring-doorbell.yml")
end

def assert_poll_refreshes_oidc
  src = File.read(REUSABLE_PATH)
  helper = ".github/scripts/request-github-oidc-token.sh"
  abort "OIDC refresh helper missing" unless File.exist?(helper)
  start = src.index("while")
  abort "doorbell reusable must poll in a while loop" if start.nil?
  abort "doorbell poll loop must refresh the OIDC token" unless src[start..].include?("request-github-oidc-token.sh")
  abort "OIDC token helper tests failed" unless system("bash", ".github/scripts/request-github-oidc-token.test.sh")
end

def assert_builds_terminal_contract
  src = File.read(REUSABLE_PATH)
  abort "doorbell poll must read the Builds outcome" unless src.include?('outcome="$(jq -r')
  abort "doorbell poll must branch on status and outcome" unless src.include?('case "$status:$outcome" in')
  abort "doorbell poll must accept stopped/success" unless src.include?("stopped:success|success:*)")
  failures = "stopped:fail|stopped:failure|stopped:skipped|stopped:cancelled|stopped:terminated|failed:*|failure:*|cancelled:*|error:*)"
  abort "doorbell poll must reject documented and legacy failures" unless src.include?(failures)
end

def assert_builds_injects_runtime_config
  script = File.read("apps/web/scripts/builds-staging.sh")
  abort "staging web Builds command must inject runtime config" unless script.include?("inject-web-runtime-config")
  abort "staging web Builds command must set TARGET_ENVIRONMENT=staging" unless script.include?("TARGET_ENVIRONMENT=staging")
  jsonc = File.read("apps/web/wrangler.jsonc")
  abort "wrangler.jsonc must document the staging Builds command" unless jsonc.include?("builds-staging.sh")
  deploy = "npx wrangler deploy --config wrangler.jsonc --env staging"
  abort "wrangler.jsonc must document Nitro's staging deploy command" unless jsonc.include?(deploy)
end

def assert_web_doorbell(jobs, ci_src, label)
  job = jobs.fetch("deploy-web-staging")
  assert_uses_doorbell(job)
  blob = surface(jobs, ci_src)
  assert_no_publish_creds(blob, label)
  assert_rings_doorbell(blob)
  assert_web_needs(job)
end

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

ci_jobs = YAML.safe_load(File.read(CI_PATH)).fetch("jobs")
ci_source = File.read(CI_PATH)
assert_web_doorbell(ci_jobs, ci_source, "ci")
assert_preview_urls_off
assert_doorbell_trusts_ring_workflow
assert_poll_refreshes_oidc
assert_builds_terminal_contract
assert_builds_injects_runtime_config
puts "CI contract: #1075 staging web rings doorbell (no CF token / wrangler / pulumi / esc)"

expect_reject("deploy-web-staging gains CLOUDFLARE_API_TOKEN") do
  blob = "#{surface(ci_jobs, ci_source)}\nCLOUDFLARE_API_TOKEN"
  assert_no_publish_creds(blob, "mut")
end
expect_reject("deploy-web-staging gains wrangler-action") do
  blob = "#{surface(ci_jobs, ci_source)}\ncloudflare/wrangler-action"
  assert_no_publish_creds(blob, "mut")
end
expect_reject("deploy-web-staging drops deploy-infra-staging need") do
  copy = Marshal.load(Marshal.dump(ci_jobs))
  copy.fetch("deploy-web-staging")["needs"] = %w[security ci-cross-stack-e2e migrate-staging]
  assert_web_doorbell(copy, ci_source, "mut")
end
