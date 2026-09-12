# frozen_string_literal: true

require "optparse"
require "pathname"

module OrcaHeadless
  StateInput = Struct.new(:state_dir, :settlement_message)

  module StateInputParser
    module_function

    def parse(argv, settlement: false)
      values = {}
      parser(values, settlement).parse!(argv)
      raise InputError, "unexpected arguments: #{argv.join(' ')}" unless argv.empty?

      validate_settlement(values[:settlement_message]) if settlement
      StateInput.new(state_path(values[:state_dir]), values[:settlement_message])
    rescue OptionParser::ParseError => error
      raise InputError, error.message
    end

    def parser(values, settlement)
      OptionParser.new do |option|
        option.on("--state-dir PATH") { |value| values[:state_dir] = value }
        add_settlement(option, values) if settlement
      end
    end

    def add_settlement(option, values)
      option.on("--settlement-message ID") { |value| values[:settlement_message] = value }
    end

    def state_path(path)
      raise InputError, "missing option: state-dir" unless path
      raise InputError, "state directory must be absolute" unless Pathname.new(path).absolute?
      raise InputError, "state directory is not a directory" unless File.directory?(path)

      File.realpath(path)
    end

    def validate_settlement(value)
      raise InputError, "missing option: settlement-message" unless value
      raise InputError, "invalid settlement message" unless /\Amsg_[a-z0-9]+\z/.match?(value)
    end
  end
end
