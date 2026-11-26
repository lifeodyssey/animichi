# frozen_string_literal: true
require 'time'
require_relative 'selection'

# The staging receipt a production topology run accepts from an earlier cd.yml run (ADR 0010).
# `receipt.rb` judges a receipt the same controller run produced; this judges where one came from
# when it did not, and hands `ReleaseReceipt.validate` the run, attempt and selection it was made under.
module StagedReceipt
  WORKFLOW = '.github/workflows/cd.yml'
  NAME = /\Astaging-receipt-([1-9]\d*)-([1-9]\d*)\z/
  module_function

  # The artifact's own metadata: named for the run that uploaded it, unexpired, with a real digest.
  # Returns that run and attempt.
  def validate_artifact(artifact, id:, now:)
    ReleaseSelection.require_value(artifact.fetch('id').to_s == id, 'staging receipt artifact ID mismatch')
    named = artifact.fetch('name').match(NAME)
    producer = artifact.fetch('workflow_run').fetch('id').to_s
    ReleaseSelection.require_value(named && named[1] == producer, 'not the staging receipt of the run that uploaded it')
    ReleaseSelection.require_value(artifact.fetch('expired') == false && Time.iso8601(artifact.fetch('expires_at')) > now,
                                   'staging receipt expired')
    ReleaseSelection.require_value(artifact.fetch('digest').match?(/\Asha256:[a-f0-9]{64}\z/), 'invalid staging receipt digest')
    { 'run_id' => named[1], 'attempt' => named[2] }
  end

  # The run attempt that uploaded it: cd.yml, on main, in this repository.
  def validate_producer(run, workflow, repository_id)
    ReleaseSelection.require_value(run.fetch('head_branch') == 'main', 'staging receipt producer is not on main')
    ReleaseSelection.require_value(workflow.fetch('path') == WORKFLOW && workflow.fetch('id') == run.fetch('workflow_id'),
                                   'staging receipt producer is not cd.yml')
    %w[repository head_repository].each { |key| ReleaseSelection.validate_repository(run.fetch(key), repository_id) }
  end

  # The selection staging tested: this controller's own, with the SHA of the controller that ran it.
  def expected_selection(selection, receipt)
    controller = receipt.fetch('selection').fetch('controller_sha')
    ReleaseSelection.require_value(controller.match?(/\A[a-f0-9]{40}\z/), 'invalid staging controller SHA')
    selection.merge('controller_sha' => controller)
  end
end
