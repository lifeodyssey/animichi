# frozen_string_literal: true

require "json"

module OrcaHeadless
  class EvidenceReader
    def initialize(state)
      @state = state
    end

    def required(name)
      value = optional(name)
      raise EvidenceError, "missing evidence: #{name}" unless value

      value
    end

    def optional(name)
      path = File.join(@state, name)
      return nil unless File.file?(path)

      JSON.parse(File.binread(path))
    rescue JSON::ParserError
      raise EvidenceError, "invalid evidence: #{name}"
    end
  end
end
