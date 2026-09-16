# frozen_string_literal: true

require_relative "card_reconcile_fixtures"
require_relative "scripted_shell"

# The Orca mailbox documents a test asks with, and the Mailbox built over them. The Run-scoped read
# can be fenced at any moment and the inbox is capped, so both are answerable.
module MailboxFixture
  LIMIT = Orca::CardReconcile::MailboxSources::INBOX_LIMIT

  module_function

  def build(check: [], inbox: [], fence: false, inbox_fence: false, limit: LIMIT)
    shell = ScriptedShell.new(responses(check: check, inbox: inbox, fence: fence,
                                        inbox_fence: inbox_fence, limit: limit))
    Orca::CardReconcile::Mailbox.new(Orca::CardReconcile::Command.new(shell), "term_c", "run_1",
                                     limit: limit)
  end

  def responses(check: [], inbox: [], fence: false, inbox_fence: false, limit: LIMIT)
    { check_key => fence ? fenced("consumer_fenced") : JSON.generate(document(check)),
      inbox_key(limit) => inbox_fence ? fenced("timed_out") : JSON.generate(document(inbox)) }
  end

  def worker_message(type, task_id, created_at = "2026-09-16T19:00:00Z")
    payload = { "taskId" => task_id, "outcome" => "succeeded" }
    { "type" => type, "created_at" => created_at, "payload" => JSON.generate(payload) }
  end

  def check_key
    "orca orchestration check"
  end

  def inbox_key(limit = LIMIT)
    "orca orchestration inbox --limit #{limit}"
  end

  def document(messages)
    { "ok" => true, "result" => { "messages" => messages, "count" => messages.length,
                                  "runId" => "run_1" } }
  end

  def fenced(code)
    error = { "ok" => false, "error" => { "code" => code } }
    Orca::CardReconcile::Command::Result.new(JSON.generate(error), "", 1)
  end
end
