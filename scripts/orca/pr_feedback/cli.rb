# frozen_string_literal: true

require "optparse"
require "tempfile"

module Orca
  module PrFeedback
    class Options
      attr_reader :repository, :number, :output

      def self.parse(argv)
        values = {}
        parser = build_parser(values)
        remaining = argv.dup
        parser.parse!(remaining)
        reject_remaining!(remaining)
        return [nil, parser] if values[:help]

        [new(required(values, :repo), required(values, :pr), values[:output]), parser]
      end

      def self.build_parser(values)
        OptionParser.new do |parser|
          parser.banner = "Usage: ruby scripts/orca/pr-feedback.rb --repo OWNER/REPO --pr NUMBER [--output PATH]"
          parser.on("--repo OWNER/REPO") { |value| values[:repo] = value }
          parser.on("--pr NUMBER") { |value| values[:pr] = value }
          parser.on("--output PATH") { |value| values[:output] = value }
          parser.on("-h", "--help") { values[:help] = true }
        end
      end

      def self.required(values, key)
        return values[key] if values.key?(key)

        raise OptionParser::MissingArgument, "--#{key}"
      end

      def self.reject_remaining!(remaining)
        return if remaining.empty?

        raise OptionParser::InvalidArgument, "unexpected arguments: #{remaining.join(' ')}"
      end

      def initialize(repository, number, output)
        @repository = Repository.parse(repository)
        @number = PullRequestNumber.parse(number)
        @output = output
      end
    end

    class Output
      def initialize(path, stdout)
        @path = path
        @stdout = stdout
      end

      def write(content)
        return @stdout.write(content) unless @path

        atomic_write(content)
      rescue SystemCallError => error
        raise Failure, "could not write #{@path}: #{error.message}"
      end

      private

      def atomic_write(content)
        target = File.expand_path(@path)
        directory = File.dirname(target)
        basename = File.basename(target)
        Tempfile.open([".#{basename}", ".tmp"], directory) do |file|
          write_temp(file, content)
          File.rename(file.path, target)
        end
      end

      def write_temp(file, content)
        file.write(content)
        file.flush
        file.fsync
        file.close
      end
    end

    class CLI
      def self.run(argv, transport: GhTransport.new, stdout: $stdout, stderr: $stderr,
                   clock: -> { Time.now })
        new(argv, transport, stdout, stderr, clock).run
      end

      def initialize(argv, transport, stdout, stderr, clock)
        @argv = argv
        @transport = transport
        @stdout = stdout
        @stderr = stderr
        @clock = clock
      end

      def run
        options, parser = Options.parse(@argv)
        return show_help(parser) unless options

        inventory = capture(options)
        Output.new(options.output, @stdout).write(JSON.pretty_generate(inventory) + "\n")
        0
      rescue OptionParser::ParseError, Failure => error
        @stderr.puts("pr-feedback: #{error.message}")
        1
      end

      private

      def capture(options)
        Orca::PrFeedback.capture(repository: options.repository.full_name, pr: options.number,
                                 transport: @transport, clock: @clock)
      end

      def show_help(parser)
        @stdout.puts(parser)
        0
      end
    end
  end
end
