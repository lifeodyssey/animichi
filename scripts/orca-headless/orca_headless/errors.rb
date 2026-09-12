# frozen_string_literal: true

module OrcaHeadless
  class InputError < StandardError; end
  class EvidenceError < StandardError; end

  class StageFailure < StandardError
    attr_reader :stage

    def initialize(stage, message)
      @stage = stage
      super(message)
    end
  end
end
