# frozen_string_literal: true

require_relative "card_reconcile_fixtures"

class HoldStoreTest < Minitest::Test
  include ReconcileFixtures

  def test_loads_the_pr_merged_predicate
    holds = load_holds("holds" => [{ "card" => 1625, "since" => "2026-09-16T10:00:00Z",
                                     "until" => { "pr_merged" => 1607 } }])
    hold = holds[1625]
    assert_equal "pr_merged", hold.predicate
    assert_equal 1607, hold.target
    assert_equal Time.utc(2026, 9, 16, 10), hold.since
  end

  def test_loads_a_bare_list_with_the_file_mtime_as_since
    holds = load_holds([{ "card" => 1672, "until" => { "no_open_pr_touches" => "pnpm-lock.yaml" } }])
    assert_equal "no_open_pr_touches", holds[1672].predicate
    assert_equal File.mtime(@path), holds[1672].since
  end

  def test_refuses_a_free_text_hold
    error = assert_raises(Orca::CardReconcile::Failure) do
      load_holds([{ "card" => 1672, "until" => "land last" }])
    end
    assert_match(/free-text release condition "land last"/, error.message)
    assert_match(/card 1672/, error.message)
  end

  def test_refuses_a_hold_without_a_release_condition
    error = assert_raises(Orca::CardReconcile::Failure) { load_holds([{ "card" => 1672 }]) }
    assert_match(/free-text release condition nil/, error.message)
  end

  def test_refuses_an_unknown_predicate_and_names_it
    error = assert_raises(Orca::CardReconcile::Failure) do
      load_holds([{ "card" => 1625, "until" => { "wait_for_owner" => true } }])
    end
    assert_match(/unsupported release condition "wait_for_owner"/, error.message)
    assert_match(/pr_merged, no_open_pr_touches/, error.message)
  end

  # One hold carries exactly one condition: `until_.first` would silently drop every predicate
  # after the first, the same failure mode as a free-text hold.
  def test_refuses_an_until_with_more_than_one_predicate
    error = assert_raises(Orca::CardReconcile::Failure) do
      load_holds([{ "card" => 1625,
                    "until" => { "pr_merged" => 1607, "no_open_pr_touches" => "pnpm-lock.yaml" } }])
    end
    assert_match(/exactly one release condition/, error.message)
    assert_match(/card 1625/, error.message)
    assert_match(/"pr_merged"/, error.message)
    assert_match(/"no_open_pr_touches"/, error.message)
  end

  def test_refuses_a_predicate_with_an_unusable_target
    error = assert_raises(Orca::CardReconcile::Failure) do
      load_holds([{ "card" => 1625, "until" => { "pr_merged" => "one-six-oh-seven" } }])
    end
    assert_match(/needs a pull request number/, error.message)
  end

  def test_no_holds_file_means_no_holds
    assert_empty Orca::CardReconcile::HoldStore.new("/nonexistent/holds.json").load
  end

  private

  def load_holds(document)
    @path = File.join(Dir.mktmpdir, "card-holds.json")
    write_json(@path, document)
    Orca::CardReconcile::HoldStore.new(@path).load
  end
end

class HoldEvaluatorTest < Minitest::Test
  include ReconcileFixtures

  def test_pr_merged_is_true_once_the_pull_request_is_merged
    hold = evaluate(hold(1625, predicate: "pr_merged", target: 1607), "MERGED")
    assert_equal true, hold.satisfied
    assert_equal "pr_merged 1607 -> MERGED", hold.detail
  end

  def test_pr_merged_stays_false_while_the_pull_request_is_open
    hold = evaluate(hold(1625, predicate: "pr_merged", target: 1607), "OPEN")
    assert_equal false, hold.satisfied
  end

  def test_no_open_pr_touches_is_true_when_nothing_open_touches_the_path
    hold = evaluate(hold(1672, predicate: "no_open_pr_touches", target: "pnpm-lock.yaml"), nil,
                    [pull(1711, head_ref: "lifeodyssey/orca-1601-ac5", files: ["a.ts"])])
    assert_equal true, hold.satisfied
  end

  def test_no_open_pr_touches_is_false_when_an_open_pull_request_touches_the_path
    hold = evaluate(hold(1672, predicate: "no_open_pr_touches", target: "pnpm-lock.yaml"), nil,
                    [pull(1713, head_ref: "lifeodyssey/orca-1695-lane",
                          files: ["pnpm-lock.yaml"])])
    assert_equal false, hold.satisfied
    assert_equal "#1713 touches pnpm-lock.yaml", hold.detail
  end

  def test_no_open_pr_touches_is_unproven_when_a_file_list_is_truncated
    truncated = pull(1713, head_ref: "lifeodyssey/orca-1695-lane", files: ["a"] * 100)
    truncated.files_truncated = true
    assert_equal false, evaluate(hold(1672, predicate: "no_open_pr_touches", target: "x"), nil,
                                 [truncated]).satisfied
  end

  def test_no_open_pr_touches_is_unproven_when_the_open_list_is_unknown
    hold = evaluate(hold(1672, predicate: "no_open_pr_touches", target: "pnpm-lock.yaml"), nil, nil)
    assert_equal false, hold.satisfied
    assert_equal "unproven: open pull requests unavailable", hold.detail
  end

  private

  def evaluate(hold, state, open = [])
    evaluator = Orca::CardReconcile::HoldEvaluator.new(open, ->(_number) { state })
    evaluator.evaluate(hold)
  end
end
