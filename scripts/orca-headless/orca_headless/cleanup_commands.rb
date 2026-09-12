# frozen_string_literal: true

module OrcaHeadless
  module CleanupCommands
    module_function

    def worker_show(context)
      [orca(context), "orchestration", "worker-show", "--dispatch",
       context.launch.fetch("dispatchId"), "--json"]
    end

    def terminal_show(context)
      [orca(context), "terminal", "show", "--terminal", handle(context), "--json"]
    end

    def settlement(context)
      [orca(context), "orchestration", "check", "--terminal",
       context.launch.fetch("coordinatorHandle"), "--run", context.launch.fetch("runId"),
       "--all", "--types", "worker_done", "--json"]
    end

    def release(context, request_id)
      [orca(context), "orchestration", "worker-release", "--dispatch",
       context.launch.fetch("dispatchId"), "--retry-request", request_id, "--json"]
    end

    def close(context)
      [orca(context), "terminal", "close", "--terminal", handle(context), "--json"]
    end

    def orca(context)
      context.reader.required("attempt.json").fetch("orcaCli")
    end

    def handle(context)
      context.launch.fetch("terminal").fetch("handle")
    end
  end
end
