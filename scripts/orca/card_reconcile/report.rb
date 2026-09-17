# frozen_string_literal: true

require "json"
require "time"

module Orca
  module CardReconcile
    module Duration
      MINUTE = 60
      HOUR = 3600
      DAY = 86_400

      module_function

      def format(seconds)
        return "\u2014" if seconds.nil?

        text(seconds.to_i)
      end

      def text(seconds)
        return "#{seconds}s" if seconds < MINUTE
        return "#{seconds / MINUTE}m" if seconds < HOUR
        return "#{seconds / HOUR}h#{(seconds % HOUR) / MINUTE}m" if seconds < DAY

        "#{seconds / DAY}d#{(seconds % DAY) / HOUR}h"
      end
    end

    class Report
      HEADERS = %w[card facts state next-action stuck].freeze

      def initialize(rows, now)
        @rows = rows
        @now = now
      end

      def sorted
        @rows.sort_by { |row| [row.stuck_since ? 0 : 1, -row.stuck_seconds(@now).to_i, row.card] }
      end

      def table
        header = line(HEADERS, widths)
        ([header, "-" * header.length] + records.map { |row| line(row, widths) }).join("\n") + "\n"
      end

      def json
        JSON.pretty_generate(sorted.map { |row| document(row) }) + "\n"
      end

      private

      def document(row)
        { "card" => row.card, "facts" => row.facts, "state" => row.state,
          "next_action" => row.next_action, "stuck_since" => row.stuck_since && row.stuck_since.utc.iso8601,
          "stuck_for" => Duration.format(row.stuck_seconds(@now)) }
      end

      def records
        sorted.map { |row| record(row) }
      end

      def record(row)
        [row.card.to_s, row.facts.to_s, row.state.to_s, row.next_action.to_s,
         Duration.format(row.stuck_seconds(@now))]
      end

      def widths
        @widths ||= HEADERS.each_index.map do |index|
          ([HEADERS] + records).map { |row| row[index].to_s.length }.max
        end
      end

      def line(row, sizes)
        row.each_with_index.map { |cell, index| cell.to_s.ljust(sizes[index]) }.join(" | ").rstrip
      end
    end
  end
end
