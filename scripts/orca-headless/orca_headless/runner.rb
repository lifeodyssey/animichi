# frozen_string_literal: true

module OrcaHeadless
  class MonotonicClock
    def monotonic
      Process.clock_gettime(Process::CLOCK_MONOTONIC)
    end

    def sleep(seconds)
      Kernel.sleep(seconds)
    end
  end

  class ChildProcess
    def spawn(argv, options)
      input = File.open(options.fetch("stdin"), "rb")
      output = private_output(options.fetch("stdout"))
      error = private_output(options.fetch("stderr"))
      Process.spawn(*argv, chdir: options.fetch("cwd"), in: input, out: output, err: error)
    ensure
      [input, output, error].compact.each(&:close)
    end

    def wait(pid)
      _finished, status = Process.wait2(pid)
      return status.exitstatus if status.exited?

      128 + status.termsig
    end

    private

    def private_output(path)
      flags = File::WRONLY | File::CREAT | File::EXCL
      File.open(path, flags, 0o600)
    end
  end

  class CleanupHold
    def call
      loop { Kernel.sleep(3600) }
    end
  end

  class Runner
    def initialize(state, timeout, process: ChildProcess.new, clock: MonotonicClock.new,
                   hold: CleanupHold.new)
      canonical = File.realpath(state)
      @context = RunnerContext.new(canonical, timeout, process, clock, hold,
                                   ReceiptStore.new(canonical))
    end

    def call
      RunnerWorkflow.call(@context)
    end
  end
end
