# SUT: #1596 AC5's container-absent requirement, judged over the smoke interval
# (#1713). The smoke runs before the recorder, so the recorder's own container
# read says nothing about the state the smoke passed in: the deploy lane also
# reads the container applications before the smoke, and the verifier holds
# the criterion to both reads.
require 'minitest/autorun'
require_relative 'fixtures/release/deploy-evidence/harness'

class PostDeployEvidenceSmokeIntervalTest < Minitest::Test
  include DeployEvidenceHarness

  def teardown
    cleanup_evidence
  end

  def transcript
    JSON.parse(File.read(File.join(@dir, 'evidence.json')))
  end

  # The race the recorder alone could not see: the application is deployed when
  # the smoke starts and gone by the time the recorder reads the platform.
  def test_an_application_retired_after_the_smoke_started_leaves_ac5_not_yet
    evidence_dir(containers: [CONTAINER])
    start_origin
    read_containers_before_smoke
    write_container_applications([])
    _out, err, status = record_after_smoke
    assert status.success?, err
    assert_equal [], transcript.dig('platform', 'container_applications')
    assert_equal [CONTAINER], transcript.dig('platform', 'before_smoke', 'container_applications').map { |application| application.fetch('name') }
    out, _err, status = verify('--card', '1596', '--ac', 'AC5')
    refute status.success?, 'an application deployed while the smoke ran cannot settle AC5'
    assert_includes out, '1596 AC5 api NOT SATISFIED — not-yet'
    assert_includes out, "container-absent (#{CONTAINER} deployed when the smoke started)"
  end

  # A transcript with no read taken before the smoke cannot say what state the
  # smoke passed in: the criterion is inconclusive, never satisfied.
  def test_a_transcript_without_a_read_before_the_smoke_is_inconclusive
    evidence_dir
    start_origin
    _out, err, status = record_after_smoke
    assert status.success?, err
    assert_nil transcript.dig('platform', 'before_smoke')
    out, _err, status = verify('--card', '1596', '--ac', 'AC5')
    refute status.success?, 'the state the smoke passed in was never read'
    assert_includes out, '1596 AC5 api NOT SATISFIED — inconclusive'
    assert_includes out, 'container-read-absent (no container read taken before the smoke is in the artifact)'
  end

  # A read stamped after the receipt observed the smoke is not a read of the
  # state the smoke ran in, whatever it lists.
  def test_a_read_stamped_after_the_smoke_is_not_the_smoke_interval
    evidence_dir(observed_at: '2000-01-01T00:00:00.000Z')
    start_origin
    record
    out, _err, status = verify('--card', '1596', '--ac', 'AC5')
    refute status.success?, 'a read taken after the smoke was observed does not cover it'
    assert_includes out, '1596 AC5 api NOT SATISFIED — inconclusive'
  end
end
