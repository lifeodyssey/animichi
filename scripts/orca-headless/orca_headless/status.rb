# frozen_string_literal: true

module OrcaHeadless
  class Status
    def initialize(argv, runner)
      input = StateInputParser.parse(argv)
      reader = EvidenceReader.new(input.state_dir)
      store = ReceiptStore.new(input.state_dir)
      @context = StatusContext.new(input, reader, store, CommandGateway.new(runner, store))
    end

    def call
      StatusWorkflow.call(@context)
    rescue EvidenceError
      InspectionResult.new(StatusWorkflow.unknown_payload(@context), 1)
    end
  end
end
