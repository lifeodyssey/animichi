# frozen_string_literal: true

require_relative "test_helper"

class AtomicFileTest < Minitest::Test
  def test_target_appears_only_after_complete_pending_file
    Dir.mktmpdir { |directory| assert_atomic_publish(directory) }
  end

  private

  def assert_atomic_publish(directory)
    target = File.join(directory, "prompt.txt")
    mover = lambda do |pending, destination|
      refute File.exist?(destination)
      assert_equal "complete prompt", File.binread(pending)
      File.rename(pending, destination)
    end
    OrcaHeadless::AtomicFile.publish(target, "complete prompt", mover: mover)
    assert_equal "complete prompt", File.binread(target)
  end
end
