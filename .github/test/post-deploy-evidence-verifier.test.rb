# SUT: verify-evidence.mjs, the seat-side half (#1713). What a seat FETCHES
# (which artifact door, and how far a listing is walked), what it HOLDS the two
# documents to (the run and attempt that produced them), and which criteria it
# judges (a scoped `--ac` is scoped, a selector that matches nothing is an
# error, and a diagnostic is not the criterion's evidence).
require 'minitest/autorun'
require_relative 'fixtures/release/deploy-evidence/harness'

class PostDeployEvidenceVerifierTest < Minitest::Test
  include DeployEvidenceHarness

  def teardown
    cleanup_evidence
  end

  def recorded_probes
    JSON.parse(File.read(File.join(@dir, 'evidence.json'))).fetch('probes')
  end

  def recorded_diagnostics
    recorded_probes.select { |probe| probe.fetch('name').start_with?('retired') && probe.fetch('name').end_with?('Unauthenticated') }
  end

  # The documents of a fetched artifact, as a stale pair: the same run id in
  # both, which is what made two old documents look like one deployment.
  def stale_controller_run(run_id)
    %w[evidence.json receipt.json].each do |name|
      path = File.join(@dir, name)
      File.write(path, File.read(path).gsub(/"controller_run_id":\s*"9"/, %("controller_run_id": "#{run_id}")))
    end
  end

  # #1597 AC3's evidence is the AUTHENTICATED 404; the unauthenticated
  # diagnostic only establishes that no caller without an identity reaches a
  # 200. A retired path that answers the gateway's own 404 to that diagnostic —
  # the state the criterion asks for — must not turn the criterion REFUTED: the
  # probe that could refute it was never taken (#1713 finding 2).
  def test_a_diagnostic_that_is_refused_is_not_a_refuted_criterion
    evidence_dir
    start_origin('retired-absent')
    _out, err, status = record
    assert status.success?, err
    assert_equal [401, 401, 404], recorded_diagnostics.map { |probe| probe.fetch('observed').fetch('status') }.sort
    assert_equal ['pass'], recorded_diagnostics.map { |probe| probe.fetch('verdict') }.uniq
    out, err, status = verify('--card', '1597', '--ac', 'AC3', '--no-issue')
    refute status.success?, err
    assert_includes out, '1597 AC3 api NOT SATISFIED — unobservable-here'
    assert_includes out, 'retiredv1-search-preview-q-test needs a credential of class "identity"'
    refute_includes out, '— refuted'
  end

  # A selector that matches nothing is an ERROR, not an empty run: `--card 9999`
  # otherwise judges zero criteria, prints 0/0 and exits 0 — a green result for
  # a run that asked about nothing (#1713 finding 3).
  def test_a_card_selector_that_matches_no_entry_is_an_error
    evidence_dir
    start_origin
    record
    out, err, status = verify('--card', '9999')
    refute status.success?, 'a card the catalog does not carry must not verify'
    assert_includes out + err, 'no catalog entry matches --card 9999'
    refute_includes out, 'result: 0/0'
    out, err, status = verify('--card', '1596,9999')
    refute status.success?, 'one typo among several cards must not be silently dropped'
    assert_includes out + err, 'no catalog entry matches --card 9999'
  end

  def test_an_ac_selector_that_matches_no_entry_is_an_error
    evidence_dir
    start_origin
    record
    out, err, status = verify('--card', '1597', '--ac', 'AC9')
    refute status.success?, 'a criterion the catalog does not carry must not verify'
    assert_includes out + err, 'no catalog entry matches --ac AC9'
    refute_includes out, 'result: 0/0'
  end

  # The repository-wide listing holds thousands of artifacts, so a walk bounded
  # at five pages reports a published receipt as non-existent — the false stall
  # this card removes, on the door that has no run id to scope by (#1713
  # finding 4). The walk continues to the first short page.
  def test_the_newest_receipt_is_found_past_the_fifth_page_of_the_listing
    evidence_dir
    start_origin
    record
    write_gh_stub(pages: receipt_on_the_sixth_page)
    out, err, status = verify('--card', '1596', '--ac', 'AC5', '--fetch', 'latest')
    assert status.success?, "#{out}#{err}"
    assert_includes out, 'staging-receipt-9-1 (run 9)'
    assert_includes out, 'result: 1/1 criteria satisfied'
    assert_includes gh_calls, 'api repos/lifeodyssey/animichi/actions/artifacts?per_page=100&page=6'
  end

  # `locate` downloads the artifact by `workflow_run.id`, but the binding check
  # only compared the two documents' embedded run ids — so two STALE documents
  # that agree with each other verified a run that did not produce them (#1713
  # finding 5).
  def test_documents_that_name_another_run_do_not_verify_the_fetched_run
    evidence_dir
    start_origin
    record
    stale_controller_run('7')
    write_gh_stub(run_artifacts: { '9' => [receipt_artifact] })
    out, err, status = verify('--card', '1596', '--ac', 'AC5', '--fetch', '9')
    refute status.success?, 'an artifact whose documents name another run is not evidence about this one'
    assert_includes out, 'FAIL the artifact staging-receipt-9-1 is from run 9, the documents from run 7'
    assert_includes out, '1596 AC5 api NOT SATISFIED — unbound'
  end

  # The artifact NAME carries the attempt that produced it, so a re-run's
  # artifact must not settle an earlier attempt's criterion (#1713 finding 5).
  def test_an_artifact_from_another_attempt_does_not_verify
    evidence_dir
    start_origin
    record
    write_gh_stub(run_artifacts: { '9' => [receipt_artifact(attempt: '2')] })
    out, err, status = verify('--card', '1596', '--ac', 'AC5', '--fetch', '9')
    refute status.success?, 'an artifact from another attempt is not evidence about this one'
    assert_includes out, 'FAIL the artifact staging-receipt-9-2 is attempt 2, the documents from attempt 1'
    assert_includes out, '1596 AC5 api NOT SATISFIED — unbound'
  end

  # `--ac` is a SCOPE: a request for AC5 must not fail on drift in AC6, which
  # this run does not judge. The unscoped request still reports the drift
  # (#1713 finding 6). The coverage line is NOT scoped: what is left on the card
  # is a fact about the card, so a scoped run still counts both of the card's
  # post-deploy criteria rather than filing AC6 under "outside this catalog"
  # (#1695 requirement 3).
  def test_a_scoped_ac_request_does_not_fail_on_another_criterion_s_drift
    evidence_dir
    start_origin
    record
    write_issue_body('1596', body: issue_body('1596').sub('- [ ] **(browser)**', '- [ ] **(unit)**'))
    out, err, status = verify('--card', '1596', '--ac', 'AC5')
    assert status.success?, "#{out}#{err}"
    assert_includes out, '1596 AC5 api satisfied'
    assert_includes out, 'result: 1/1 criteria satisfied'
    assert_includes out, '1596: 4 unchecked — 2 post-deploy (AC5, AC6), 2 outside this catalog (AC2, AC3)'
    refute_includes out, 'disagree'
    out, err, status = verify('--card', '1596')
    refute status.success?, 'an unscoped request still judges every criterion of the card'
    assert_includes out, '1596 AC6 is declared browser; the card declares unit: the catalog and the card disagree'
  end

  # An AC number is a checklist ordinal, so a criterion whose declaration is not
  # the bold `**(type)**` form is still a criterion. Dropping it numbered every
  # later line one lower, and #1597's fourth line, an `(api)` one, was accepted
  # as the catalog's AC3 while the card's real AC3 declares `unit` (#1713).
  def test_a_malformed_declaration_does_not_renumber_the_criteria_after_it
    evidence_dir
    start_origin
    record
    body = issue_body('1597').sub('- [x] **(unit)** the repointed', '- [x] (unit) the repointed')
                             .sub('- [ ] **(api)** each', '- [ ] **(unit)** each').sub('- [x] **(unit)** the Python', '- [ ] **(api)** the Python')
    write_issue_body('1597', body: body)
    out, err, status = verify('--card', '1597', '--ac', 'AC3')
    refute status.success?, err
    assert_includes out, 'FAIL 1597 AC3 is declared api; the card declares unit: the catalog and the card disagree'
  end

  # The malformed line itself is catalog drift, named, rather than a criterion
  # that silently left the card.
  def test_a_catalogued_criterion_with_a_malformed_declaration_is_drift
    evidence_dir
    start_origin
    record
    write_issue_body('1596', body: issue_body('1596').sub('- [ ] **(api)**', '- [ ] (api)'))
    out, err, status = verify('--card', '1596', '--ac', 'AC5')
    refute status.success?, err
    assert_includes out, 'FAIL 1596 AC5 is declared api; the card declares no recognized test type: the catalog and the card disagree'
    assert_includes out, '1596: 4 unchecked — 2 post-deploy (AC5, AC6), 2 outside this catalog (AC2, AC3)'
  end
end
