# frozen_string_literal: true

require_relative "card_reconcile_fixtures"

# A lane directory holding verdict files: `animichi-lane-<card>/<name>.md`, plus the Lane a reader
# derives from it. The temporary tree is removed when the block ends and the readers are lazy, so
# every read happens inside the block.
module LaneFixture
  module_function

  def with_verdicts(card, files, identity: nil)
    Dir.mktmpdir do |root|
      dir = File.join(root, "animichi-lane-#{card}")
      FileUtils.mkdir_p(dir)
      files.each { |name, body| File.write(File.join(dir, name), body) }
      yield Orca::CardReconcile::VerdictReader.new(root, identity), lane(card, dir)
    end
  end

  def lane(card, dir)
    Orca::CardReconcile::Lane.new(card, [dir], [])
  end
end
