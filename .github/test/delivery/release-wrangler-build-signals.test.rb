# SUT: .github/lib/release/wrangler-build.mjs — while a release build's Wrangler runs, a SIGINT
# or SIGTERM that reaches the runner goes on to every process of Wrangler's group, and the runner
# then ends by that signal, as it did before it handled any; both handlers are on while the build
# runs and off once it ends.
#
# Wrangler's launcher leads a process group of its own (#2125), not the terminal's, so a signal
# that ended the runner used to leave the build running. Here the build stalls in its custom build
# step, which Wrangler's CLI runs inside that group; the launcher hands a signal to its CLI alone,
# so only a signal sent to the whole group reaches the step, which names the signal it got.
# `NODE_OPTIONS` makes every Node process of the run open the `alive` FIFO to write, so its EOF is
# the moment the last of them exited; esbuild, a Go binary, holds nothing and exits when its CLI
# does, its input closed. The runner's clock is mocked, so its bound never fires, and the step
# reads a lifeline, so nothing but the signal ends the build before the case lets go.
# frozen_string_literal: true
require 'shellwords'
require_relative 'support/wrangler-build-harness'

class ReleaseWranglerBuildSignalsTest < WranglerBuildCase
  RUNNER = <<~JS
    import { mock } from "node:test";
    import { wranglerBuild } from #{LIBRARY.to_json};
    mock.timers.enable({ apis: ["setTimeout"] });
    await wranglerBuild(JSON.parse(process.argv[1]));
  JS
  # It names on `alive` the signal it received, then dies of it: an exit would wait for its read of
  # the lifeline, which runs off the main thread so that the handlers can run. Let go, it fails, so
  # the custom build fails and Wrangler stops before bundling anything.
  STEP = <<~JS
    import { createReadStream, openSync, writeFileSync } from "node:fs";
    const [alive, lifeline] = process.argv.slice(2);
    const held = openSync(lifeline, "r");
    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.once(signal, () => { writeFileSync(alive, `${signal}\\n`); process.kill(process.pid, signal); });
    }
    writeFileSync(alive, "ready\\n");
    createReadStream(null, { fd: held }).on("end", () => process.exit(1)).resume();
  JS
  HANDLERS = <<~JS
    import { mock } from "node:test";
    import { wranglerBuild } from #{LIBRARY.to_json};
    const handlers = () => ["SIGINT", "SIGTERM"].map((signal) => process.listenerCount(signal));
    mock.timers.enable({ apis: ["setTimeout"] });
    const build = wranglerBuild(JSON.parse(process.argv[1]));
    const during = handlers();
    await build;
    console.log(JSON.stringify({ during, after: handlers() }));
  JS

  # A build the case stalled ends once its lifeline closes, and its Node processes are gone before
  # the directory is.
  def teardown
    [@placeholder, @lifeline].compact.each(&:close)
    @runner&.join(BOUND)
    @alive && run_exited?
    super
  end

  def test_a_sigint_reaches_every_process_of_wranglers_group_and_then_ends_the_runner
    assert_forwarded 'INT'
  end

  def test_a_sigterm_reaches_every_process_of_wranglers_group_and_then_ends_the_runner
    assert_forwarded 'TERM'
  end

  def test_the_handlers_are_on_while_the_build_runs_and_off_once_it_ends
    output, error, status = node(HANDLERS, worker(RESPONDS))
    assert status.success?, error
    assert_equal({ 'during' => [1, 1], 'after' => [0, 0] }, JSON.parse(output.lines.last))
  end

  private

  def assert_forwarded(signal)
    start_stalled_build
    Process.kill(signal, @runner.pid)
    assert @runner.join(BOUND), "the runner outlived its SIG#{signal}"
    assert_equal Signal.list.fetch(signal), @runner.value.termsig, log
    assert_equal "SIG#{signal}\n", next_line(@alive, "the custom build step never received the SIG#{signal}")
    assert run_exited?, "a process of Wrangler's group outlived the SIG#{signal}"
  end

  # The case holds a writer of `alive` until the step says it is ready, so the FIFO cannot read
  # EOF before the first process of the run has opened it.
  def start_stalled_build
    alive = fifo('alive')
    @alive, @placeholder = [File::RDONLY, File::WRONLY].map { |mode| File.open(alive, mode | File::NONBLOCK) }
    @lifeline = lifeline(fifo('lifeline'))
    @runner = Process.detach(spawn_runner(stalled_worker(alive), alive))
    assert_equal "ready\n", next_line(@alive, "the build never reached its custom build step\n#{log}")
    @placeholder.close
  end

  def stalled_worker(alive)
    step = File.join(@dir, 'step.mjs').tap { |path| File.write(path, STEP) }
    worker(RESPONDS, build: { command: Shellwords.join(['exec', 'node', step, alive, File.join(@dir, 'lifeline')]) })
  end

  # The runner leads a process group the case made, so Wrangler's group never takes in the case
  # itself, `detached` or not. Each Node process of the run imports `opener` first.
  def spawn_runner(args, alive)
    opener = File.join(@dir, 'alive.mjs')
    File.write(opener, "import { openSync } from \"node:fs\";\nopenSync(#{alive.to_json}, \"w\");\n")
    Process.spawn({ 'NODE_OPTIONS' => "--import=file://#{opener}" }, 'node', '--input-type=module', '-e', RUNNER,
                  args.to_json, chdir: ROOT, pgroup: true, %i[out err] => File.join(@dir, 'runner.log'))
  end

  def next_line(io, missing)
    assert IO.select([io], nil, nil, BOUND), missing
    io.read_nonblock(64)
  end

  # Whether every process holding `alive` open has closed it, within the bound. A yes is kept: on
  # macOS a FIFO read to its EOF does not report readable again.
  def run_exited?
    @run_exited ||= IO.select([@alive], nil, nil, BOUND) && @alive.read_nonblock(1, exception: false).nil?
  end

  def log
    File.read(File.join(@dir, 'runner.log'))
  end
end
