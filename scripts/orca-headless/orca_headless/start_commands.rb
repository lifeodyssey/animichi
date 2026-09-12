# frozen_string_literal: true

require "rbconfig"
require "shellwords"

module OrcaHeadless
  module StartCommands
    BRIDGE = File.expand_path("../runtime-client.cjs", __dir__)
    RUNNER = File.expand_path("../runner.rb", __dir__)
    module_function

    def compatibility(input)
      [input.node, BRIDGE, "compatibility", "--client", input.runtime_client]
    end

    def terminal(input, request_path)
      [input.node, BRIDGE, "terminal-create", "--client", input.runtime_client,
       "--request", request_path]
    end

    def task(input, request_id)
      [input.orca, "orchestration", "task-create", "--spec", input.spec_text,
       "--task-title", input.title, "--run", input.run_id, "--from", input.coordinator,
       "--retry-request", request_id, "--json"]
    end

    def dispatch(input, task_id, terminal, request_id)
      [input.orca, "orchestration", "dispatch", "--task", task_id, "--to", terminal,
       "--return-preamble", "--run", input.run_id, "--from", input.coordinator,
       "--retry-request", request_id, "--json"]
    end

    def terminal_request(input, request_id, mutation_id)
      params = { "worktree" => "path:#{input.workspace}", "title" => input.title,
        "command" => runner_command(input), "presentation" => "background", "focus" => false,
        "activate" => false, "rendererBacked" => false,
        "clientMutationId" => mutation_id, "reconcileExisting" => true }
      { "requestId" => request_id, "params" => params }
    end

    def runner_command(input)
      Shellwords.join(runner_argv(input))
    end

    def runner_argv(input)
      ["exec", RbConfig.ruby, RUNNER, "--state", input.state_dir,
       "--timeout", input.startup_timeout.to_s]
    end
  end
end
