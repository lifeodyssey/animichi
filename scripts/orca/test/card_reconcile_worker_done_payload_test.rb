# frozen_string_literal: true

require_relative "card_reconcile_fixtures"

# The payload of a `worker_done` message: an object, a JSON string, or a string a fenced write left
# with invalid escapes, from which the task id is recovered by pattern.
class WorkerDonePayloadTest < Minitest::Test
  def test_reads_the_task_id_of_an_object_payload
    assert_equal "task_1702", payload("payload" => { "taskId" => "task_1702" }).task_id
  end

  def test_reads_the_task_id_of_a_json_string_payload
    message = { "payload" => JSON.generate({ "taskId" => "task_9", "outcome" => "failed" }) }
    assert_equal "task_9", payload(message).task_id
  end

  def test_recovers_a_task_id_from_a_payload_with_invalid_escapes
    message = { "payload" => "{\"taskId\":\"task_9\",\"note\":\"a\\x break\"}" }
    assert_equal "task_9", payload(message).task_id
  end

  def test_a_payload_without_a_task_id_has_none
    assert_nil payload("payload" => { "outcome" => "succeeded" }).task_id
    assert_nil payload("payload" => "not json at all").task_id
    assert_nil payload("payload" => 42).task_id
  end

  private

  def payload(message)
    Orca::CardReconcile::WorkerDonePayload.new(message)
  end
end
