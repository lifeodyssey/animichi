# frozen_string_literal: true

require_relative "test_helper"

class AtomicFileTest < Minitest::Test
  def test_target_appears_only_after_complete_pending_file
    Dir.mktmpdir { |directory| assert_atomic_publish(directory) }
  end

  def test_syncs_parent_after_pending_cleanup
    Dir.mktmpdir { |directory| assert_parent_sync(directory) }
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

  def assert_parent_sync(directory)
    target = File.join(directory, "prompt.txt")
    observed = []
    syncer = ->(parent) { observed << [parent, Dir.children(parent)] }
    OrcaHeadless::AtomicFile.publish(target, "complete prompt", syncer: syncer)
    assert_equal [[directory, ["prompt.txt"]]], observed
  end
end

class AtomicPublishBarrier
  def initialize
    @ready_reader, @ready_writer = IO.pipe
    @start_reader, @start_writer = IO.pipe
  end

  def child_ready
    @ready_writer.write("1")
    @start_reader.read(1)
  end

  def prepare_child
    @ready_reader.close
    @start_writer.close
  end

  def wait_for_child
    @ready_writer.close
    @start_reader.close
    @ready_reader.read(1)
  end

  def release_child
    @start_writer.write("1")
  end

  def close
    [@ready_reader, @ready_writer, @start_reader, @start_writer].each do |pipe|
      pipe.close unless pipe.closed?
    end
  end
end

class AtomicDefaultMoverRace
  attr_reader :target

  def initialize(directory)
    @target = File.join(directory, "receipt.json")
    @barrier = AtomicPublishBarrier.new
  end

  def run
    pid = fork { publish }
    publish_winner
    status = Process.wait2(pid).last
    [status.exitstatus, File.binread(@target), Dir.children(File.dirname(@target))]
  ensure
    @barrier.close
  end

  private

  def publish_winner
    @barrier.wait_for_child
    File.binwrite(@target, "winner", perm: 0o600)
    @barrier.release_child
  end

  def publish
    @barrier.prepare_child
    intercept_pending_write
    OrcaHeadless::AtomicFile.publish(@target, "loser")
    exit! 0
  rescue OrcaHeadless::InputError
    exit! 10
  end

  def intercept_pending_write
    writer = OrcaHeadless::AtomicFile.method(:write_private)
    barrier = @barrier
    OrcaHeadless::AtomicFile.define_singleton_method(:write_private) do |path, bytes|
      writer.call(path, bytes)
      barrier.child_ready
    end
  end
end

class AtomicFileConcurrencyTest < Minitest::Test
  def test_default_publication_cannot_overwrite_a_concurrent_winner
    Dir.mktmpdir { |directory| assert_no_overwrite(directory) }
  end

  private

  def assert_no_overwrite(directory)
    race = AtomicDefaultMoverRace.new(directory)
    code, winner, children = race.run
    assert_equal 10, code
    assert_equal "winner", winner
    assert_equal ["receipt.json"], children
    assert_equal 0o600, File.stat(race.target).mode & 0o777
  end
end
