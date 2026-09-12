# frozen_string_literal: true

module OrcaHeadless
  module StatusEvidence
    SETTLEMENT_OUTCOMES = { "completed" => "succeeded", "failed" => "failed" }.freeze
    module_function

    def stage(state, reader)
      exit_receipt = reader.optional("exit.json")
      return "agent_exited" if exit_receipt && exit_receipt["phase"] == "agent_exited"
      return "wrapper_failed" if exit_receipt

      stage_from_files(state)
    rescue EvidenceError
      "unknown"
    end

    def stage_from_files(state)
      order = [%w[process.json agent_started], %w[prompt.txt prompt_published],
               %w[launch.json dispatched], %w[task.json task_created],
               %w[terminal.json terminal_created], %w[compatibility.json compatible],
               %w[attempt.json initialized]]
      match = order.find { |name, _stage| File.file?(File.join(state, name)) }
      match ? match.last : "unknown"
    end

    def agent_exit(reader)
      exit_receipt = reader.optional("exit.json")
      process = reader.optional("process.json")
      return unknown_exit(exit_receipt) unless positive_exit?(exit_receipt, process)

      { "state" => "exited", "pid" => process["pid"],
        "exitCode" => exit_receipt["exitCode"] }
    rescue EvidenceError
      { "state" => "unknown", "evidence" => "invalid" }
    end

    def positive_exit?(exit_receipt, process)
      exit_receipt.is_a?(Hash) && process.is_a?(Hash) &&
        exit_receipt["phase"] == "agent_exited" &&
        exit_receipt["childPid"].is_a?(Integer) &&
        exit_receipt["childPid"] == process["pid"] && exit_receipt["exitCode"].is_a?(Integer)
    end

    def unknown_exit(exit_receipt)
      evidence = exit_receipt.is_a?(Hash) ? exit_receipt["phase"] : "absent"
      { "state" => "unknown", "evidence" => evidence || "unknown" }
    end

    def settlement(worker_response)
      dispatch = worker_response&.dig("result", "dispatch")
      return { "state" => "unknown" } unless dispatch.is_a?(Hash)
      return active_settlement(dispatch) unless SETTLEMENT_OUTCOMES.key?(dispatch["status"])
      outcome = worker_response.dig("result", "projection", "outcome")
      return { "state" => "unknown" } unless valid_settlement?(dispatch, outcome)

      { "state" => "settled", "status" => dispatch["status"],
        "outcome" => outcome }
    end

    def valid_settlement?(dispatch, outcome)
      completed = dispatch["completedAt"]
      SETTLEMENT_OUTCOMES[dispatch["status"]] == outcome &&
        completed.is_a?(String) && !completed.empty?
    end

    def active_settlement(dispatch)
      state = dispatch["status"] == "dispatched" ? "active" : "unknown"
      { "state" => state, "status" => dispatch["status"] }
    end

    def identity(launch, worker_response, terminal_response)
      return { "state" => "unknown" } unless worker_response && terminal_response
      return { "state" => "mismatch" } unless worker_matches?(launch, worker_response)
      return { "state" => "mismatch" } unless terminal_matches?(launch, terminal_response)

      { "state" => "match", "handle" => launch.dig("terminal", "handle") }
    end

    def worker_matches?(launch, response)
      result = response.fetch("result")
      dispatch = result.fetch("dispatch")
      terminal = result.fetch("terminal")
      identities = dispatch_values_match?(launch, dispatch) && terminal_values_match?(launch, terminal)
      identities && exact_worker?(launch, result)
    rescue KeyError, TypeError
      false
    end

    def exact_worker?(launch, result)
      handle = launch.dig("terminal", "handle")
      result.dig("worker", "agentTerminalHandle") == handle &&
        result.dig("observation", "exactWorker") == true
    end

    def dispatch_values_match?(launch, dispatch)
      expected = [launch["dispatchId"], launch["taskId"], launch["runId"],
                  launch.dig("terminal", "handle"), launch["processIncarnation"]]
      actual = dispatch.values_at("id", "taskId", "runId", "assigneeHandle", "processIncarnation")
      expected == actual
    end

    def terminal_matches?(launch, response)
      terminal = response.dig("result", "terminal")
      terminal_values_match?(launch, terminal)
    end

    def terminal_values_match?(launch, terminal)
      return false unless terminal.is_a?(Hash)

      expected = launch.fetch("terminal").values_at("handle", "ptyId", "incarnationId")
      actual = terminal.values_at("handle", "ptyId", "incarnationId")
      expected == actual && terminal["worktreePath"] == launch["workspace"]
    end
  end
end
