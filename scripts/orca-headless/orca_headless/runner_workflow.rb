# frozen_string_literal: true

require "time"

module OrcaHeadless
  module RunnerWorkflow
    module_function

    def call(context)
      record_ready(context)
      return prompt_timeout(context) unless wait_for_prompt(context)

      run_agent(context)
    rescue StandardError => error
      spawn_failure(context, error)
    end

    def record_ready(context)
      context.store.write_json("runner-ready.json", "pid" => Process.pid,
                               "recordedAt" => Time.now.utc.iso8601)
    end

    def wait_for_prompt(context)
      deadline = context.clock.monotonic + context.timeout
      return true if File.file?(prompt_path(context))

      wait_until(context, deadline)
    end

    def wait_until(context, deadline)
      while context.clock.monotonic < deadline
        context.clock.sleep(0.1)
        return true if File.file?(prompt_path(context))
      end
      false
    end

    def prompt_path(context)
      File.join(context.state, "prompt.txt")
    end

    def prompt_timeout(context)
      context.store.write_json("exit.json", "phase" => "prompt_timeout", "exitCode" => 124,
                               "observedAt" => Time.now.utc.iso8601)
      124
    end

    def run_agent(context)
      config = RunnerConfigLoader.load(context.state)
      pid = start_agent(context, config)
      code = finish_agent(context, pid)
      context.hold.call
      code
    end

    def start_agent(context, config)
      pid = context.process.spawn(config.argv, process_options(config))
      context.store.write_json("process.json", process_payload(config, pid))
      pid
    end

    def finish_agent(context, pid)
      code = context.process.wait(pid)
      record_exit(context, pid, code)
      record_hold(context, pid)
      code
    end

    def process_options(config)
      { "cwd" => config.cwd, "stdin" => config.stdin,
        "stdout" => config.stdout, "stderr" => config.stderr }
    end

    def process_payload(config, pid)
      { "pid" => pid, "argv" => config.argv, "cwd" => config.cwd,
        "stdin" => config.stdin, "stdout" => config.stdout, "stderr" => config.stderr,
        "startedAt" => Time.now.utc.iso8601 }
    end

    def record_exit(context, pid, code)
      context.store.write_json("exit.json", "phase" => "agent_exited", "childPid" => pid,
                               "exitCode" => code, "observedAt" => Time.now.utc.iso8601)
    end

    def record_hold(context, child_pid)
      context.store.write_json("hold.json", "phase" => "awaiting_cleanup",
                               "wrapperPid" => Process.pid, "childPid" => child_pid,
                               "recordedAt" => Time.now.utc.iso8601)
    end

    def spawn_failure(context, error)
      context.store.failure("runner", error)
      context.store.write_json("exit.json", "phase" => "spawn_failed", "exitCode" => 127,
                               "error" => error.class.name,
                               "observedAt" => Time.now.utc.iso8601)
      127
    rescue InputError
      127
    end
  end
end
