# frozen_string_literal: true

module OrcaHeadless
  module CLI
    module_function

    def run(argv, stdout: $stdout, stderr: $stderr, runner: RealCommandRunner.new,
            resolver: ExecutableResolver.new, process_observer: NativeProcessObserver.new)
      dispatch(argv, stdout, stderr, runner, resolver, process_observer)
    rescue InputError, EvidenceError, StageFailure => error
      stderr.puts("orca-headless: #{error.message}")
      1
    end

    def dispatch(argv, stdout, stderr, runner, resolver, process_observer)
      command = argv.shift
      return run_start(argv, stdout, runner, resolver) if command == "start"
      return run_status(argv, stdout, runner) if command == "status"
      return run_cleanup(argv, stdout, runner, process_observer) if command == "cleanup"

      stderr.puts("orca-headless: expected start, status, or cleanup")
      1
    end

    def run_start(argv, stdout, runner, resolver)
      stdout.puts(JSON.generate(Start.new(argv, runner, resolver).call))
      0
    end

    def run_status(argv, stdout, runner)
      result = Status.new(argv, runner).call
      stdout.puts(JSON.generate(result.payload))
      result.exit_code
    end

    def run_cleanup(argv, stdout, runner, process_observer)
      stdout.puts(JSON.generate(Cleanup.new(argv, runner, process_observer).call))
      0
    end
  end
end
