# frozen_string_literal: true

# Contract checks for issue #1176. The workflow has one required aggregator;
# package jobs are implementation details selected by the affected route.
require "open3"
require "fileutils"
require "tmpdir"
require "yaml"

REPO_ROOT = File.expand_path("../..", __dir__)
WORKFLOW = ENV.fetch("PR_VERIFICATION_WORKFLOW", File.join(REPO_ROOT, ".github", "workflows", "pr-verification.yml"))
ROUTE = ENV.fetch("PR_VERIFICATION_ROUTE", File.join(REPO_ROOT, ".github", "scripts", "pr-verification-route.sh"))
GATE = ENV.fetch("PR_VERIFICATION_GATE", File.join(REPO_ROOT, ".github", "scripts", "pr-verification-gate.sh"))
WORKSPACE_LIB = File.join(REPO_ROOT, "scripts", "local-gates", "workspace-packages.sh")
EXPECTED_PACKAGES = %w[agent catalog contract e2e edge eval infra migrator test-postgres users web]

def workflow_value(path)
  YAML.safe_load(File.read(path).sub(/^on:(?=[ \t#]|$)/, '"on":'), aliases: true)
end

def trigger_map(workflow)
  workflow.fetch("on")
end

def assert_ci_route_purpose(route)
  source = route.fetch("steps").map { |step| step["run"] }.compact.join("\n")
  abort "PR/queue route must use the canonical planner" unless source.include?("change-plan.py")
  abort "PR/queue route must retain CI-only test triggers" if source.include?("--purpose deploy")
end

def assert_web_browser_gate(source)
  required = ['RUNTIME_CONFIG=', "printf 'RUNTIME_CONFIG=%s\\n'", 'kill "$WRANGLER_PID"', 'rm -f "$DEV_VARS"', 'web-cwv.spec.ts']
  missing = required.reject { |value| source.include?(value) }
  abort "e2e gate lost main's runtime-config/CWV cleanup: #{missing.join(', ')}" unless missing.empty?
  config_write = source.index("printf 'RUNTIME_CONFIG=%s\\n'")
  server_start = source.index("pnpm --filter web exec wrangler dev")
  abort "e2e runtime config must be written before Wrangler starts" unless config_write && server_start && config_write < server_start
end

def assert_e2e_static_gates(source)
  typecheck = source.index("pnpm --dir e2e typecheck")
  lint = source.index("pnpm --dir e2e run lint:oxlint")
  browser = source.index("pnpm --dir e2e exec playwright test")
  abort "e2e gate must run typecheck before Playwright" unless typecheck && browser && typecheck < browser
  abort "e2e gate must run oxlint before Playwright" unless lint && browser && lint < browser
end

def assert_event_contract(workflow)
  events = trigger_map(workflow)
  required = %w[opened synchronize reopened ready_for_review converted_to_draft]
  pull_request = events.fetch("pull_request")
  actual = Array(pull_request.fetch("types"))
  missing = required - actual
  abort "PR Verification pull_request trigger is missing: #{missing.join(', ')}" unless missing.empty?
  forbidden = %w[issue_comment pull_request_review pull_request_review_comment]
  present = forbidden & events.keys
  abort "PR Verification must not trigger code gates for: #{present.join(', ')}" unless present.empty?
  merge_group = events.fetch("merge_group")
  abort "PR Verification merge_group must target main" unless Array(merge_group.fetch("branches")) == ["main"]
end

def assert_job_contract(workflow, workflow_path)
  jobs = workflow.fetch("jobs")
  route = jobs.fetch("route")
  assert_ci_route_purpose(route)
  package = jobs.fetch("affected")
  quality = jobs.fetch("static-quality")
  cheap_security = jobs.fetch("security-diff")
  security_tools = jobs.fetch("security-tools")
  security = jobs.fetch("security")
  agent_eval = jobs.fetch("agent-eval")
  aggregate = jobs.fetch("aggregate")
  names = jobs.values.map { |job| job["name"] if job.is_a?(Hash) }.compact
  abort "single CI must emit Security directly" unless names.count("Security") == 1 && security.fetch("if").include?("always()")
  abort "single CI must emit PR Verification directly" unless names.count("PR Verification") == 1 && aggregate.fetch("if").include?("always()")
  abort "legacy required-context forwarding jobs must be absent" if jobs.key?("required-security") || jobs.key?("required-pr-verification")
  abort "route job must publish components" unless route.fetch("outputs").fetch("components").include?("steps.route.outputs.components")
  abort "route job must publish whether product components changed" unless route.fetch("outputs").fetch("has_components").include?("steps.route.outputs.has_components")
  abort "route job must publish global lanes" unless route.fetch("outputs").fetch("lanes").include?("steps.route.outputs.lanes")
  abort "route job must publish selected security tools" unless route.fetch("outputs").fetch("security_tools").include?("steps.route.outputs.security_tools")
  matrix = package.fetch("strategy").fetch("matrix").fetch("component")
  abort "affected gate must use the routed matrix" unless matrix.include?("fromJSON(needs.route.outputs.components)")
  abort "affected gate must skip an empty product matrix" unless package.fetch("if").include?("needs.route.outputs.has_components == 'true'")
  abort "static quality must use the local repository action" unless quality.fetch("steps").any? { |step| step["uses"] == "./.github/actions/static-quality" }
  cross_stack = jobs.fetch("cross-stack")
  abort "cross-stack must use the local repository action" unless cross_stack.fetch("steps").any? { |step| step["uses"] == "./.github/actions/cross-stack-e2e" }
  abort "diff secret scan must run independently on every event" if cheap_security.key?("needs")
  abort "changed-secret lane must retain both scanners" unless cheap_security.fetch("steps").any? { |step| step["uses"] == "./.github/actions/secret-scan" } && cheap_security.fetch("steps").any? { |step| step["uses"] == "./.github/actions/security-tool" && step.dig("with", "tool") == "trufflehog" }
  abort "security matrix must use the affected tool plan" unless security_tools.dig("strategy", "matrix", "tool").include?("needs.route.outputs.security_tools")
  abort "security tools must use the local repository action" unless security_tools.fetch("steps").any? { |step| step["uses"] == "./.github/actions/security-tool" }
  abort "security aggregate must wait for routing, secrets, and tools" unless Array(security.fetch("needs")) == %w[route security-diff security-tools]
  abort "agent eval must use the behavior lane" unless agent_eval.fetch("if").include?("'agent-eval'")
  eval_step = agent_eval.fetch("steps").find { |step| step["uses"] == "./.github/actions/agent-eval" }
  abort "agent eval must use the local action" unless eval_step
  abort "agent eval must forward only its existing provider key" unless eval_step.fetch("env").keys == ["ZEN_GO_API_KEY"]
  coverage = %w[agent web catalog users].map { |component| jobs.fetch("coverage-#{component}") }
  coverage.each do |job|
    abort "coverage uploader must be OIDC-scoped" unless job.fetch("permissions").fetch("id-token") == "write"
    abort "coverage uploader must use the local action" unless job.fetch("steps").any? { |step| step["uses"] == "./.github/actions/coverage" }
  end
  coverage_source = File.read(File.join(REPO_ROOT, ".github/actions/coverage/action.yml"))
  abort "coverage uploads must fail closed with OIDC" unless coverage_source.scan("fail_ci_if_error: true").size == 3 && coverage_source.scan("use_oidc: true").size == 3
  needs = Array(aggregate.fetch("needs"))
  required_needs = %w[affected coverage-agent coverage-catalog coverage-users coverage-web cross-stack route security static-quality]
  abort "aggregator must wait for every internal CI lane" unless (needs & required_needs).sort == required_needs.sort
  abort "report-only agent eval must not delay the required aggregate" if needs.include?("agent-eval")
  abort "aggregator must run after failed/cancelled matrix jobs" unless aggregate.fetch("if").include?("always()")
  run = aggregate.fetch("steps").map { |step| step["run"] }.compact.join("\n")
  abort "aggregator must invoke exact-head checker" unless run.include?("pr-verification-aggregate.sh")
  head_env = aggregate.fetch("steps").map { |step| step.dig("env", "PR_VERIFICATION_HEAD_SHA") }.compact.first
  abort "aggregator must bind PR checks to pull-request head" unless head_env.to_s.include?("github.event.pull_request.head.sha")
  workflow_source = File.read(workflow_path)
  abort "package gate must not suppress failures" if workflow_source.match?(/^\s*(continue-on-error|skip)\s*:/)
  image_build = "docker build -f apps/agent/docker/test-postgres/Dockerfile -t animichi-test-postgres:18-3.6-pgvector-0.8.5 ."
  steps = package.fetch("steps")
  atlas_step = steps.find { |step| step["uses"] == "./.github/actions/install-atlas" }
  image_step = steps.find { |step| step["name"] == "Build hermetic Postgres+PostGIS+pgvector test image" }
  gate_step = steps.find { |step| step["name"] == "Run affected package gate" }
  checkout = steps.find { |step| step["uses"].to_s.start_with?("actions/checkout@") }
  abort "catalog gate must install the pinned Atlas CLI" unless atlas_step && atlas_step["if"] == "${{ matrix.component == 'db' || matrix.component == 'catalog' }}"
  abort "agent/db/catalog gates must build the pinned offline Postgres image" unless image_step && image_step["run"] == image_build
  abort "offline Postgres image build must be scoped to agent/db/catalog gates" unless image_step["if"] == "${{ matrix.component == 'agent' || matrix.component == 'db' || matrix.component == 'catalog' }}"
  abort "affected gate must bind the synthetic checkout SHA" unless gate_step.dig("env", "PR_VERIFICATION_CHECKOUT_SHA") == "${{ github.sha }}"
  abort "affected gate must preserve GitHub's synthetic merge checkout" if checkout.fetch("with", {}).key?("ref")
  source_head = gate_step.dig("env", "PR_VERIFICATION_SOURCE_HEAD_SHA").to_s
  abort "affected gate must bind the PR/queue source head separately" unless source_head.include?("github.event.pull_request.head.sha") && source_head.include?("github.event.merge_group.head_sha")
  gate_source = File.read(GATE)
  identity_contract = ['git rev-parse HEAD', 'merge-base --is-ancestor "$source_head" "$checkout"', 'git merge-base "$source_head" "$base"']
  abort "contract gate lost checkout/source/base identity validation" unless identity_contract.all? { |value| gate_source.include?(value) }
  web_specs = %w[web-404.spec.ts web-maplibre-canary.spec.ts web-state-ownership.spec.ts web-a11y-axe.spec.ts web-a11y-keyboard.spec.ts web-a11y-states.spec.ts web-cwv.spec.ts web-chat-settings-return.spec.ts]
  missing_specs = web_specs.reject { |spec| gate_source.include?(spec) }
  abort "e2e gate is missing Web assertions: #{missing_specs.join(', ')}" unless missing_specs.empty?
  abort "e2e gate must not be collection-only" if gate_source.include?("playwright test --list")
  assert_e2e_static_gates(gate_source)
  assert_web_browser_gate(gate_source)
end

def assert_routing_contract
  source = File.read(ROUTE)
  %w[change-plan.py --range --format].each do |name|
    abort "route must use #{name}" unless source.include?(name)
  end
  gate_source = File.read(GATE)
  allowed = gate_source[/^ALLOWED="([^"]+)"/, 1].to_s.split("|")
  abort "gate dispatcher allowed package set drift" unless EXPECTED_PACKAGES.all? { |package| allowed.include?(package) }
  pre_push = File.read(File.join(REPO_ROOT, "scripts", "local-gates", "pre-push.sh"))
  worker_gates = File.read(File.join(REPO_ROOT, "scripts", "local-gates", "pre-push-worker-gates.sh"))
  EXPECTED_PACKAGES.each do |package|
    abort "gate dispatcher must list #{package}" unless gate_source.include?(package)
    next if package == "e2e"
    gate_source_text = pre_push + worker_gates
    abort "gate dispatcher must call gate_#{package}" unless gate_source_text.include?("gate_#{package}()")
  end
  abort "gate dispatcher must retain an e2e package seam" unless gate_source.include?("PACKAGE\" = e2e")
end

def assert_workspace_package_set
  command = "set -e; source \"#{WORKSPACE_LIB}\"; load_workspace_packages; printf '%s\\n' \"$WORKSPACE_NAMES\""
  output, status = Open3.capture2("bash", "-c", command)
  abort "workspace package derivation failed" unless status.success?
  actual = output.lines.map(&:strip).reject(&:empty?).sort
  abort "workspace package set drift: expected #{EXPECTED_PACKAGES}, got #{actual}" unless actual == EXPECTED_PACKAGES.sort
end

def assert_dispatcher_runs_from_arbitrary_cwd
  Dir.mktmpdir("pr-verification-cwd-") do |repo|
    gate = File.join(repo, ".github/scripts/pr-verification-gate.sh")
    pre_push = File.join(repo, "scripts/local-gates/pre-push.sh")
    FileUtils.mkdir_p([File.dirname(gate), File.dirname(pre_push)])
    FileUtils.cp(GATE, gate)
    File.write(pre_push, "gate_docs() { [ \"$PWD\" = \"$EXPECTED_GATE_ROOT\" ] && printf 'dispatcher-source-ok\\n'; }\n")
    env = { "RUNNER_TEMP" => repo, "EXPECTED_GATE_ROOT" => repo }
    stdout, stderr, status = Open3.capture3(env, "bash", gate, "docs", chdir: "/")
    abort "gate dispatcher is cwd-dependent: #{stderr}" unless status.success? && stdout.include?("dispatcher-source-ok")
  end
end

def run_contract(path)
  Open3.capture3(RbConfig.ruby, __FILE__, path)
end

def assert_pr_verification_contract(path = WORKFLOW)
  workflow = workflow_value(path)
  assert_event_contract(workflow)
  assert_job_contract(workflow, path)
  assert_routing_contract
  assert_workspace_package_set
  assert_dispatcher_runs_from_arbitrary_cwd
  puts "PR Verification contract: one exact-head aggregator, affected workspace matrix, code-only triggers"
end

assert_pr_verification_contract(ARGV.fetch(0, WORKFLOW)) if $PROGRAM_NAME == __FILE__
