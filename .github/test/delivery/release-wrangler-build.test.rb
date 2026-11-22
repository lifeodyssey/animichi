# SUT: .github/lib/release/wrangler-build.mjs — a release build's Wrangler run is bounded, the
# bound names the stall it saw, and it never relabels a build that failed on its own (#1859).
# frozen_string_literal: true
require 'minitest/autorun'
require 'json'
require 'open3'
require 'tmpdir'
require 'fileutils'

class ReleaseWranglerBuildTest < Minitest::Test
  ROOT = ENV.fetch('TEST_REPOSITORY_ROOT', File.expand_path('../../..', __dir__))
  LIBRARY = File.join(ROOT, '.github/lib/release/wrangler-build.mjs')
  FINISHED = '--dry-run: exiting now.'

  def setup
    @dir = Dir.mktmpdir('release-wrangler-build-')
  end

  def teardown
    FileUtils.remove_entry(@dir)
  end

  # A one-module Worker whose entry is `source`, and the dry-run arguments that build it.
  def worker(source)
    File.write(File.join(@dir, 'entry.js'), source)
    config = { name: 'bound-probe', main: 'entry.js', compatibility_date: '2026-01-01' }
    File.write(File.join(@dir, 'wrangler.json'), config.to_json)
    ['deploy', '--config', File.join(@dir, 'wrangler.json'), '--dry-run', '--outdir', File.join(@dir, 'out')]
  end

  def build(args, timeout_ms)
    script = "import {wranglerBuild} from #{LIBRARY.to_json}; " \
             'wranglerBuild(JSON.parse(process.argv[1]), Number(process.argv[2]))'
    Open3.capture3('node', '--input-type=module', '-e', script, args.to_json, timeout_ms.to_s, chdir: ROOT)
  end

  # `stdout` travels as JSON: a bare `--dry-run…` argument would be read as a node option.
  def diagnostic(stdout)
    script = "import {timeoutDiagnostic} from #{LIBRARY.to_json}; " \
             'console.log(timeoutDiagnostic(JSON.parse(process.argv[1]), 60000))'
    Open3.capture3('node', '--input-type=module', '-e', script, stdout.to_json).first.strip
  end

  def test_a_build_the_bound_stops_names_the_bound
    _output, error, status = build(worker('export default { fetch() { return new Response("ok"); } };'), 1)
    refute status.success?
    assert_includes error, 'Wrangler did not finish its dry-run build within 0.001 seconds'
  end

  def test_a_build_that_fails_on_its_own_keeps_its_own_error
    _output, error, status = build(worker('export default { fetch() { return new Response("open); } };'), 60_000)
    refute status.success?
    assert_includes error, 'entry.js'
    refute_includes error, 'dry-run build within'
  end

  def test_a_build_that_completes_writes_its_bundle
    _output, error, status = build(worker('export default { fetch() { return new Response("ok"); } };'), 60_000)
    assert status.success?, error
    assert File.size?(File.join(@dir, 'out', 'entry.js'))
  end

  def test_a_stall_after_the_last_line_says_the_build_finished
    assert_equal "Wrangler finished its dry-run build and printed \"#{FINISHED}\", then did not exit within 60 seconds",
                 diagnostic("#{FINISHED}\n")
  end

  def test_a_stall_before_the_last_line_says_the_build_never_finished
    assert_equal 'Wrangler did not finish its dry-run build within 60 seconds', diagnostic("building\n")
  end
end
