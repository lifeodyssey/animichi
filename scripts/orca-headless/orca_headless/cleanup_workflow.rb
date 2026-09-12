# frozen_string_literal: true

require "securerandom"

module OrcaHeadless
  module CleanupWorkflow
    module_function

    def call(context)
      return summary(context, "already_cleaned") if CleanupGuard.positive_close?(context)

      refuse_ambiguous_close!(context)
      preflight(context)
      release(context)
      CleanupGuard.terminal!(context, inspect_terminal(context, "terminal-after"), "terminal-after")
      close(context)
      summary(context, "cleaned")
    end

    def preflight(context)
      CleanupGuard.positive_exit!(context)
      worker = inspect(context, "worker", CleanupCommands.worker_show(context))
      outcome = CleanupGuard.settled_worker!(context, worker)
      CleanupGuard.terminal!(context, inspect_terminal(context, "terminal-before"), "terminal-before")
      settlement = inspect(context, "settlement", CleanupCommands.settlement(context))
      CleanupGuard.settlement!(context, settlement, outcome)
    end

    def inspect_terminal(context, label)
      inspect(context, label, CleanupCommands.terminal_show(context))
    end

    def inspect(context, label, command)
      prefix = context.store.inspection_prefix("cleanup-#{label}")
      context.gateway.call(prefix, command, "#{prefix}.json")
    end

    def release(context)
      existing = mutation_receipt(context, "worker-release")
      return validate_existing_release(context, existing) if existing

      request_id = SecureRandom.uuid
      context.store.write_json("worker-release-request.json", mutation_request(context, request_id))
      response = context.gateway.call("worker-release", CleanupCommands.release(context, request_id),
                                      "worker-release.json")
      CleanupGuard.release!(context, response)
    end

    def validate_existing_release(context, response)
      CleanupGuard.release_request!(context)
      CleanupGuard.release!(context, response)
    end

    def close(context)
      context.store.write_json("terminal-close-request.json", close_request(context))
      response = context.gateway.call("terminal-close", CleanupCommands.close(context),
                                      "terminal-close.json")
      valid = CleanupGuard.close_response?(context, response)
      raise EvidenceError, "terminal close did not prove ptyKilled" unless valid
    end

    def mutation_receipt(context, name)
      request = context.reader.optional("#{name}-request.json")
      response = context.reader.optional("#{name}.json")
      return nil unless request || response
      raise EvidenceError, "prior #{name} outcome is unknown" unless request && response

      response
    end

    def refuse_ambiguous_close!(context)
      request = context.reader.optional("terminal-close-request.json")
      response = context.reader.optional("terminal-close.json")
      return unless request || response

      raise EvidenceError, "prior terminal-close outcome is unknown"
    end

    def mutation_request(context, request_id)
      { "requestId" => request_id, "dispatchId" => context.launch.fetch("dispatchId"),
        "runtimeId" => context.launch.fetch("runtimeId") }
    end

    def close_request(context)
      { "runtimeId" => context.launch.fetch("runtimeId"),
        "terminal" => context.launch.fetch("terminal") }
    end

    def summary(context, status)
      { "status" => status, "stateDirectory" => context.input.state_dir,
        "taskId" => context.launch.fetch("taskId"),
        "dispatchId" => context.launch.fetch("dispatchId"),
        "terminalHandle" => context.launch.dig("terminal", "handle") }
    end
  end
end
