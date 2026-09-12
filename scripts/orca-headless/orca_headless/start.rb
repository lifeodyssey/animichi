# frozen_string_literal: true

module OrcaHeadless
  class Start
    def initialize(argv, runner, resolver)
      @argv = argv
      @runner = runner
      @resolver = resolver
    end

    def call
      @context = build_context
      StartWorkflow.call(@context)
    rescue StageFailure => error
      fail_with_evidence(error)
    end

    private

    def build_context
      input = StartInputParser.parse(@argv, resolver: @resolver)
      store = ReceiptStore.create(input.state_dir)
      StartContext.new(input, store, CommandGateway.new(@runner, store))
    end

    def fail_with_evidence(error)
      @context&.store&.failure(error.stage, error)
      evidence = @context ? "; evidence: #{@context.store.path}" : ""
      raise StageFailure.new(error.stage, "#{error.message}#{evidence}")
    end
  end
end
