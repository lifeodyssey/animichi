# frozen_string_literal: true
# The shared ground of the cases that start the release build runner's Wrangler and watch its
# processes: a directory of the case's own, a one-module Worker and the dry-run arguments that
# build it, the FIFOs a case holds, and a Node script run against the runner. A FIFO, not a clock,
# tells a case that a process of the build has got somewhere or has gone.
#
# Not a `*.test.rb`, so `workflow-invocations.test.rb` does not ask PR verification to invoke it;
# the cases `require_relative` it instead.
require 'minitest/autorun'
require 'json'
require 'open3'
require 'tmpdir'
require 'fileutils'

class WranglerBuildCase < Minitest::Test
  ROOT = ENV.fetch('TEST_REPOSITORY_ROOT', File.expand_path('../../../..', __dir__))
  LIBRARY = File.join(ROOT, '.github/lib/release/wrangler-build.mjs')
  RESPONDS = 'export default { fetch() { return new Response("ok"); } };'
  # How long a wait on a process of the build may last. Every wait ends on the event it waits for;
  # the bound only turns a run that never produces it into a failure instead of a hang.
  BOUND = 60

  def setup
    @dir = Dir.mktmpdir('release-wrangler-build-')
  end

  def teardown
    FileUtils.remove_entry(@dir)
  end

  # A one-module Worker whose entry is `source`, and the dry-run arguments that build it.
  def worker(source, **config)
    File.write(File.join(@dir, 'entry.js'), source)
    config = { name: 'bound-probe', main: 'entry.js', compatibility_date: '2026-01-01', **config }
    File.write(File.join(@dir, 'wrangler.json'), config.to_json)
    ['deploy', '--config', File.join(@dir, 'wrangler.json'), '--dry-run', '--outdir', File.join(@dir, 'out')]
  end

  def fifo(name)
    File.join(@dir, name).tap { |path| File.mkfifo(path) }
  end

  # This case's end of a FIFO it is the only writer of: a process that reads it sees EOF once the
  # case closes it or ends, so none of them outlives the case.
  def lifeline(path)
    reader = File.open(path, File::RDONLY | File::NONBLOCK)
    File.open(path, File::WRONLY | File::NONBLOCK).tap { reader.close }
  end

  # `script` run as an ES module, with `args` as JSON in its first argument.
  def node(script, args, *rest)
    Open3.capture3('node', '--input-type=module', '-e', script, args.to_json, *rest, chdir: ROOT)
  end
end
