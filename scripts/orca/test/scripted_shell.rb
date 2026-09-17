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
    matched = matching_key(key)
    raise "unstubbed command: #{key}" unless matched

    response = @responses[matched]
    response.is_a?(Result) ? response : Result.new(response, "", 0)
  end

  private

  # The longest registered key the command extends at an argument boundary: a final argument that
  # merely extends a key's last token is a different command, never a reuse of that key's response.
  def matching_key(key)
    @responses.keys.select { |candidate| key == candidate || key.start_with?("#{candidate} ") }
         .max_by(&:length)
  end
end
