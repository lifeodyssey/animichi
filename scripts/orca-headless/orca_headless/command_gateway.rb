# frozen_string_literal: true

require "json"
require "open3"

module OrcaHeadless
  class RealCommandRunner
    def run(argv)
      stdout, stderr, status = Open3.capture3(*argv)
      CommandResult.new(stdout, stderr, status.exitstatus)
    end
  end

  class CommandGateway
    def initialize(runner, store)
      @runner = runner
      @store = store
    end

    def call(stage, argv, receipt)
      result = @runner.run(argv)
      record(stage, receipt, result)
      body = parse(stage, result.stdout)
      validate(stage, result, body)
      body
    rescue SystemCallError => error
      raise StageFailure.new(stage, "command could not start: #{error.class}")
    end

    private

    def record(stage, receipt, result)
      @store.write(receipt, result.stdout)
      @store.write("#{stage}.stderr.log", result.stderr) unless result.stderr.empty?
      @store.write_json("#{stage}.command.json", "exitCode" => result.exit_code)
    end

    def parse(stage, stdout)
      JSON.parse(stdout)
    rescue JSON::ParserError
      raise StageFailure.new(stage, "command returned invalid JSON")
    end

    def validate(stage, result, body)
      return if result.exit_code.zero? && body["ok"] == true

      code = body.dig("error", "code") || "command_failed"
      raise StageFailure.new(stage, "#{stage} failed (#{code})")
    end
  end
end
