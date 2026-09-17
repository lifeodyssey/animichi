# frozen_string_literal: true

require "json"

module Orca
  module CardReconcile
    # Worker settlement evidence. The coordinator polls the same terminal handle, so the Run-scoped
    # read can be fenced at any moment; the recipient-wide inbox is the read-only fallback.
    # The reads a mailbox makes: the Run-scoped check first (which can be fenced at any moment), then
    # the recipient-wide inbox, which is capped and therefore may be incomplete.
    class MailboxSources
      INBOX_LIMIT = 1000

      def initialize(terminal, run, limit = INBOX_LIMIT)
        @terminal = terminal
        @run = run
        @limit = limit
      end

      def argvs
        [check_argv, inbox_argv].compact
      end

      # A full inbox page is evidence that may be capped.
      def capped?(argv, count)
        argv.include?("--limit") && count >= @limit
      end

      private

      def check_argv
        return nil unless @terminal && @run

        ["orca", "orchestration", "check", "--terminal", @terminal, "--run", @run,
         "--all", "--json"]
      end

      def inbox_argv
        ["orca", "orchestration", "inbox", "--limit", @limit.to_s, "--json"]
      end
    end

    class Mailbox
      attr_reader :failures

      def initialize(command, terminal, run, limit: MailboxSources::INBOX_LIMIT)
        @command = command
        @sources = MailboxSources.new(terminal, run, limit)
        @failures = []
        @read = 0
      end

      def settled
        merged = @sources.argvs.each_with_object({}) { |argv, result| read(argv, result) }
        raise Failure, failures.join("; ") if @read.zero?

        merged
      end

      private

      def read(argv, result)
        messages(argv).each { |message| remember(message, result) }
        @read += 1
        result
      rescue Failure => error
        failures << error.message
        result
      end

      def messages(argv)
        list = Shape.hash!(JSON.parse(@command.capture(argv, "orca mailbox")), "orca mailbox")
        list = Shape.hash!(list["result"], "orca mailbox result")["messages"]
        rows = Array(list).select { |message| message.is_a?(Hash) }
        note_cap(argv, rows.length)
        rows
      rescue JSON::ParserError => error
        raise Failure, "orca mailbox returned malformed JSON: #{error.message}"
      end

      def note_cap(argv, length)
        return unless @sources.capped?(argv, length)

        failures << "settlement evidence may be capped: inbox returned #{length} messages"
      end

      def remember(message, result)
        return unless message["type"] == "worker_done"

        task_id = WorkerDonePayload.new(message).task_id
        result[task_id] = Shape.time(message["created_at"]) if task_id.is_a?(String)
      end
    end

    # The payload of a `worker_done` message: an object, or a string that a fenced write may have left
    # with invalid escapes, so the task id is recovered by pattern when the JSON will not parse.
    class WorkerDonePayload
      TASK_ID = /"taskId"\s*:\s*"([^"]+)"/.freeze

      def initialize(message)
        @message = message
      end

      def task_id
        payload["taskId"]
      end

      private

      def payload
        raw = @message["payload"]
        return raw if raw.is_a?(Hash)

        parse(raw.to_s)
      end

      def parse(raw)
        parsed = JSON.parse(raw)
        parsed.is_a?(Hash) ? parsed : {}
      rescue JSON::ParserError
        match = TASK_ID.match(raw)
        match ? { "taskId" => match[1] } : {}
      end
    end
  end
end
