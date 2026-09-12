# frozen_string_literal: true

module OrcaHeadless
  class Cleanup
    def initialize(argv, runner, process_observer)
      input = StateInputParser.parse(argv, settlement: true)
      reader = EvidenceReader.new(input.state_dir)
      store = ReceiptStore.new(input.state_dir)
      launch = reader.required("launch.json")
      gateway = CommandGateway.new(runner, store)
      @context = CleanupContext.new(input, reader, store, gateway, process_observer, launch)
    end

    def call
      CleanupWorkflow.call(@context)
    rescue EvidenceError, StageFailure => error
      message = "#{error.message}; evidence: #{@context.input.state_dir}"
      raise EvidenceError, message
    end
  end
end
