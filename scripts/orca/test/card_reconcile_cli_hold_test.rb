# frozen_string_literal: true

require_relative "card_reconcile_cli_fixture"

# Holds as the operator meets them through the CLI: refused at load, in force, released, and never
# released by a source that failed.
class CardReconcileCliHoldTest < Minitest::Test
  include CliFixture

  def test_a_free_text_hold_is_refused_and_names_the_condition
    with_root do |root|
      holds(root, [{ "card" => 1672, "until" => "land last" }])
      status, _stdout, stderr = invoke(root)
      assert_equal 1, status
      assert_match(/free-text release condition "land last"/, stderr)
      assert_match(/card 1672/, stderr)
    end
  end

  def test_an_unknown_predicate_is_refused_naming_it
    with_root do |root|
      holds(root, [{ "card" => 1672, "until" => { "wait_for_owner" => true } }])
      status, _stdout, stderr = invoke(root)
      assert_equal 1, status
      assert_match(/unsupported release condition "wait_for_owner"/, stderr)
    end
  end

  def test_a_held_card_records_the_predicate_verdict
    with_root do |root|
      holds(root, [{ "card" => 1672, "until" => { "pr_merged" => 1607 } }])
      _status, stdout, = invoke(root, ["--json"], pr_state: "OPEN")
      row = JSON.parse(stdout).first
      assert_equal "held", row["state"]
      assert_equal "\u2014", row["next_action"]
      assert_match(/hold: pr_merged 1607 -> OPEN \[unsatisfied\]/, row["facts"])
    end
  end

  def test_a_released_hold_is_reported_as_stale
    with_root do |root|
      holds(root, [{ "card" => 1672, "until" => { "pr_merged" => 1607 } }])
      _status, stdout, = invoke(root, ["--json"], pr_state: "MERGED")
      assert_equal ["stale-hold"], JSON.parse(stdout).map { |row| row["state"] }
    end
  end

  def test_a_degraded_gh_never_releases_a_hold
    with_root do |root|
      holds(root, [{ "card" => 1672, "until" => { "no_open_pr_touches" => "pnpm-lock.yaml" } }])
      status, stdout, = invoke(root, ["--json"], degraded: true)
      row = JSON.parse(stdout).first
      assert_equal 0, status
      assert_equal "held", row["state"]
      assert_match(/hold: unproven: open pull requests unavailable \[unsatisfied\]/, row["facts"])
    end
  end
end
