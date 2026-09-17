# frozen_string_literal: true

require "open3"

module Orca
  module CardReconcile
    class Command
      Result = Struct.new(:stdout, :stderr, :status)

      def initialize(executor = nil)
        @executor = executor || method(:system_call)
      end

      def capture(argv, label, stdin = nil)
        result = @executor.call(argv, stdin)
        unless result.status.zero?
          raise Failure.new("#{label} failed: #{detail(result)}", result.status)
        end

        result.stdout
      rescue SystemCallError => error
        raise Failure, "#{label} failed: #{error.message}"
      end

      def system_call(argv, stdin)
        stdout, stderr, status = Open3.capture3(*argv, stdin_data: stdin.to_s)
        Result.new(stdout, stderr, status.exitstatus)
      end

      private

      def detail(result)
        message = result.stderr.to_s.strip
        message = result.stdout.to_s.strip[0, 200] if message.empty?
        message = "exit #{result.status}" if message.nil? || message.empty?
        message
      end
    end
  end
end
