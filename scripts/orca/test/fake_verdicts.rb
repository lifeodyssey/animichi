# frozen_string_literal: true

require_relative "../card_reconcile"

# Stands in for VerdictReader in snapshots built from fixtures. It stands in for the *store* only:
# the freshness policy is the real one, so a test can hand it a FakePatchIdentity.
class FakeVerdicts
  def initialize(verdicts, freshness: Orca::CardReconcile::VerdictFreshness.new)
    @verdicts = verdicts
    @freshness = freshness
  end

  def fresh(_lane, head, base)
    @freshness.pick(@verdicts, head, base)
  end
end
