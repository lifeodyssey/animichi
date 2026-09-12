# frozen_string_literal: true

require "securerandom"
require "time"

module OrcaHeadless
  module StartWorkflow
    module_function

    def call(context)
      record_attempt(context)
      context.model = record_model(context)
      context.runtime_id = compatibility(context)
      context.terminal = create_terminal(context)
      context.task = create_task(context)
      context.dispatch, context.dispatch_response = create_dispatch(context)
      finish(context)
    end

    def record_attempt(context)
      context.store.write_json("attempt.json", attempt_payload(context.input))
    end

    def attempt_payload(input)
      { "schemaVersion" => 1, "workspace" => input.workspace,
        "coordinatorHandle" => input.coordinator, "runId" => input.run_id,
        "title" => input.title, "specFile" => input.spec_file,
        "specSha256" => input.spec_sha256, "provider" => input.provider,
        "model" => input.model, "effort" => input.effort,
        "runtimeClient" => input.runtime_client, "orcaCli" => input.orca }
    end

    def record_model(context)
      model = ModelCommand.build(context.input)
      context.store.write("empty.stdin", "") if context.input.provider == "grok"
      context.store.write_json("runner-config.json", model_payload(context.input, model))
      model
    end

    def model_payload(input, model)
      { "schemaVersion" => 1, "cwd" => input.workspace, "argv" => model.argv,
        "stdin" => model.stdin_path, "stdout" => model.stdout_path,
        "stderr" => model.stderr_path }
    end

    def compatibility(context)
      response = context.gateway.call("compatibility", StartCommands.compatibility(context.input),
                                      "compatibility.json")
      ResponseVerifier.compatibility(response)
    end

    def create_terminal(context)
      request = StartCommands.terminal_request(context.input, SecureRandom.uuid, SecureRandom.uuid)
      context.store.write_json("terminal-request.json", request)
      response = context.gateway.call("terminal-create", terminal_command(context), "terminal.json")
      ResponseVerifier.terminal(response, context.input, context.runtime_id)
    end

    def terminal_command(context)
      path = File.join(context.store.path, "terminal-request.json")
      StartCommands.terminal(context.input, path)
    end

    def create_task(context)
      request_id = SecureRandom.uuid
      context.store.write_json("task-request.json", task_request(context.input, request_id))
      response = context.gateway.call("task-create", StartCommands.task(context.input, request_id),
                                      "task.json")
      ResponseVerifier.task(response, context.input, context.runtime_id)
    end

    def task_request(input, request_id)
      { "requestId" => request_id, "runId" => input.run_id,
        "coordinatorHandle" => input.coordinator, "title" => input.title,
        "specFile" => input.spec_file, "specSha256" => input.spec_sha256 }
    end

    def create_dispatch(context)
      request_id = SecureRandom.uuid
      context.store.write_json("dispatch-request.json", dispatch_request(context, request_id))
      response = context.gateway.call("dispatch", dispatch_command(context, request_id), "dispatch.json")
      [ResponseVerifier.dispatch(response, context.input, context.runtime_id,
                                 context.task, context.terminal), response]
    end

    def dispatch_request(context, request_id)
      { "requestId" => request_id, "taskId" => context.task.fetch("id"),
        "terminalHandle" => context.terminal.fetch("handle"), "returnPreamble" => true }
    end

    def dispatch_command(context, request_id)
      StartCommands.dispatch(context.input, context.task.fetch("id"),
                             context.terminal.fetch("handle"), request_id)
    end

    def finish(context)
      context.store.write_json("launch.json", launch_payload(context))
      context.store.write("prompt.txt", context.dispatch_response.dig("result", "preamble").b)
      summary(context)
    end

    def launch_payload(context)
      launch_identity(context).merge(launch_execution(context))
    end

    def launch_identity(context)
      { "schemaVersion" => 1, "runtimeId" => context.runtime_id,
        "workspace" => context.input.workspace, "coordinatorHandle" => context.input.coordinator,
        "runId" => context.input.run_id, "taskId" => context.task.fetch("id"),
        "dispatchId" => context.dispatch.fetch("id"),
        "processIncarnation" => context.dispatch.fetch("process_incarnation") }
    end

    def launch_execution(context)
      input = context.input
      { "provider" => input.provider, "model" => input.model, "effort" => input.effort,
        "modelArgv" => context.model.argv, "terminal" => context.terminal,
        "wrapperMode" => "exec_hold_after_agent_exit",
        "wrapperArgv" => StartCommands.runner_argv(input),
        "recordedAt" => Time.now.utc.iso8601 }
    end

    def summary(context)
      { "status" => "started", "stateDirectory" => context.input.state_dir,
        "taskId" => context.task.fetch("id"), "dispatchId" => context.dispatch.fetch("id"),
        "terminalHandle" => context.terminal.fetch("handle"), "agentCliExit" => "unobserved",
        "taskSettlement" => "active", "candidateApproval" => "not_evaluated" }
    end
  end
end
