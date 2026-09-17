# frozen_string_literal: true

require "json"

module Orca
  module CardReconcile
    # Settlement is the Run's task status: Orca marks a task `completed` or `failed`, and both are
    # delivered outcomes — the worker stopped and reported. A `failed` task is carried separately so
    # the lane can ask for a fix instead of a re-dispatch. `worker_done` messages are corroboration
    # only: a Run-scoped mailbox read can be fenced at any moment and the recipient inbox is capped,
    # so neither one can settle or unsettle a card.
    class Settlement
      TERMINAL = %w[completed failed].freeze
      FAILED = "failed".freeze
      CORROBORATION = 5

      attr_reader :failed

      def initialize(command, run, notes)
        @command = command
        @run = run
        @notes = notes
        @failed = {}
      end

      def settled(messages)
        outcomes = terminal_tasks
        corroborate(outcomes, messages)
        outcomes
      end

      private

      def terminal_tasks
        return {} unless @run

        tasks.each_with_object({}) { |task, result| remember(task, result) }
      rescue Failure => error
        @notes << "settlement: #{error.message}"
        {}
      end

      def remember(task, result)
        status = task["status"]
        return unless TERMINAL.include?(status) && task["id"].is_a?(String)

        at = Shape.time(task["completed_at"])
        result[task["id"]] = at
        @failed[task["id"]] = at if status == FAILED
      end

      def tasks
        document = Shape.hash!(JSON.parse(@command.capture(argv, "orca task-list")), "orca task-list")
        result = Shape.hash!(document["result"], "orca task-list result")
        Array(result["tasks"]).map { |task| Shape.hash!(task, "orca task") }
      rescue JSON::ParserError => error
        raise Failure, "orca task-list returned malformed JSON: #{error.message}"
      end

      def argv
        ["orca", "orchestration", "task-list", "--run", @run, "--json"]
      end

      def corroborate(outcomes, messages)
        pending = messages.keys.reject { |task_id| outcomes.key?(task_id) }
        return if pending.empty?

        @notes << "settlement: #{pending.length} worker_done tasks are not completed: " \
                  "#{pending.first(CORROBORATION).join(', ')}"
      end
    end
  end
end
