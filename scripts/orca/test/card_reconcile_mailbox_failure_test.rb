# frozen_string_literal: true

require_relative "card_reconcile_mailbox_fixture"

# A mailbox read that cannot be trusted: a capped page, every source failing, and a document that is
# not JSON. None of them may be read as "nothing settled".
class MailboxFailureTest < Minitest::Test
  include MailboxFixture

  def test_a_capped_inbox_is_noted_but_still_read
    mailbox = build(inbox: [worker_message("worker_done", "task_9")], limit: 1)
    assert_equal ["task_9"], mailbox.settled.keys
    assert_equal 1, mailbox.failures.length
    assert_match(/settlement evidence may be capped/, mailbox.failures.first)
  end

  def test_refuses_to_report_settlement_when_every_source_fails
    mailbox = build(fence: true, inbox_fence: true)
    error = assert_raises(Orca::CardReconcile::Failure) { mailbox.settled }
    assert_match(/consumer_fenced/, error.message)
    assert_match(/timed_out/, error.message)
  end

  def test_raises_a_failure_when_the_document_is_not_json
    shell = ScriptedShell.new(check_key => "not json", inbox_key => "not json")
    command = Orca::CardReconcile::Command.new(shell)
    error = assert_raises(Orca::CardReconcile::Failure) do
      Orca::CardReconcile::Mailbox.new(command, nil, nil).settled
    end
    assert_match(/malformed JSON/, error.message)
  end
end
