# SUT: .github/scripts/release/verify-staged-receipt.rb — the production topology workflow's
# acceptance of a staging receipt an earlier cd.yml run published. It accepts one only when it was
# produced by a cd.yml run on main in this repository, is named staging-receipt-<run>-<attempt> for
# that run, is unexpired, carries a digest that is checked on download and unchanged since
# selection, passes ReleaseReceipt.validate for that run and attempt, and tested the same selection
# under a controller this controller's history contains. Each refusal names the check that made it.
# frozen_string_literal: true
require_relative 'support/staged-receipt-harness'

class VerifyStagedReceiptTest < StagedReceiptCase
  # Produced by a cd.yml run on main in this repository.
  def test_a_receipt_another_workflow_produced_is_refused
    @workflow['path'] = '.github/workflows/release-build.yml'
    assert_refused metadata, 'staging receipt producer is not cd.yml'
  end

  def test_a_receipt_produced_off_main_is_refused
    @run['head_branch'] = 'feature'
    assert_refused metadata, 'staging receipt producer is not on main'
  end

  def test_a_receipt_produced_in_another_repository_is_refused
    @run['head_repository']['id'] = 12
    assert_refused metadata, 'repository ID mismatch'
  end

  # Named staging-receipt-<run>-<attempt> for the run that produced it. The run the name points at
  # is served as a valid cd.yml run, so only the binding to the uploading run can refuse it.
  def test_a_name_naming_another_run_is_refused
    @artifact['name'] = 'staging-receipt-10-1'
    serve('runs/10/attempts/1', @run.merge('id' => 10))
    assert_refused metadata, 'not the staging receipt of the run that uploaded it'
  end

  def test_a_production_receipt_is_refused
    @artifact['name'] = 'production-receipt-9-1'
    assert_refused metadata, 'not the staging receipt of the run that uploaded it'
  end

  def test_a_receipt_another_attempt_recorded_is_refused
    @receipt['controller_run_attempt'] = '2'
    assert_refused verify, 'staging receipt attempt mismatch'
  end

  # ReleaseReceipt.validate admits any attempt up to the one it is given, so an earlier attempt's
  # receipt under a later attempt's name is refused by the binding alone.
  def test_an_earlier_attempts_receipt_under_a_later_attempts_name_is_refused
    @artifact['name'] = 'staging-receipt-9-2'
    serve('runs/9/attempts/2', @run.merge('run_attempt' => 2))
    assert_refused verify, 'staging receipt attempt mismatch'
  end

  # Unexpired.
  def test_a_receipt_expiring_at_this_instant_is_refused
    @artifact['expires_at'] = '2026-11-25T00:00:00Z'
    assert_refused metadata, 'staging receipt expired'
  end

  def test_a_receipt_github_marks_expired_is_refused
    @artifact['expired'] = true
    assert_refused metadata, 'staging receipt expired'
  end

  # A digest the download checks, unchanged since selection.
  def test_a_malformed_digest_is_refused
    @artifact['digest'] = 'invalid-digest'
    assert_refused metadata, 'invalid staging receipt digest'
  end

  def test_a_digest_changed_since_selection_is_refused
    @environment['EXPECTED_DIGEST'] = "sha256:#{'f' * 64}"
    assert_refused metadata, 'staging receipt digest changed since selection'
  end

  def test_unavailable_metadata_is_refused
    @environment['GH_EXIT'] = '1'
    assert_refused metadata, 'staging receipt metadata is unavailable'
  end

  # Refused by the ID check itself, before any read: the fixture would also refuse the read this ID
  # makes, with the metadata refusal instead.
  def test_a_receipt_id_that_is_not_an_artifact_id_is_refused
    @environment['RECEIPT_ID'] = '20/../21'
    assert_refused metadata, 'invalid staging receipt artifact ID'
  end

  # ReleaseReceipt.validate with the producer's run and attempt.
  def test_a_receipt_recorded_by_another_run_is_refused
    @receipt['controller_run_id'] = '10'
    assert_refused verify, 'receipt belongs to another controller run'
  end

  def test_a_receipt_whose_smoke_failed_is_refused
    @receipt['smoke'] = 'failed'
    assert_refused verify, 'staging smoke evidence missing'
  end

  def test_a_production_environment_receipt_is_refused
    @receipt['environment'] = 'production'
    assert_refused verify, 'staging smoke evidence missing'
  end

  def test_a_receipt_whose_schema_was_not_applied_is_refused
    @receipt['schema']['compatible'] = false
    assert_refused verify, 'staging schema was not fully applied'
  end

  # The same selection, under a controller this controller's history contains.
  def test_a_receipt_for_another_snapshot_is_refused
    @receipt['selection']['artifact_id'] = '8'
    assert_refused verify, 'staging tested a different selection or controller'
  end

  def test_a_staging_controller_outside_this_history_is_refused
    @receipt['selection']['controller_sha'] = unrelated_commit
    assert_refused verify, 'staging ran a controller outside this controller main history'
  end

  def test_a_staging_controller_that_is_not_a_commit_sha_is_refused
    @receipt['selection']['controller_sha'] = 'main'
    assert_refused verify, 'invalid staging controller SHA'
  end

  # Acceptance.
  def test_the_metadata_phase_hands_the_download_its_producing_run_and_digest
    _output, error, status = metadata
    assert status.success?, error
    outputs = File.read(@environment['GITHUB_OUTPUT'])
    assert_includes outputs, "run_id=9\n"
    assert_includes outputs, "digest=sha256:#{'e' * 64}\n"
  end

  def test_an_earlier_runs_receipt_is_accepted_after_main_moved_on
    _output, error, status = verify
    assert status.success?, error
  end

  def test_the_digest_select_saw_is_accepted_again_after_approval
    @environment['EXPECTED_DIGEST'] = "sha256:#{'e' * 64}"
    _output, error, status = verify
    assert status.success?, error
  end
end
