# SUT: cd.yml publishes the post-deploy probe transcript beside the receipt, and
# the seat-side workflow reads it with repository read access alone (#1695).
require 'minitest/autorun'
require 'psych'

class CdPostDeployEvidenceTest < Minitest::Test
  ROOT = ENV.fetch('TEST_REPOSITORY_ROOT', File.expand_path('../..', __dir__))
  CD_FILE = File.join(ROOT, '.github/workflows/cd.yml')
  SEAT_FILE = File.join(ROOT, '.github/workflows/verify-deploy-evidence.yml')
  RECORDER = 'node .github/scripts/release/record-evidence.mjs staging'
  VERIFIER = 'node .github/scripts/release/verify-evidence.mjs'
  SMOKE_EDGE = 'https://animichi-staging.zhenjiazhou0127.workers.dev'
  ESC_KEYS = %w[CLOUDFLARE_API_TOKEN CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET].freeze

  def setup
    @cd = Psych.safe_load(File.read(CD_FILE), aliases: true)
    @seat = Psych.safe_load(File.read(SEAT_FILE), aliases: true)
  end

  def steps(job)
    @cd.fetch('jobs').fetch(job).fetch('steps')
  end

  def step(job, name)
    steps(job).find { |item| item['name'] == name }.tap { |item| refute_nil item, name }
  end

  def test_the_transcript_is_recorded_after_the_identities_and_the_smoke
    record = step('stage', 'Record observed deployment identities')
    assert_includes record.fetch('run'), RECORDER
    assert_includes record.fetch('run'), 'node .github/scripts/release/record-receipt.mjs staging'
    assert_operator steps('stage').index(record), :>, steps('stage').index(step('stage', 'Smoke the release'))
  end

  # The probe must observe the origin the smoke named. A transcript of some other
  # host is not evidence about the release that was deployed.
  def test_the_recorded_origin_is_the_one_the_smoke_probes
    record = step('stage', 'Record observed deployment identities')
    assert_equal SMOKE_EDGE, record.dig('env', 'EVIDENCE_EDGE_URL')
    assert_includes step('stage', 'Smoke the release').fetch('run').to_s, SMOKE_EDGE
  end

  def test_the_receipt_artifact_carries_both_documents
    upload = step('stage', 'Publish the immutable staging receipt').fetch('with')
    assert_equal %w[receipt.json evidence.json], upload.fetch('path').split("\n").map(&:strip)
    assert_equal 'error', upload.fetch('if-no-files-found')
    refute_includes File.read(CD_FILE), 'continue-on-error'
  end

  # #1695 requirement 2: the recording lane opens no credential the publish lane
  # did not already open, and the Access pair still never leaves the staging job.
  def test_no_new_credential_reaches_the_recording_lane
    esc = steps('stage').find { |item| item['uses'].to_s.start_with?('pulumi/esc-action@') }.fetch('with')
    assert_equal ESC_KEYS, esc.fetch('export-environment-variables').split(',')
    declared = step('stage', 'Record observed deployment identities').fetch('env').keys
    assert_empty declared.grep(/TOKEN|SECRET|CLIENT_ID|KEY|PASSWORD|BEARER/), 'the recorder reads the job credentials; it is handed none of its own'
    holders = @cd.fetch('jobs').select { |_id, job| job.to_s.include?('CF_ACCESS_CLIENT_ID') }.keys
    assert_equal %w[stage], holders
    refute_match(/secrets\./, File.read(CD_FILE))
  end

  def test_the_seat_workflow_reads_the_artifact_and_holds_no_write_permission
    assert_equal({ 'contents' => 'read', 'actions' => 'read' }, @seat.fetch('permissions'))
    events = @seat['on'] || @seat[true]
    assert_equal ['workflow_dispatch'], events.keys
    judge = @seat.fetch('jobs').fetch('evidence').fetch('steps').last
    assert_includes judge.fetch('run'), VERIFIER
    assert_includes judge.fetch('run'), '--fetch'
    assert_equal %w[AC CARD RUN_ID], judge.fetch('env').keys.sort
    refute_match(/secrets\./, File.read(SEAT_FILE))
  end

  def test_the_seat_workflow_is_pinned_and_bounded
    step_ = @seat.fetch('jobs').fetch('evidence').fetch('steps').first
    assert_match(%r{\Aactions/checkout@[0-9a-f]{40}\z}, step_.fetch('uses'))
    assert_equal false, step_.dig('with', 'persist-credentials')
    assert_equal 10, @seat.dig('jobs', 'evidence', 'timeout-minutes')
    assert_equal false, @seat.dig('concurrency', 'cancel-in-progress')
  end
end
