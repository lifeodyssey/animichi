# SUT: every live document that parks work on a card. A runbook that says "do not delete yet —
# that is #1081" sends an operator to wait for something nobody will do once #1081 closes, and a
# grep for the parked *thing* cannot find the sentence, because the sentence names the card (#1873).
# A card's state is not knowable offline, so `fixtures/deferred-card-states.json` is the
# repository's committed claim about it and this contract is the offline half that reads it.
require "minitest/autorun"
require "json"
require "open3"

class OpenCardDeferralsTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  REGISTER = "test/repo-config/fixtures/deferred-card-states.json".freeze
  # A deferral binds an undone action to a card, and each pattern captures the card ITS OWN words
  # name — so "Was Live … until #1078: … deleting them is #1081" contributes #1081 alone and the
  # past record beside it stays out. Five shapes, each read off a sentence this repository had
  # written; English outside them is the recall gap the card's report states.
  DEFERRALS = [
    /\b(?:is|are)\s+(?:issue\s+)?#(\d{3,4})\b/,                                     # "deleting them is #1081"
    /\btrack(?:ed|s|ing)?\b[^.#]{0,30}?\b(?:as|in|by|under)\s+(?:\[[^\]]*?)?(?:issue\s+)?#(\d{3,4})\b/i,
    /\bdeferred?\s+to\s+(?:\[[^\]]*?)?(?:issue\s+)?#(\d{3,4})\b/i,                  # "deferred to #1619"
    /\b(?:until|once|after)\s+(?:issue\s+)?#(\d{3,4})\s+(?:lands?|merges?|closes?|ships?)\b/i,
    /\b(?:until|once|after)\s+(?:it|they|this\s+card|that\s+card)\s+(?:lands?|merges?|closes?|ships?)\b[^#]{0,20}#(\d{3,4})\b/i,
  ].freeze
  # Records of their day, not live surfaces — the path families the neighbouring contracts exempt:
  HISTORY = [%r{\Adocs/archive/}, %r{\Adocs/specs/\d{4}-\d{2}-\d{2}-},
             %r{\Adocs/iterations/}, %r{\Adocs/adr/}, %r{\Adocs/naming-audit-}].freeze

  Deferral = Struct.new(:path, :line, :card, :text) do
    def to_s
      "#{path}:#{line}: #{text}"
    end
  end

  def test_no_live_document_parks_work_on_a_closed_card
    parked = deferrals.select { |deferral| closed.key?(deferral.card) }
    assert_empty(parked.map { |deferral| "#{deferral} → #{closed.fetch(deferral.card)}" },
                 "these live documents park work on a card that is already closed, so the reader " \
                 "waits for something nobody will do. Re-point the sentence at the card that owns " \
                 "the work now, or say what happened instead:\n  ")
  end

  def test_every_card_a_live_document_defers_to_is_registered
    unregistered = deferrals.reject { |deferral| states.key?(deferral.card) }
    assert_empty(unregistered.map(&:to_s),
                 "these live documents park work on a card whose state #{REGISTER} does not " \
                 "record, so nothing can tell whether the card is still open. Add the number and " \
                 "run that file's `command`:\n  ")
  end

  def test_the_register_records_no_card_every_document_has_stopped_deferring_to
    assert_empty((states.keys - deferrals.map(&:card)).sort,
                 "#{REGISTER} records these cards, but no live document parks work on one any " \
                 "more. Delete the entry — a register that outlives its sentence is the rot this " \
                 "contract exists to catch:\n  ")
  end

  private

  def deferrals
    @deferrals ||= live_documents.flat_map { |path| deferrals_in(path) }
  end

  def deferrals_in(path)
    File.read(File.join(ROOT, path)).each_line.with_index(1).flat_map do |line, number|
      cards_named_by(line).map { |card| Deferral.new(path, number, card, line.strip) }
    end
  end

  def cards_named_by(line)
    DEFERRALS.flat_map { |pattern| line.scan(pattern) }.flatten.map(&:to_i).uniq
  end

  def live_documents
    documents.reject { |path| HISTORY.any? { |family| path.match?(family) } }
  end

  def documents
    out, err, status = Open3.capture3("git", "ls-files", "-z", "--cached", "--others",
                                      "--exclude-standard", "docs", chdir: ROOT)
    assert_predicate(status, :success?, "git ls-files failed: #{err}")
    out.split("\0").select { |path| path.end_with?(".md") }
  end

  def states
    @states ||= JSON.parse(File.read(File.join(ROOT, REGISTER))).fetch("cards")
                    .each_with_object({}) { |card, by_number| by_number[card.fetch("number")] = card }
  end

  def closed
    @closed ||= states.each_with_object({}) do |(number, card), summary|
      next unless card.fetch("state") == "CLOSED"

      summary[number] = "##{number} closed #{card['closedAt']} (#{card['stateReason']})"
    end
  end
end
