# frozen_string_literal: true

require_relative "card_reconcile_mailbox_fixture"

# The mailbox read: which messages it collects, and the fenced or capped read it recovers from. What
# a payload says is `WorkerDonePayloadTest`; this is the read itself.
class MailboxTest < Minitest::Test
  include MailboxFixture

  def test_collects_the_task_id_of_every_worker_done
    mailbox = build(check: [worker_message("worker_done", "task_1702"),
                            worker_message("heartbeat", "task_1703")])
    assert_equal({ "task_1702" => Time.utc(2026, 9, 16, 19) }, mailbox.settled)
  end

  def test_asks_orca_for_every_message_of_the_run_without_acking
    shell = ScriptedShell.new(responses(check: []))
    Orca::CardReconcile::Mailbox.new(Orca::CardReconcile::Command.new(shell), "term_c",
                                     "run_1").settled
    assert_equal ["orca", "orchestration", "check", "--terminal", "term_c", "--run", "run_1",
                  "--all", "--json"], shell.calls.first
  end

  def test_a_fenced_run_scoped_read_falls_back_to_the_inbox
    mailbox = build(inbox: [worker_message("worker_done", "task_1702")], fence: true)
    assert_equal ["task_1702"], mailbox.settled.keys
    assert_equal 1, mailbox.failures.length
    assert_match(/consumer_fenced/, mailbox.failures.first)
  end

  def test_reads_the_inbox_when_no_binding_is_known
    shell = ScriptedShell.new(responses(inbox: [worker_message("worker_done", "task_9")]))
    result = Orca::CardReconcile::Mailbox.new(Orca::CardReconcile::Command.new(shell), nil,
                                              nil).settled
    assert_equal ["task_9"], result.keys
    assert_equal ["orca", "orchestration", "inbox", "--limit", "1000", "--json"],
                 shell.calls.first
  end
end
