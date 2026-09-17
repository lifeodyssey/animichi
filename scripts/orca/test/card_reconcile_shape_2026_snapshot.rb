# frozen_string_literal: true

require_relative "card_reconcile_shape_2026"
require_relative "card_reconcile_shape_2026_tree"
require_relative "card_reconcile_shape_2026_responses"
require_relative "card_reconcile_fixtures"
require_relative "scripted_shell"

# The snapshot and the rows the 2026-09-16 shape derives to. The temporary tree is removed when the
# block ends and the readers are lazy, so every read happens inside it.
module Shape2026Snapshot
  module_function

  def rows(heads = Shape2026::HEADS)
    with_snapshot(heads) { |snapshot| Orca::CardReconcile::Derivation.new(snapshot, ReconcileFixtures::NOW).rows }
  end

  def with_snapshot(heads = Shape2026::HEADS)
    Dir.mktmpdir do |root|
      Shape2026Tree.build(root)
      yield Orca::CardReconcile::Collector.new(config(root), command(root, heads)).snapshot
    end
  end

  # A missing row is a failure, not a nil to be compared against.
  def row_for(rows, card)
    rows.find { |row| row.card == card } || raise(Minitest::Assertion, "no row for card #{card}")
  end

  def config(root)
    Orca::CardReconcile::Config.new(root, root, "lifeodyssey/animichi", nil, nil,
                                    File.join(root, "holds.json"), -> { ReconcileFixtures::NOW })
  end

  def command(root, heads)
    Orca::CardReconcile::Command.new(ScriptedShell.new(Shape2026Responses.responses(root, heads)))
  end
end
