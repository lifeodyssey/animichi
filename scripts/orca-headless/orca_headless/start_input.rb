# frozen_string_literal: true

require "optparse"
require "pathname"
require "digest"

module OrcaHeadless
  StartInput = Struct.new(:workspace, :coordinator, :run_id, :title, :spec_file,
                          :provider, :model, :effort, :state_dir, :runtime_client,
                          :startup_timeout, :node, :orca, :agent, :spec_text,
                          :spec_sha256)

  module StartInputParser
    FLAGS = %i[workspace coordinator run title spec_file provider model effort state_dir runtime_client].freeze
    MODELS = [["codex", "gpt-5.6-sol", "max"], ["codex", "gpt-6-astra", "xhigh"],
              ["grok", "grok-4.6", "xhigh"]].freeze
    TERMINAL_PATTERN = /\Aterm_[a-z0-9]+(?:-[a-z0-9]+)*\z/.freeze
    module_function

    def parse(argv, resolver: ExecutableResolver.new)
      values = { startup_timeout: "120" }
      option_parser(values).parse!(argv)
      raise InputError, "unexpected arguments: #{argv.join(' ')}" unless argv.empty?

      build(values, resolver)
    rescue OptionParser::ParseError => error
      raise InputError, error.message
    end

    def option_parser(values)
      OptionParser.new do |parser|
        FLAGS.each { |name| add_flag(parser, values, name) }
        parser.on("--startup-timeout SECONDS") { |value| values[:startup_timeout] = value }
      end
    end

    def add_flag(parser, values, name)
      flag = name.to_s.tr("_", "-")
      parser.on("--#{flag} VALUE") { |value| values[name] = value }
    end

    def build(values, resolver)
      require_values(values)
      validate_text(values)
      paths = validate_paths(values)
      executables = validate_executables(values, resolver)
      StartInput.new(*ordered(values, paths, executables))
    end

    def require_values(values)
      missing = FLAGS.reject { |name| values[name] && !values[name].empty? }
      raise InputError, "missing options: #{missing.join(', ')}" unless missing.empty?
    end

    def validate_text(values)
      validate_identifier(values[:coordinator], TERMINAL_PATTERN, "coordinator")
      validate_identifier(values[:run], /\Arun_[a-z0-9]+\z/, "run")
      validate_title(values[:title])
      raise InputError, "unsupported provider/model/effort" unless MODELS.include?(model_tuple(values))
    end

    def validate_title(title)
      valid = title.dup.force_encoding(Encoding::UTF_8).valid_encoding?
      valid &&= !title.strip.empty? && title.bytesize <= 120
      valid &&= !title.match?(/[\u0000-\u001f\u007f]/)
      raise InputError, "invalid title" unless valid
    end

    def validate_identifier(value, pattern, label)
      raise InputError, "invalid #{label}" unless pattern.match?(value)
    end

    def model_tuple(values)
      [values[:provider], values[:model], values[:effort]]
    end

    def validate_paths(values)
      workspace = real_directory(values[:workspace], "workspace")
      spec = real_file(values[:spec_file], "spec file")
      runtime = real_file(values[:runtime_client], "runtime client")
      state = state_path(values[:state_dir], workspace)
      text = read_spec(spec)
      [workspace, spec, state, runtime, text, Digest::SHA256.hexdigest(text)]
    end

    def real_directory(path, label)
      raise InputError, "#{label} must be absolute" unless Pathname.new(path).absolute?
      raise InputError, "#{label} is not a directory" unless File.directory?(path)

      File.realpath(path)
    end

    def real_file(path, label)
      raise InputError, "#{label} must be absolute" unless Pathname.new(path).absolute?
      raise InputError, "#{label} is not a file" unless File.file?(path)

      File.realpath(path)
    end

    def read_spec(path)
      text = File.binread(path).force_encoding(Encoding::UTF_8)
      valid = text.valid_encoding? && !text.empty? && text.bytesize <= 1_048_576
      valid &&= !text.include?("\0")
      raise InputError, "spec file must contain 1-1048576 bytes of UTF-8 text" unless valid

      text
    end

    def state_path(path, workspace)
      raise InputError, "state directory must be absolute" unless Pathname.new(path).absolute?
      parent = File.realpath(File.dirname(path))
      candidate = File.join(parent, File.basename(path))
      raise InputError, "state directory must be outside workspace" if inside?(candidate, workspace)

      candidate
    end

    def inside?(path, directory)
      path == directory || path.start_with?(directory + File::SEPARATOR)
    end

    def validate_executables(values, resolver)
      agent = resolver.resolve(values[:provider])
      [resolver.resolve("node"), resolver.resolve("orca"), agent]
    end

    def ordered(values, paths, executables)
      workspace, spec, state, runtime, text, digest = paths
      node, orca, agent = executables
      timeout = startup_timeout(values[:startup_timeout])
      [workspace, values[:coordinator], values[:run], values[:title], spec,
       values[:provider], values[:model], values[:effort], state, runtime,
       timeout, node, orca, agent, text, digest]
    end

    def startup_timeout(value)
      timeout = Integer(value, 10)
      raise InputError, "startup timeout must be between 1 and 600" unless (1..600).cover?(timeout)

      timeout
    rescue ArgumentError
      raise InputError, "startup timeout must be an integer"
    end
  end
end
