# frozen_string_literal: true

module OrcaHeadless
  module StatusWorkflow
    module_function

    def call(context)
      launch = context.reader.optional("launch.json")
      return InspectionResult.new(unknown_payload(context), 1) unless launch

      worker, terminal = native_observations(context, launch)
      payload = status_payload(context, launch, worker, terminal)
      InspectionResult.new(payload, valid?(payload) ? 0 : 1)
    end

    def native_observations(context, launch)
      prefix = context.store.inspection_prefix("status")
      worker = safe_call(context, "#{prefix}-worker", worker_command(context, launch))
      terminal = safe_call(context, "#{prefix}-terminal", terminal_command(context, launch))
      [worker, terminal]
    end

    def safe_call(context, stage, command)
      context.gateway.call(stage, command, "#{stage}.json")
    rescue StageFailure
      nil
    end

    def worker_command(context, launch)
      [orca_cli(context), "orchestration", "worker-show", "--dispatch",
       launch.fetch("dispatchId"), "--json"]
    end

    def terminal_command(context, launch)
      handle = launch.fetch("terminal").fetch("handle")
      [orca_cli(context), "terminal", "show", "--terminal", handle, "--json"]
    end

    def orca_cli(context)
      context.reader.required("attempt.json").fetch("orcaCli")
    end

    def status_payload(context, launch, worker, terminal)
      common_payload(context).merge(
        "taskSettlement" => StatusEvidence.settlement(worker),
        "terminalIdentity" => StatusEvidence.identity(launch, worker, terminal)
      )
    end

    def unknown_payload(context)
      common_payload(context).merge(
        "taskSettlement" => { "state" => "unknown" },
        "terminalIdentity" => { "state" => "unknown" }
      )
    end

    def common_payload(context)
      { "stateDirectory" => context.input.state_dir,
        "stage" => StatusEvidence.stage(context.input.state_dir, context.reader),
        "agentCliExit" => StatusEvidence.agent_exit(context.reader),
        "candidateApproval" => "not_evaluated" }
    end

    def valid?(payload)
      payload.dig("terminalIdentity", "state") == "match" &&
        payload.dig("taskSettlement", "state") != "unknown"
    end
  end
end
