# frozen_string_literal: true

module RuntimeFixtures
  RUNTIME_ID = "runtime-example".freeze
  WORKER_HANDLE = "term_worker1".freeze
  PTY_ID = "repo::workspace@@pty1".freeze
  INCARNATION = "incarnation-1".freeze
  PREAMBLE = "native preamble\ncafé ' \" $PATH\n".freeze

  def compatibility_response
    status = { "ok" => true, "result" => { "appVersion" => "1.4.200",
      "runtimeId" => RUNTIME_ID, "graphStatus" => "ready",
      "capabilities" => ["terminal.create-idempotency.v2", "orchestration.contract.v1"] },
      "_meta" => { "runtimeId" => RUNTIME_ID } }
    { "ok" => true, "result" => { "expectedVersion" => "1.4.200",
      "installedVersion" => "1.4.200", "status" => status } }
  end

  def terminal_response
    terminal = { "handle" => WORKER_HANDLE, "paneKey" => "tab:leaf", "ptyId" => PTY_ID,
      "incarnationId" => INCARNATION, "surface" => "background", "hostPlatform" => "darwin",
      "worktreeId" => "repo::#{File.realpath(@workspace)}", "executionHostId" => "local" }
    ok_response("terminal" => terminal)
  end

  def task_response
    task = { "id" => "task_example1", "run_id" => "run_example1", "status" => "ready",
      "created_by_terminal_handle" => "term_coordinator1" }
    ok_response("task" => task)
  end

  def dispatch_response
    dispatch = { "id" => "ctx_example1", "run_id" => "run_example1",
      "task_id" => "task_example1", "assignee_handle" => WORKER_HANDLE,
      "creator_handle" => "term_coordinator1", "status" => "dispatched",
      "process_incarnation" => "#{PTY_ID}:#{INCARNATION}" }
    ok_response("dispatch" => dispatch, "injected" => false, "preamble" => PREAMBLE)
  end

  def ok_response(result)
    { "ok" => true, "result" => result, "_meta" => { "runtimeId" => RUNTIME_ID } }
  end

  def successful_start_results
    [compatibility_response, terminal_response, task_response, dispatch_response]
      .map { |payload| command_result(payload) }
  end

  def worker_show_response(status = "dispatched", outcome = nil)
    terminal = terminal_response.dig("result", "terminal")
      .merge("worktreePath" => File.realpath(@workspace))
    projection = { "outcome" => outcome, "liveness" => { "verdict" => "live" } }
    ok_response("dispatch" => worker_dispatch(status),
                "worker" => { "agentTerminalHandle" => WORKER_HANDLE },
                "projection" => projection, "terminal" => terminal,
                "observation" => { "status" => "live", "exactWorker" => true })
  end

  def worker_dispatch(status)
    { "id" => "ctx_example1", "runId" => "run_example1",
      "taskId" => "task_example1", "assigneeHandle" => WORKER_HANDLE,
      "processIncarnation" => "#{PTY_ID}:#{INCARNATION}", "status" => status,
      "completedAt" => "2026-09-13T00:00:00Z" }
  end

  def terminal_show_response(incarnation = INCARNATION)
    terminal = terminal_response.dig("result", "terminal").merge("incarnationId" => incarnation,
      "worktreePath" => File.realpath(@workspace), "connected" => true, "writable" => true)
    ok_response("terminal" => terminal)
  end

  def settlement_response(message_id = "msg_done1", outcome = "succeeded")
    payload = JSON.generate("taskId" => "task_example1", "dispatchId" => "ctx_example1",
                            "outcome" => outcome)
    message = { "id" => message_id, "run_id" => "run_example1",
      "delivery_contract" => "current_delivery", "from_handle" => WORKER_HANDLE,
      "to_handle" => "run:run_example1", "type" => "worker_done", "payload" => payload }
    ok_response("messages" => [message], "count" => 1)
  end

  def release_response
    ok_response("dispatchId" => "ctx_example1", "state" => "retained",
                "reason" => "no_owned_resource", "processAction" => "none")
  end

  def close_response
    ok_response("close" => { "handle" => WORKER_HANDLE, "ptyKilled" => true,
                             "ptyStopVerdict" => "exited" })
  end
end
