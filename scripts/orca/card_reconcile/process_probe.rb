# frozen_string_literal: true

module Orca
  module CardReconcile
    class ProcessProbe
      def initialize(command, notes)
        @command = command
        @notes = notes
      end

      def call(state_dir)
        pattern = /(^|\s)--state #{Regexp.escape(state_dir)}(\s|\z)/
        table&.any? { |line| line.include?("runner.rb") && pattern.match?(line) }
      end

      private

      # `nil` when the process table cannot be read: an unknown table must not read as "no runner",
      # which would report a possibly live lane as undelivered.
      def table
        @table ||= @command.capture(["ps", "-eo", "command="], "ps").each_line.map(&:strip)
      rescue Failure => error
        @notes << error.message
        nil
      end
    end
  end
end
