# frozen_string_literal: true
# The shared fixture for the deploy-evidence tests (#1695): a throwaway release
# directory, a stubbed `pnpm` (the platform read-back) and `gh`, and the origin
# server that serves the release's own gateway code over a socket.
#
# Nothing here writes to the repository: every fixture lives in a temp dir, and
# the origin is killed in teardown. The two scripts under test are invoked as
# the deploy lane and the seat invoke them, so the tests drive the real seam.
require 'digest'
require 'fileutils'
require 'json'
require 'open3'
require 'tmpdir'

module DeployEvidenceHarness
  ROOT = ENV.fetch('TEST_REPOSITORY_ROOT', File.expand_path('../../../../..', __dir__))
  RECORDER = File.join(ROOT, '.github/scripts/release/record-evidence.mjs')
  VERIFIER = File.join(ROOT, '.github/scripts/release/verify-evidence.mjs')
  ORIGIN = File.join(__dir__, 'origin.mjs')
  SOURCE = 'b' * 40
  VERSION = '22222222-2222-4222-8222-222222222222'
  DEPLOYMENT = '33333333-3333-4333-8333-333333333333'
  APPLICATION = '11111111-1111-4111-8111-111111111111'
  CONTAINER = 'animichi-staging-runtimecontainer-staging'
  IMAGE = "registry.cloudflare.com/#{'a' * 32}/animichi-agent@sha256:#{'d' * 64}"

  def evidence_dir(containers: [], observed_at: '2026-09-16T08:01:03.622Z')
    @dir = Dir.mktmpdir('deploy-evidence-')
    @observed_at = observed_at
    write_release
    write_platform_stubs(containers)
    write_gh_stub
    @dir
  end

  def cleanup_evidence
    kill_origin
    FileUtils.remove_entry(@dir) if @dir && File.directory?(@dir)
  end

  # ── The origin ────────────────────────────────────────────────────────────
  def start_origin(mode = 'gateway')
    @origin_log = File.join(@dir, 'origin.log')
    @origin = IO.popen({ 'EVIDENCE_FIXTURE_LOG' => @origin_log }, ['node', '--import', 'tsx', ORIGIN, mode], chdir: ROOT, err: File::NULL)
    @edge_url = "http://127.0.0.1:#{@origin.gets.to_s[/LISTENING (\d+)/, 1]}"
    @edge_url
  end

  def kill_origin
    return if @origin.nil?
    Process.kill('TERM', @origin.pid)
    @origin.close
    @origin = nil
  rescue Errno::ESRCH, Errno::ECHILD
    @origin = nil
  end

  def origin_requests
    File.exist?(@origin_log) ? File.readlines(@origin_log) : []
  end

  # ── The two seams under test ──────────────────────────────────────────────
  def record(extra_env = {})
    execute(env_for(extra_env), 'node', RECORDER, 'staging')
  end

  def verify(*args, env: {})
    execute(env_for(env), 'node', VERIFIER, '--dir', @dir, *args)
  end

  def execute(environment, *command)
    Open3.capture3(environment, *command, chdir: @dir)
  end

  def env_for(extra_env)
    { 'PATH' => "#{@dir}:#{ENV.fetch('PATH')}", 'GITHUB_RUN_ID' => '9', 'GITHUB_RUN_ATTEMPT' => '1',
      'EVIDENCE_EDGE_URL' => @edge_url.to_s }.merge(extra_env)
  end

  # ── Fixtures ──────────────────────────────────────────────────────────────
  def selection
    { 'artifact_id' => '10435857629', 'artifact_digest' => "sha256:#{'e' * 64}", 'source_sha' => SOURCE,
      'run_id' => '5', 'run_attempt' => '1', 'repository' => 'lifeodyssey/animichi', 'controller_sha' => SOURCE }
  end

  def write_release
    FileUtils.mkdir_p(File.join(@dir, 'release/edge'))
    File.write(File.join(@dir, 'release/release.json'), { 'source_sha' => SOURCE, 'images' => { 'agent' => IMAGE } }.to_json)
    File.write(File.join(@dir, 'selection.json'), selection.to_json)
    File.write(File.join(@dir, 'release/edge/wrangler.json'), wrangler_config.to_json)
    write_receipt([])
  end

  def wrangler_config
    container = { 'name' => CONTAINER, 'class_name' => 'RuntimeContainer', 'image' => 'registry.cloudflare.com/021233c1880a43aa68565496100e1f8c/animichi-agent:staging' }
    { 'name' => 'animichi', 'main' => 'bundle/entry.js', 'compatibility_date' => '2026-01-01',
      'env' => { 'staging' => { 'name' => 'animichi-staging', 'containers' => [container] } } }
  end

  def write_receipt(containers, smoke: 'passed')
    File.write(File.join(@dir, 'receipt.json'), receipt(containers, smoke: smoke).to_json)
  end

  def receipt(containers, smoke: 'passed')
    edge = { 'unit' => 'edge', 'script_name' => 'animichi-staging', 'deployment_id' => DEPLOYMENT, 'version_id' => VERSION, 'containers' => containers }
    { 'format' => 1, 'environment' => 'staging', 'selection' => selection, 'smoke' => smoke,
      'controller_run_id' => '9', 'controller_run_attempt' => '1', 'observed_at' => @observed_at, 'workers' => [edge] }
  end

  def container_observation
    { 'application_id' => APPLICATION, 'name' => CONTAINER, 'image' => IMAGE, 'namespace_id' => 'owned' }
  end

  def write_platform_stubs(containers)
    File.write(File.join(@dir, 'deployments.json'), [{ 'id' => DEPLOYMENT, 'created_on' => '2026-09-16T08:00:00Z', 'versions' => [{ 'version_id' => VERSION, 'percentage' => 100 }] }].to_json)
    File.write(File.join(@dir, 'version.json'), { 'id' => VERSION, 'annotations' => { 'workers/tag' => "sha-#{SOURCE}" }, 'resources' => { 'bindings' => [] } }.to_json)
    File.write(File.join(@dir, 'containers.json'), containers.map { |name| { 'id' => APPLICATION, 'name' => name } }.to_json)
    write_executable('pnpm', pnpm_stub)
  end

  def pnpm_stub
    <<~SH
      #!/usr/bin/env bash
      set -euo pipefail
      case "$3 $4" in
        'deployments list') cat '#{@dir}/deployments.json' ;;
        'versions view') cat '#{@dir}/version.json' ;;
        'containers list') cat '#{@dir}/containers.json' ;;
        *) echo "unexpected stub call: $*" >&2; exit 2 ;;
      esac
    SH
  end

  # `gh` serves the three reads a seat makes with no credential at all: the
  # repository-wide artifact listing (walked when no run is named), the named
  # run's OWN listing (which is what `--fetch <run_id>` must use), and the card's
  # own checklist. The repository-wide listing is paged, because the seat must
  # not mistake "not on page one" for "not published".
  def write_gh_stub(artifacts: [], pages: nil, run_artifacts: {})
    (pages || { 1 => artifacts }).each do |page, items|
      File.write(File.join(@dir, "artifacts-#{page}.json"), { 'artifacts' => items }.to_json)
    end
    File.write(File.join(@dir, 'artifacts.json'), { 'artifacts' => artifacts }.to_json)
    run_artifacts.each { |run, items| File.write(File.join(@dir, "run-artifacts-#{run}.json"), { 'artifacts' => items }.to_json) }
    File.write(File.join(@dir, 'gh.log'), '')
    write_issue_bodies
    write_executable('gh', gh_stub)
  end

  # Every `gh` call the seat made, in order, as `api <endpoint>` or `issue view
  # <card> ...`. Which listing the seat asked for is part of what the tests pin:
  # a run id is a scoped lookup, not a filter over the repository-wide walk.
  def gh_calls
    File.readlines(File.join(@dir, 'gh.log'), chomp: true)
  end

  def gh_stub
    <<~SH
      #!/usr/bin/env bash
      set -euo pipefail
      echo "$*" >> '#{@dir}/gh.log'
      dest=""
      previous=""
      for argument in "$@"; do
        [ "$previous" = "-D" ] && dest="$argument"
        previous="$argument"
      done
      page="${2:-}"
      page="${page##*page=}"
      case "$1" in
        api)
          case "${2:-}" in
            */actions/runs/*/artifacts*)
              run="${2#*/actions/runs/}"
              run="${run%%/*}"
              if [ -f "#{@dir}/run-artifacts-${run}-${page}.json" ]; then cat "#{@dir}/run-artifacts-${run}-${page}.json"; else cat "#{@dir}/run-artifacts-${run}.json"; fi ;;
            *) if [ -f "#{@dir}/artifacts-${page}.json" ]; then cat "#{@dir}/artifacts-${page}.json"; else cat '#{@dir}/artifacts.json'; fi ;;
          esac ;;
        issue) cat "#{@dir}/issue-$3.json" ;;
        run) mkdir -p "$dest" && cp '#{@dir}/evidence.json' '#{@dir}/receipt.json' "$dest/" ;;
        *) echo "unexpected stub call: $*" >&2; exit 2 ;;
      esac
    SH
  end

  # A full artifact page of another lane's uploads: enough of them to make the
  # listing page over, and none of them a receipt.
  def other_lane_artifacts(count)
    Array.new(count) do |index|
      { 'name' => "coverage-#{index}", 'expired' => false, 'created_at' => "2026-09-16T09:#{format('%02d', index % 60)}:00Z", 'workflow_run' => { 'id' => 500 + index } }
    end
  end

  def receipt_artifact(id: '9', attempt: '1', expired: false, created_at: '2026-09-16T08:00:00Z')
    { 'name' => "staging-receipt-#{id}-#{attempt}", 'expired' => expired, 'created_at' => created_at, 'workflow_run' => { 'id' => id.to_i } }
  end

  # The repository-wide listing as it looks a quiet week after a deploy: five
  # full pages of other lanes' uploads, with the receipt on page six.
  def receipt_on_the_sixth_page(receipt = receipt_artifact)
    (1..5).to_h { |page| [page, other_lane_artifacts(100)] }.merge(6 => [receipt])
  end

  # One file per card: the stub answers `gh issue view <card>`, so a run that
  # judges several cards sees each card's own checklist.
  def write_issue_body(card = '1596', body: nil)
    File.write(File.join(@dir, "issue-#{card}.json"), { 'body' => body || issue_body(card) }.to_json)
  end

  def write_issue_bodies
    CARD_BODIES.each_key { |card| write_issue_body(card) }
  end

  def write_executable(name, source)
    path = File.join(@dir, name)
    File.write(path, source)
    File.chmod(0o755, path)
  end

  # The four cards' checklists, shaped like the real ones: same criterion count,
  # same declared test type at the ordinal the catalog names. The catalog is held
  # against the ordinal AND the test type, so a fixture body that lost either
  # turns the drift check red.
  CARD_BODIES = {
    '1596' => <<~BODY,
      **Acceptance criteria**
      - [x] **(unit)** the landing surface is served without the container
      - [ ] **(unit)** the retired root classifies as not-found
      - [ ] **(unit)** the inventory no longer advertises the root
      - [x] **(unit)** the contract emission is unchanged
      - [ ] **(api)** `bash .github/scripts/staging-smoke-check.sh` passes with the container application stopped
      - [ ] **(browser)** the chat page renders no warm-up request in the network log
    BODY
    '1597' => <<~BODY,
      **Acceptance criteria**
      - [x] **(unit)** the three paths are absent from the inventory
      - [x] **(unit)** the repointed gateway tests still fail when mutated
      - [ ] **(api)** each of the three paths answers 404 from the deployed staging gateway
      - [x] **(unit)** the Python suite is green at the unchanged coverage floor
    BODY
    '1599' => <<~BODY,
      **Acceptance criteria**
      - [x] **(integration)** the cap, the scoping and the ordering hold against PostgreSQL
      - [x] **(unit)** the route policy returns the new kind
      - [x] **(unit)** dropping the user predicate turns the integration case red
      - [ ] **(api)** authenticated staging returns the contract body; unauthenticated returns 401
      - [ ] **(browser)** the sidebar lists a conversation created through the native turn
    BODY
    '1601' => <<~BODY,
      **Acceptance criteria**
      - [x] **(integration)** adoption re-points the sessions PostgreSQL owns
      - [x] **(unit)** a client-supplied session id is refused before any write
      - [x] **(unit)** an anonymous caller is refused
      - [ ] **(api)** a real sign-in against deployed staging adopts the anonymous conversation
      - [ ] **(browser)** the login-wall e2e is green against the native implementation
    BODY
  }.freeze

  def issue_body(card = '1596')
    CARD_BODIES.fetch(card)
  end

  # The 1596 card once its development criteria are done: nothing unchecked
  # remains but the two post-deploy ones, which is the state #1695 requirement 3
  # is about.
  def observation_only_body
    issue_body('1596').gsub('- [ ] **(unit)**', '- [x] **(unit)**')
  end
end
