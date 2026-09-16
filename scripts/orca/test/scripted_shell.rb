# frozen_string_literal: true

require_relative "../card_reconcile"

# A Command executor that returns canned results keyed by the longest matching argv prefix.
class ScriptedShell
  Result = Orca::CardReconcile::Command::Result

  attr_reader :calls

  def initialize(responses)
    @responses = responses
    @calls = []
  end

  def call(argv, _stdin = nil)
    @calls << argv
    key = argv.join(" ")
    match = @responses.keys.select { |candidate| key.start_with?(candidate) }
                            .max_by(&:length)
    raise "unstubbed command: #{key}" unless match

    response = @responses[match]
    return response if response.is_a?(Result)

    Result.new(response, "", 0)
  end
end
