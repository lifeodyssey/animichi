# SUT: .github/lib/release/wrangler-build.mjs — a release build's Wrangler run is bounded, the
# bound names the stall it saw and stops every process the build started, it never relabels a
# build that failed on its own (#1859), and it asks the npm registry nothing.
# frozen_string_literal: true
require 'minitest/autorun'
require 'json'
require 'open3'
require 'socket'
require 'tmpdir'
require 'fileutils'

class ReleaseWranglerBuildTest < Minitest::Test
  ROOT = ENV.fetch('TEST_REPOSITORY_ROOT', File.expand_path('../../..', __dir__))
  LIBRARY = File.join(ROOT, '.github/lib/release/wrangler-build.mjs')
  FINISHED = '--dry-run: exiting now.'
  RESPONDS = 'export default { fetch() { return new Response("ok"); } };'
  # The repository's Wrangler, the one the library runs, here started without the library.
  WRANGLER = File.join(ROOT, 'node_modules/wrangler/bin/wrangler.js')
  REGISTRY_REQUEST = 'CONNECT registry.npmjs.org:443 HTTP/1.1'

  # A build whose one import is a FIFO stalls: esbuild blocks reading it. Opening the FIFO to write
  # returns once esbuild has opened it to read, so the mocked clock ticks past the bound while the
  # CLI and esbuild run, and no real time passes. Afterwards a non-blocking open to write fails with
  # ENXIO only if no process still holds the module open to read. `writer` keeps its handle from
  # being closed by the collector; a build that ends before it stalls leaves that open pending,
  # which `process.exit` drops. The outcome is the last line: the library writes Wrangler's own
  # output back first.
  STALLED_BUILD = <<~JS
    import { constants } from "node:fs";
    import { open } from "node:fs/promises";
    import { mock } from "node:test";
    import { WRANGLER_BUILD_TIMEOUT_MS, wranglerBuild } from #{LIBRARY.to_json};
    const [args, stalled] = [JSON.parse(process.argv[1]), process.argv[2]];
    mock.timers.enable({ apis: ["setTimeout"] });
    const build = (async () => wranglerBuild(args))().then(() => "built", (error) => error.message);
    const writer = open(stalled, "w");
    await Promise.race([writer, build]);
    mock.timers.tick(WRANGLER_BUILD_TIMEOUT_MS);
    const failure = await build;
    const probe = open(stalled, constants.O_WRONLY | constants.O_NONBLOCK);
    const reader = await probe.then((handle) => handle.close()).then(() => "open", (error) => error.code);
    console.log(JSON.stringify({ failure, reader }));
    process.exit();
  JS

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

  def build(args, timeout_ms, environment = {})
    script = "import {wranglerBuild} from #{LIBRARY.to_json}; " \
             'await wranglerBuild(JSON.parse(process.argv[1]), Number(process.argv[2]))'
    Open3.capture3(environment, 'node', '--input-type=module', '-e', script, args.to_json, timeout_ms.to_s, chdir: ROOT)
  end

  # `stdout` travels as JSON: a bare `--dry-run…` argument would be read as a node option.
  def diagnostic(stdout)
    script = "import {timeoutDiagnostic} from #{LIBRARY.to_json}; " \
             'console.log(timeoutDiagnostic(JSON.parse(process.argv[1]), 60000))'
    Open3.capture3('node', '--input-type=module', '-e', script, stdout.to_json).first.strip
  end

  # A loopback HTTP proxy, and the environment that sends Wrangler's requests through it. An HTTPS
  # request through a proxy opens with `CONNECT <host>:443`; the proxy records that line and refuses
  # the tunnel, so nothing leaves the machine. Wrangler reads the lowercase name first, so both
  # spellings are set, and neither spelling of NO_PROXY is left to exempt the registry. The temp
  # directory is the test's own: Wrangler skips the request while an answer it cached under
  # `os.tmpdir()` within the hour stands, whichever run on the machine cached it.
  def with_registry_proxy
    server = TCPServer.new('127.0.0.1', 0)
    requests = []
    recorder = Thread.new { loop { refuse(server.accept, requests) } }
    proxy = "http://127.0.0.1:#{server.addr[1]}"
    yield({ 'HTTPS_PROXY' => proxy, 'https_proxy' => proxy, 'NO_PROXY' => nil, 'no_proxy' => nil, 'TMPDIR' => @dir },
          requests)
  ensure
    recorder&.kill
    server&.close
  end

  def refuse(client, requests)
    requests << client.gets.to_s.chomp
    client.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
    client.close
  end

  def test_a_build_the_bound_stops_names_the_bound
    _output, error, status = build(worker(RESPONDS), 1)
    refute status.success?
    assert_includes error, 'Wrangler did not finish its dry-run build within 0.001 seconds'
  end

  def test_a_build_the_bound_stops_leaves_none_of_its_processes_running
    stalled = File.join(@dir, 'stalled.js')
    File.mkfifo(stalled)
    args = worker(%(import "./stalled.js";\n#{RESPONDS}))
    output, error, status = Open3.capture3('node', '--input-type=module', '-e', STALLED_BUILD, args.to_json, stalled,
                                           chdir: ROOT)
    assert status.success?, error
    outcome = JSON.parse(output.lines.last)
    assert_includes outcome['failure'], 'Wrangler did not finish its dry-run build within 60 seconds'
    assert_equal 'ENXIO', outcome['reader'], 'a process of the stopped build still reads its module'
  end

  def test_a_build_that_fails_on_its_own_keeps_its_own_error
    _output, error, status = build(worker('export default { fetch() { return new Response("open); } };'), 60_000)
    refute status.success?
    assert_includes error, 'entry.js'
    refute_includes error, 'dry-run build within'
  end

  def test_a_build_that_completes_writes_its_bundle
    _output, error, status = build(worker(RESPONDS), 60_000)
    assert status.success?, error
    assert File.size?(File.join(@dir, 'out', 'entry.js'))
  end

  def test_a_build_asks_the_npm_registry_nothing_when_its_caller_shows_the_banner
    with_registry_proxy do |proxied, requests|
      _output, error, status = build(worker(RESPONDS), 60_000, proxied.merge('WRANGLER_HIDE_BANNER' => 'false'))
      assert status.success?, error
      assert_empty requests
    end
  end

  # The proxy's own proof: Wrangler run without the library, its banner shown, asks the registry.
  def test_the_proxy_sees_the_registry_request_of_a_run_that_shows_the_banner
    with_registry_proxy do |proxied, requests|
      environment = proxied.merge('WRANGLER_HIDE_BANNER' => nil, 'WRANGLER_SEND_METRICS' => 'false')
      Open3.capture3(environment, 'node', WRANGLER, *worker(RESPONDS), chdir: ROOT)
      assert_includes requests, REGISTRY_REQUEST
    end
  end

  def test_a_stall_after_the_last_line_says_the_build_finished
    assert_equal "Wrangler finished its dry-run build and printed \"#{FINISHED}\", then did not exit within 60 seconds",
                 diagnostic("#{FINISHED}\n")
  end

  def test_a_stall_before_the_last_line_says_the_build_never_finished
    assert_equal 'Wrangler did not finish its dry-run build within 60 seconds', diagnostic("building\n")
  end
end
