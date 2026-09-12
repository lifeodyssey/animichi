# frozen_string_literal: true

module OrcaHeadless
  module ResponseVerifier
    EXPECTED_VERSION = "1.4.200".freeze
    REQUIRED_CAPABILITIES = ["terminal.create-idempotency.v2", "orchestration.contract.v1"].freeze
    module_function

    def compatibility(response)
      result = response.fetch("result")
      status = result.fetch("status")
      expect(result["installedVersion"] == EXPECTED_VERSION, "compatibility", "installed version")
      verify_status(status)
      status.dig("_meta", "runtimeId")
    rescue KeyError, TypeError
      raise StageFailure.new("compatibility", "compatibility response shape is unknown")
    end

    def verify_status(status)
      result = status.fetch("result")
      expect(result["appVersion"] == EXPECTED_VERSION, "compatibility", "live version")
      expect(result["graphStatus"] == "ready", "compatibility", "runtime graph")
      missing = REQUIRED_CAPABILITIES - Array(result["capabilities"])
      expect(missing.empty?, "compatibility", "runtime capabilities")
    end

    def terminal(response, input, runtime_id)
      verify_runtime(response, runtime_id, "terminal-create")
      terminal = response.dig("result", "terminal")
      expect(terminal.is_a?(Hash), "terminal-create", "terminal response")
      verify_terminal_fields(terminal, input)
      terminal
    end

    def verify_terminal_fields(terminal, input)
      %w[handle paneKey ptyId incarnationId executionHostId].each do |key|
        expect(nonempty?(terminal[key]), "terminal-create", "terminal #{key}")
      end
      expect(terminal["surface"] == "background", "terminal-create", "background surface")
      suffix = "::#{input.workspace}"
      expect(terminal["worktreeId"].to_s.end_with?(suffix), "terminal-create", "workspace identity")
    end

    def task(response, input, runtime_id)
      verify_runtime(response, runtime_id, "task-create")
      task = response.dig("result", "task")
      expect(task.is_a?(Hash), "task-create", "task response")
      expect(task["run_id"] == input.run_id, "task-create", "task Run")
      expect(task["created_by_terminal_handle"] == input.coordinator, "task-create", "task creator")
      expect(task["status"] == "ready" && nonempty?(task["id"]), "task-create", "task identity")
      task
    end

    def dispatch(response, input, runtime_id, task, terminal)
      verify_runtime(response, runtime_id, "dispatch")
      dispatch = response.dig("result", "dispatch")
      expect(dispatch.is_a?(Hash), "dispatch", "dispatch response")
      verify_dispatch_fields(response, input, task, terminal, dispatch)
      dispatch
    end

    def verify_dispatch_fields(response, input, task, terminal, dispatch)
      expect(dispatch["task_id"] == task["id"], "dispatch", "dispatch Task")
      expect(dispatch["run_id"] == input.run_id, "dispatch", "dispatch Run")
      expect(dispatch["assignee_handle"] == terminal["handle"], "dispatch", "assignee")
      expect(dispatch["creator_handle"] == input.coordinator, "dispatch", "creator")
      expect(dispatch["status"] == "dispatched", "dispatch", "dispatch status")
      expect(dispatch["process_incarnation"] == incarnation(terminal), "dispatch", "incarnation")
      expect(response.dig("result", "injected") == false, "dispatch", "non-injected dispatch")
      expect(valid_preamble?(response.dig("result", "preamble")), "dispatch", "preamble")
    end

    def verify_runtime(response, runtime_id, stage)
      expect(response.dig("_meta", "runtimeId") == runtime_id, stage, "runtime identity")
    end

    def incarnation(terminal)
      "#{terminal.fetch('ptyId')}:#{terminal.fetch('incarnationId')}"
    end

    def valid_preamble?(value)
      value.is_a?(String) && !value.empty? && value.encoding == Encoding::UTF_8 && value.valid_encoding?
    end

    def nonempty?(value)
      value.is_a?(String) && !value.empty?
    end

    def expect(condition, stage, label)
      raise StageFailure.new(stage, "#{label} is unsupported or inconsistent") unless condition
    end
  end
end
