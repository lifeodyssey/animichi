# SUT: test/repo-config/refresh-hold-backs.rb — the hold-back register's documented refresh
# (#1736). `pnpm outdated -r --format json` is the registry view and the derivation keeps the
# pins whose DECLARED specifier does not admit the age-eligible latest. The round-1 review found
# the drift labels inverted and the follow-up issue at risk of being dropped by `--write`, so
# both directions of the report and the issue carry-over are pinned here (must-fixes 1 and 5).
require "minitest/autorun"
require_relative "dependency_hold_backs"
require_relative "refresh-hold-backs"

class RefreshHoldBacksTest < Minitest::Test
  include HoldBacks

  def entry(package, issue = nil)
    { "package" => package, "declared" => "1.0.0", "latest" => "1.1.0",
      "declaredIn" => WORKSPACE_MANIFEST, "issue" => issue }.compact
  end

  # The register is `before` and the derivation is `after`: a pin only the tree has is one to
  # add, an entry only the register has is one to drop. Round 1, must-fix 1: the swapped labels
  # told the reader the opposite.
  def test_the_drift_adds_a_pin_the_register_lacks_and_drops_a_stale_entry
    assert_equal ["add hono", "drop zod"], HoldBacks.drift_between([entry("zod", 1745)], [entry("hono")])
    assert_equal ["add zod", "drop hono"], HoldBacks.drift_between([entry("hono")], [entry("zod", 1745)])
  end

  def test_an_issue_the_registry_cannot_know_is_not_drift
    assert_empty HoldBacks.drift_between([entry("zod", 1745)], [entry("zod")])
  end

  # `--write` must not drop a hand-recorded follow-up card, and must not invent one for a pin it
  # has never seen. Round 1, must-fix 5.
  def test_write_carries_a_registered_issue_over_and_invents_none
    carried = HoldBacks.with_carried_issues([entry("zod"), entry("h3")], [entry("zod", 1745)])
    assert_equal 1745, carried.first.fetch("issue")
    refute carried.last.key?("issue"), "a new entry must not carry an invented issue"
  end
end
