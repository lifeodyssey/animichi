# SUT: record-evidence.mjs observes the deployed origin and verify-evidence.mjs
# judges that transcript from a seat that holds no staging credential.
require 'minitest/autorun'
require_relative 'fixtures/release/deploy-evidence/harness'

class PostDeployEvidenceTest < Minitest::Test
  include DeployEvidenceHarness

  def teardown
    cleanup_evidence
  end

  # A green end-to-end run: the release's own gateway code answers over a real
  # socket with no container binding declared, the recorder writes the
  # transcript, and the verifier settles #1596 AC5 from it.
  def test_records_and_settles_the_container_free_smoke_probe
    evidence_dir
    start_origin
    out, err, status = record
    assert status.success?, err
    assert File.exist?(File.join(@dir, 'evidence.json')), 'the recorder must publish a transcript'
    out, err, status = verify('--card', '1596', '--ac', 'AC5')
    assert status.success?, "#{out}#{err}"
    assert_includes out, '1596 AC5 api satisfied'
    assert_includes out, 'result: 1/1 criteria satisfied'
  end

  def test_transcript_is_an_observation_of_the_origin
    evidence_dir
    start_origin
    record
    transcript = JSON.parse(File.read(File.join(@dir, 'evidence.json')))
    assert_equal 9, transcript.fetch('probes').length
    observed = transcript.fetch('probes').find { |probe| probe.fetch('name') == 'edgeHealthz' }.fetch('observed')
    assert_equal 200, observed.fetch('status')
    assert_equal({ 'status' => 'ok' }, observed.fetch('body_json'))
    assert_equal 15, observed.fetch('body_bytes')
    assert_equal "sha256:#{Digest::SHA256.hexdigest('{"status":"ok"}')}", observed.fetch('body_sha256')
    refute_nil observed.fetch('at'), 'an observation is stamped with when it was taken'
  end

  # The gateway's own answer for a retired path, and the diagnostic that
  # accompanies it: 401, never 200, for a caller with no identity.
  def test_retired_paths_are_observed_as_gateway_refusals
    evidence_dir
    start_origin
    record
    transcript = JSON.parse(File.read(File.join(@dir, 'evidence.json')))
    diagnostics = transcript.fetch('probes').select { |probe| probe.fetch('name').start_with?('retired') && probe.fetch('name').end_with?('Unauthenticated') }
    assert_equal 3, diagnostics.length
    assert_equal [401], diagnostics.map { |probe| probe.fetch('observed').fetch('status') }.uniq
    assert_equal ['pass'], diagnostics.map { |probe| probe.fetch('verdict') }.uniq
    refute_includes File.read(File.join(@dir, 'evidence.json')), 'CF-Access-Client-Secret'
  end

  # The two halves of #1599 AC4: the refusal is observable here, the signed-in
  # body is not, and the state must say so rather than look verified.
  def test_an_identity_class_probe_is_named_and_never_silently_skipped
    evidence_dir
    start_origin
    record
    out, _err, status = verify('--card', '1599', '--ac', 'AC4')
    refute status.success?, 'a criterion one half of which needs an identity cannot read as verified'
    assert_includes out, '1599 AC4 api NOT SATISFIED — unobservable-here'
    assert_includes out, 'probe-unobserved (conversationsAuthenticated needs a credential of class "identity")'
  end

  # A 200 where a retired route must be gone is a REFUTED criterion, and the
  # reason names the probe and the status it should have had.
  def test_a_container_answer_refutes_the_retired_criterion
    evidence_dir
    start_origin('container-serves-retired')
    record
    out, err, status = verify('--card', '1597', '--ac', 'AC3', '--no-issue')
    refute status.success?, err
    assert_includes out, '1597 AC3 api NOT SATISFIED — refuted'
    assert_includes out, 'expected 401, observed 200'
    assert_includes out, 'result: 0/1 criteria satisfied'
  end

  # #1695 requirement 3: the same run must tell a card whose only unchecked
  # criteria are post-deploy apart from one whose remaining evidence is not a
  # deployed observation. The line states coverage, never a development claim:
  # these cards keep their verification in comments and leave the boxes alone.
  def test_the_card_line_names_what_the_catalog_covers
    evidence_dir
    start_origin
    record
    out, _err, _status = verify('--card', '1596')
    assert_includes out, '1596: 4 unchecked — 2 post-deploy (AC5, AC6), 2 outside this catalog (AC2, AC3)'
    write_issue_body('1596', body: observation_only_body)
    out, _err, _status = verify('--card', '1596')
    assert_includes out, '1596: every unchecked criterion is post-deploy (AC5, AC6) — the only thing missing is a deploy observation'
    write_issue_body('1596', body: observation_only_body.sub('- [ ] **(api)**', '- [ ] **(unit)**'))
    out, _err, _status = verify('--card', '1596')
    assert_includes out, 'the catalog and the card disagree'
  end

  # #1596 AC5's distinctive requirement is a staging STATE, not a probe: the
  # smoke passes with the container application stopped. A recorded platform read
  # that still lists the application is not that state, so the criterion must
  # resolve `not-yet` and exit non-zero — deleting that requirement must not
  # leave this suite green.
  def test_a_container_application_still_deployed_leaves_ac5_not_yet
    evidence_dir(containers: [CONTAINER])
    start_origin
    record
    transcript = JSON.parse(File.read(File.join(@dir, 'evidence.json')))
    assert_equal [CONTAINER], transcript.dig('platform', 'container_applications').map { |application| application.fetch('name') }
    assert_equal ['pass'], transcript.fetch('probes').select { |probe| probe.fetch('name') == 'edgeHealthz' }.map { |probe| probe.fetch('verdict') }
    out, _err, status = verify('--card', '1596', '--ac', 'AC5')
    refute status.success?, 'a container application that is still deployed cannot settle AC5'
    assert_includes out, '1596 AC5 api NOT SATISFIED — not-yet'
    assert_includes out, "container-absent (#{CONTAINER} still deployed)"
    assert_includes out, 'result: 0/1 criteria satisfied, 0 binding failure(s)'
  end

  # The seat's own path: no credential, no file it was handed — it looks the
  # artifact up and downloads it with repository read access alone.
  def test_a_seat_fetches_the_newest_published_receipt_by_itself
    evidence_dir
    start_origin
    record
    write_gh_stub(artifacts: [receipt_artifact(id: '9', attempt: '2', expired: true, created_at: '2026-09-16T09:00:00Z'),
                             receipt_artifact(id: '9', created_at: '2026-09-16T08:00:00Z')])
    out, err, status = verify('--card', '1596', '--ac', 'AC5', '--fetch', 'latest')
    assert status.success?, "#{out}#{err}"
    assert_includes out, 'staging-receipt-9-1 (run 9)'
    assert_includes out, 'result: 1/1 criteria satisfied'
  end

  # This repository carries thousands of artifacts and the newest staging
  # receipt sits behind whatever the pull-request lanes have uploaded since the
  # last deploy, so a seat that read one page would report "no receipt
  # published" about a receipt that exists.
  def test_a_receipt_beyond_the_first_page_is_still_fetched
    evidence_dir
    start_origin
    record
    write_gh_stub(pages: { 1 => other_lane_artifacts(100), 2 => [receipt_artifact] })
    out, err, status = verify('--card', '1596', '--ac', 'AC5', '--fetch', 'latest')
    assert status.success?, "#{out}#{err}"
    assert_includes out, 'staging-receipt-9-1 (run 9)'
    assert_includes out, 'result: 1/1 criteria satisfied'
  end

  # #1695 must-fix 1: `--fetch <run_id>` is a SCOPED lookup, not a filter over
  # the repository-wide walk. The receipt sits on page six of that walk and the
  # seat names the run, so the seat must read the run's OWN listing: raising the
  # walk's limit would leave this door broken for the next quiet week, which is
  # the false stall this card exists to remove.
  def test_a_receipt_beyond_the_walk_is_still_fetched_for_a_named_run
    evidence_dir
    start_origin
    record
    write_gh_stub(pages: receipt_beyond_the_walk, run_artifacts: { '9' => [receipt_artifact] })
    out, err, status = verify('--card', '1596', '--ac', 'AC5', '--fetch', '9')
    assert status.success?, "#{out}#{err}"
    assert_includes out, 'staging-receipt-9-1 (run 9)'
    assert_includes out, 'result: 1/1 criteria satisfied'
    assert_includes gh_calls, 'api repos/lifeodyssey/animichi/actions/runs/9/artifacts?per_page=100&page=1'
    refute gh_calls.any? { |call| call.start_with?('api repos/lifeodyssey/animichi/actions/artifacts') }, 'a named run reads its own listing, never the repository-wide walk'
  end

  def test_no_published_receipt_is_a_named_failure_not_an_empty_run
    evidence_dir
    start_origin
    record
    write_gh_stub(run_artifacts: { '7' => [receipt_artifact(expired: true)] })
    out, err, status = verify('--card', '1596', '--ac', 'AC5', '--fetch', '7')
    refute status.success?
    assert_includes out + err, 'no unexpired staging-receipt artifact is published for run 7'
  end
end
