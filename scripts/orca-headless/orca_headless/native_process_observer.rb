# frozen_string_literal: true

require "open3"
require "time"

module OrcaHeadless
  class NativeProcessObserver
    PS_FIELDS = %w[pid= ppid= pgid= tpgid= lstart= tty= command=].freeze
    def observe(pid)
      return unavailable("unsupported_platform") unless RUBY_PLATFORM.include?("darwin")
      stdout, _stderr, status = Open3.capture3({ "LC_ALL" => "C" }, *command(pid))
      return unavailable("process_not_observed") unless status.success?

      parse(stdout) || unavailable("malformed_process_observation")
    rescue SystemCallError, ArgumentError
      unavailable("process_inspection_failed")
    end

    private

    def command(pid)
      ["/bin/ps", "-ww", "-p", pid.to_s, *PS_FIELDS.flat_map { |field| ["-o", field] }]
    end

    def parse(output)
      fields = output.strip.split(/\s+/, 11)
      return nil unless fields.length == 11

      payload(fields)
    rescue ArgumentError
      nil
    end

    def payload(fields)
      { "verdict" => "live", "pid" => positive_integer(fields[0]),
        "ppid" => positive_integer(fields[1]), "processGroup" => positive_integer(fields[2]),
        "foregroundProcessGroup" => positive_integer(fields[3]), "startedAt" => start_time(fields),
        "tty" => fields[9], "command" => fields[10], "observedAt" => Time.now.utc.iso8601 }
    end

    def start_time(fields)
      Time.strptime(fields[4, 5].join(" "), "%a %b %e %H:%M:%S %Y").utc.iso8601
    end

    def positive_integer(value)
      number = Integer(value, 10)
      raise ArgumentError unless number.positive?

      number
    end

    def unavailable(reason)
      { "verdict" => "unverifiable", "reason" => reason,
        "observedAt" => Time.now.utc.iso8601 }
    end
  end
end
