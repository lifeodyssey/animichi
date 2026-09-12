# frozen_string_literal: true

module OrcaHeadless
  class ExecutableResolver
    def initialize(path = ENV.fetch("PATH", ""))
      @path = path
    end

    def resolve(name)
      candidates = @path.split(File::PATH_SEPARATOR).map { |entry| File.join(entry, name) }
      match = candidates.find { |candidate| File.file?(candidate) && File.executable?(candidate) }
      raise InputError, "executable not found: #{name}" unless match

      File.realpath(match)
    end
  end
end
