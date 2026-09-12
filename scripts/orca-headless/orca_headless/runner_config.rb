# frozen_string_literal: true

require "json"

module OrcaHeadless
  RunnerConfig = Struct.new(:cwd, :argv, :stdin, :stdout, :stderr)

  module RunnerConfigLoader
    module_function

    def load(state)
      path = File.join(state, "runner-config.json")
      values = JSON.parse(File.binread(path))
      config = RunnerConfig.new(*values.values_at("cwd", "argv", "stdin", "stdout", "stderr"))
      validate(config, state)
      config
    rescue JSON::ParserError, Errno::ENOENT
      raise InputError, "runner configuration is missing or invalid"
    end

    def validate(config, state)
      raise InputError, "runner cwd is invalid" unless File.directory?(config.cwd)
      raise InputError, "runner argv is invalid" unless valid_argv?(config.argv)
      paths = [config.stdin, config.stdout, config.stderr]
      raise InputError, "runner file paths are invalid" unless paths.all? { |path| owned_path?(path, state) }
    end

    def valid_argv?(argv)
      argv.is_a?(Array) && !argv.empty? && argv.all? do |value|
        value.is_a?(String) && !value.empty? && !value.include?("\0")
      end
    end

    def owned_path?(path, state)
      path.is_a?(String) && File.realpath(File.dirname(path)) == state
    rescue Errno::ENOENT
      false
    end
  end
end
