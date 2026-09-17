# frozen_string_literal: true

# Stands in for PatchIdentity where a test needs the patch rule without a git repository. It records
# every question it was asked — the verdict commit, the candidate head and the base — so a test can
# pin both the base a card's verdicts are compared against and the order of the two commits.
class FakePatchIdentity
  attr_reader :calls

  def initialize(identical: false)
    @identical = identical
    @calls = []
  end

  def fresh?(sha, head, base)
    @calls << [sha, head, base]
    !sha.nil? && !head.nil? && @identical
  end

  # The bases alone, for the tests that only care which branch a stacked card was compared against.
  def bases
    @calls.map { |_, _, base| base }
  end
end
