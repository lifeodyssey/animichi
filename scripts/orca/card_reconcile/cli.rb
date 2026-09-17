# frozen_string_literal: true

require "optparse"

module Orca
  module CardReconcile
    class Options
      DEFAULTS = { repo_root: ".", lanes_root: "/private/tmp", repository: "lifeodyssey/animichi",
                   holds: File.join(Dir.home, ".orca", "card-holds.json") }.freeze

      attr_reader :config, :json

      def self.parse(argv, env = ENV)
        values = DEFAULTS.dup
        parser = build_parser(values)
        remaining = argv.dup
        parser.parse!(remaining)
        reject_remaining!(remaining)
        return [nil, parser] if values[:help]

        [new(values, env), parser]
      end

      def self.build_parser(values)
        OptionParser.new do |parser|
          parser.banner = "Usage: ruby scripts/orca/card-reconcile.rb [options]"
          source_options(parser, values)
          report_options(parser, values)
        end
      end

      def self.source_options(parser, values)
        parser.on("--repo-root PATH") { |value| values[:repo_root] = value }
        parser.on("--lanes PATH") { |value| values[:lanes_root] = value }
        parser.on("--repository OWNER/REPO") { |value| values[:repository] = value }
        parser.on("--holds PATH") { |value| values[:holds] = value }
        parser.on("--terminal HANDLE") { |value| values[:terminal] = value }
      end

      def self.report_options(parser, values)
        parser.on("--run RUN_ID") { |value| values[:run] = value }
        parser.on("--now ISO8601") { |value| values[:now] = value }
        parser.on("--json") { values[:json] = true }
        parser.on("-h", "--help") { values[:help] = true }
      end

      def self.reject_remaining!(remaining)
        return if remaining.empty?

        raise OptionParser::InvalidArgument, "unexpected arguments: #{remaining.join(' ')}"
      end

      def initialize(values, env)
        @config = Config.new(values[:repo_root], values[:lanes_root], values[:repository],
                             values[:terminal] || env["ORCA_TERMINAL_HANDLE"], values[:run],
                             values[:holds], clock(values[:now]))
        @json = values[:json] == true
      end

      private

      def clock(now)
        return -> { Time.now.utc } unless now

        fixed = Shape.time(now)
        raise OptionParser::InvalidArgument, "--now must be an ISO8601 timestamp" unless fixed

        -> { fixed }
      end
    end

    class CLI
      def self.run(argv, stdout: $stdout, stderr: $stderr, command: Command.new)
        new(argv, stdout, stderr, command).run
      end

      def initialize(argv, stdout, stderr, command)
        @argv = argv
        @stdout = stdout
        @stderr = stderr
        @command = command
      end

      def run
        options, parser = Options.parse(@argv)
        return help(parser) unless options

        render(options)
      rescue OptionParser::ParseError, Failure => error
        @stderr.puts("card-reconcile: #{error.message}")
        1
      end

      private

      def help(parser)
        @stdout.puts(parser)
        0
      end

      def render(options)
        now = options.config.clock.call
        snapshot = Collector.new(options.config, @command).snapshot
        warn(snapshot.notes)
        report = Report.new(Derivation.new(snapshot, now).rows, now)
        @stdout.write(options.json ? report.json : report.table)
        0
      end

      def warn(notes)
        notes.uniq.each { |note| @stderr.puts("card-reconcile: degraded: #{note}") }
      end
    end
  end
end
