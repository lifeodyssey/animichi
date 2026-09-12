# frozen_string_literal: true

require "json"
require "shellwords"
require "time"

module OrcaHeadless
  module CleanupGuard
    module_function

    def positive_exit!(context)
      exit_receipt = context.reader.optional("exit.json")
      process = context.reader.optional("process.json")
      ready = context.reader.optional("runner-ready.json")
      hold = context.reader.optional("hold.json")
      return if StatusEvidence.positive_exit?(exit_receipt, process) &&
                positive_hold?(exit_receipt, process, ready, hold) && ownership_contract?(context)

      raise EvidenceError, "cleanup requires positive agent exit evidence"
    end

    def positive_hold?(exit_receipt, process, ready, hold)
      return false unless ready.is_a?(Hash) && hold.is_a?(Hash)

      hold["phase"] == "awaiting_cleanup" && hold["wrapperPid"] == ready["pid"] &&
        hold["childPid"] == process["pid"] && hold["childPid"] == exit_receipt["childPid"]
    end

    def ownership_contract?(context)
      request = context.reader.optional("terminal-request.json")
      command = request&.dig("params", "command")
      return false unless context.launch["wrapperMode"] == "exec_hold_after_agent_exit"
      return false unless command.is_a?(String)

      Shellwords.split(command) == context.launch["wrapperArgv"]
    rescue ArgumentError
      false
    end

    def settled_worker!(context, response)
      runtime!(context, response, "worker inspection")
      identity_matches = StatusEvidence.worker_matches?(context.launch, response)
      raise EvidenceError, "worker identity changed or is unknown" unless identity_matches
      dispatch = response.dig("result", "dispatch")
      outcome = response.dig("result", "projection", "outcome")
      return outcome if valid_settlement?(response, dispatch, outcome)

      raise EvidenceError, "Dispatch is active, unsettled, or unknown"
    end

    def valid_settlement?(response, dispatch, outcome)
      valid = { "completed" => "succeeded", "failed" => "failed" }
      expected = valid[dispatch["status"]]
      live_wrapper = response.dig("result", "observation", "status") == "live"
      expected && expected == outcome && dispatch["completedAt"] && live_wrapper
    end

    def terminal!(context, response, label = "terminal")
      runtime!(context, response, "terminal inspection")
      terminal = response.dig("result", "terminal")
      exact = StatusEvidence.terminal_matches?(context.launch, response)
      owned = terminal && terminal["connected"] == true && terminal["writable"] == true
      safe = exact && owned
      safe &&= wrapper_owned?(context, label)
      return if safe

      raise EvidenceError, "terminal identity, incarnation, or wrapper ownership changed"
    end

    def wrapper_owned?(context, label)
      return false unless local_darwin_launch?(context.launch)

      ready = context.reader.optional("runner-ready.json")
      pid = ready&.fetch("pid", nil)
      return false unless pid.is_a?(Integer) && pid.positive?

      observation = context.process_observer.observe(pid)
      record_process_observation(context, label, observation)
      process_matches?(context, ready, observation)
    rescue SystemCallError, TypeError
      false
    end

    def record_process_observation(context, label, observation)
      prefix = context.store.inspection_prefix("cleanup-#{label}-process")
      context.store.write_json("#{prefix}.json", observation)
    end

    def process_matches?(context, ready, observation)
      return false unless ready.is_a?(Hash) && observation.is_a?(Hash)

      expected = [ready["pid"], expected_wrapper_command(context.launch)]
      actual = observation.values_at("pid", "command")
      expected == actual && valid_process_fence?(ready, observation)
    end

    def local_darwin_launch?(launch)
      terminal = launch["terminal"]
      terminal.is_a?(Hash) && terminal.values_at("executionHostId", "hostPlatform") == %w[local darwin]
    end

    def expected_wrapper_command(launch)
      argv = launch["wrapperArgv"]
      return unless argv.is_a?(Array) && argv.length > 1 && argv.first == "exec"
      return unless argv.all? { |part| part.is_a?(String) && !part.empty? }

      argv.drop(1).join(" ")
    end

    def valid_process_fence?(ready, observation)
      times = [observation["startedAt"], ready["recordedAt"], observation["observedAt"]]
      started, recorded, observed = times.map { |value| Time.iso8601(value) }
      valid_process_shape?(observation) && started <= recorded && recorded <= observed
    rescue ArgumentError, TypeError
      false
    end

    def valid_process_shape?(observation)
      ppid = observation["ppid"]
      groups = observation.values_at("processGroup", "foregroundProcessGroup")
      tty = observation["tty"]
      observation["verdict"] == "live" && ppid.is_a?(Integer) && ppid.positive? &&
        groups.first.is_a?(Integer) && groups.first.positive? && groups.uniq.length == 1 &&
        tty.is_a?(String) && /\Atty[[:alnum:]]+\z/.match?(tty)
    end

    def settlement!(context, response, worker_outcome)
      runtime!(context, response, "settlement inspection")
      message = find_message(context, response)
      payload = parse_payload(message)
      validate_message!(context, message, payload, worker_outcome)
      message
    end

    def find_message(context, response)
      messages = response.dig("result", "messages")
      message = Array(messages).find { |item| item["id"] == context.input.settlement_message }
      raise EvidenceError, "named worker_done settlement was not found" unless message

      message
    end

    def parse_payload(message)
      JSON.parse(message.fetch("payload"))
    rescue JSON::ParserError, KeyError, TypeError
      raise EvidenceError, "worker_done settlement payload is invalid"
    end

    def validate_message!(context, message, payload, outcome)
      launch = context.launch
      expected = [launch["runId"], launch.dig("terminal", "handle"), "run:#{launch['runId']}",
                  "worker_done", "current_delivery", launch["taskId"], launch["dispatchId"], outcome]
      actual = message.values_at("run_id", "from_handle", "to_handle", "type", "delivery_contract")
      actual += payload.values_at("taskId", "dispatchId", "outcome")
      raise EvidenceError, "worker_done settlement does not bind to this attempt" unless expected == actual
    end

    def release!(context, response)
      runtime!(context, response, "worker release")
      result = response.fetch("result")
      expected = [context.launch["dispatchId"], "retained", "no_owned_resource", "none"]
      actual = result.values_at("dispatchId", "state", "reason", "processAction")
      raise EvidenceError, "worker release response is unknown" unless expected == actual
    rescue KeyError, TypeError
      raise EvidenceError, "worker release response is unknown"
    end

    def release_request!(context)
      request = context.reader.required("worker-release-request.json")
      expected = [context.launch["dispatchId"], context.launch["runtimeId"]]
      actual = request.values_at("dispatchId", "runtimeId")
      raise EvidenceError, "worker release request does not bind to this attempt" unless expected == actual
    end

    def positive_close?(context)
      request = context.reader.optional("terminal-close-request.json")
      response = context.reader.optional("terminal-close.json")
      return false unless request && response
      return false unless request["terminal"] == context.launch["terminal"]

      close_response?(context, response)
    rescue EvidenceError
      false
    end

    def close_response?(context, response)
      runtime!(context, response, "terminal close")
      close = response.dig("result", "close")
      close.is_a?(Hash) && close["handle"] == context.launch.dig("terminal", "handle") &&
        close["ptyKilled"] == true
    end

    def runtime!(context, response, label)
      actual = response&.dig("_meta", "runtimeId")
      return if actual == context.launch["runtimeId"]

      raise EvidenceError, "#{label} came from another or unknown runtime"
    end
  end
end
