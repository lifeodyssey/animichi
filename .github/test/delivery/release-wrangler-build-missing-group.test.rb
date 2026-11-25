# SUT: .github/lib/release/wrangler-build.mjs — a release build's bound that finds Wrangler's
# process group gone names the bound when the launcher has exited, and raises the kill's ESRCH
# when it has not. A group gone with its launcher is a build that ended as the bound fired, and the
# run must still end with the bound's diagnostic; a group missing while the launcher runs is what a
# launcher leading no group of its own looks like — the regression of dropping #2125's `detached` —
# and swallowing it would leave that launcher running and the build hanging, unnoticed.
# frozen_string_literal: true
require_relative 'support/wrangler-build-harness'

class ReleaseWranglerBuildMissingGroupTest < WranglerBuildCase
  DIAGNOSTIC = 'Wrangler did not finish its dry-run build within 60 seconds'
  # The launcher imports `holder` (`NODE_OPTIONS`) and ends before Wrangler starts, so it was its
  # group's only member, and a holder in a session of its own keeps the run's output open. Node
  # emits the launcher's exit once it has reaped it: from then the group is gone and the run has
  # not closed, and the bound fires there.
  GONE = <<~JS
    import childProcess from "node:child_process";
    import { once } from "node:events";
    import { syncBuiltinESMExports } from "node:module";
    import { mock } from "node:test";
    const spawn = mock.method(childProcess, "spawn");
    syncBuiltinESMExports();
    const { WRANGLER_BUILD_TIMEOUT_MS, wranglerBuild } = await import(#{LIBRARY.to_json});
    mock.timers.enable({ apis: ["setTimeout"] });
    process.env.NODE_OPTIONS = `--import=${process.argv[2]}`;
    const build = wranglerBuild(JSON.parse(process.argv[1])).then(() => "built", (error) => error.message);
    const launcher = spawn.mock.calls[0].result;
    await once(launcher, "exit");
    const group = await Promise.try(() => process.kill(-launcher.pid, 0)).then(() => "present", (error) => error.code);
    mock.timers.tick(WRANGLER_BUILD_TIMEOUT_MS);
    console.log(JSON.stringify({ group, failure: await build }));
    process.exit();
  JS
  # The holder reads the case's lifeline on its standard input and writes nothing. The launcher
  # then ends as `ending` says: an exit leaves it an exit code, a SIGKILL a signal.
  HOLDER = <<~JS
    import { spawn } from "node:child_process";
    import { openSync } from "node:fs";
    delete process.env.NODE_OPTIONS;
    const lifeline = openSync(%<lifeline>s, "r");
    const options = { detached: true, stdio: [lifeline, "inherit", "inherit"] };
    spawn(process.execPath, ["-e", "require('node:fs').readFileSync(0)"], options);
    %<ending>s
  JS
  # The build stalls on a FIFO module (`release-wrangler-build.test.rb`). The kernel never answers
  # ESRCH for the group of a launcher that leads one, so `process.kill` answers it once, for the
  # bound's kill; the group that kill named is then killed for real, and the build ends.
  REFUSED = <<~JS
    import { open } from "node:fs/promises";
    import { mock } from "node:test";
    import { WRANGLER_BUILD_TIMEOUT_MS, wranglerBuild } from #{LIBRARY.to_json};
    const [args, stalled] = [JSON.parse(process.argv[1]), process.argv[2]];
    mock.timers.enable({ apis: ["setTimeout"] });
    const build = (async () => wranglerBuild(args))().then(() => "built", (error) => error.message);
    const writer = open(stalled, "w");
    await Promise.race([writer, build]);
    const refusal = Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
    const kill = mock.method(process, "kill", () => { throw refusal; }, { times: 1 });
    const tick = () => mock.timers.tick(WRANGLER_BUILD_TIMEOUT_MS);
    const bound = await Promise.try(tick).then(() => "swallowed", (error) => error.code);
    process.kill(kill.mock.calls[0].arguments[0], "SIGKILL");
    console.log(JSON.stringify({ bound, failure: await build }));
    process.exit();
  JS

  def teardown
    @lifeline&.close
    super
  end

  def test_a_bound_that_meets_a_group_gone_with_a_launcher_that_exited_names_the_bound
    assert_bound_named 'process.exit();'
  end

  def test_a_bound_that_meets_a_group_gone_with_a_launcher_killed_by_a_signal_names_the_bound
    assert_bound_named 'process.kill(process.pid, "SIGKILL");'
  end

  def test_a_bound_that_finds_no_group_while_the_launcher_runs_raises_its_esrch
    stalled = fifo('stalled.js')
    output, error, status = node(REFUSED, worker(%(import "./stalled.js";\n#{RESPONDS})), stalled)
    assert status.success?, error
    assert_equal({ 'bound' => 'ESRCH', 'failure' => DIAGNOSTIC }, JSON.parse(output.lines.last))
  end

  private

  def assert_bound_named(ending)
    @lifeline = lifeline(fifo('lifeline'))
    output, error, status = node(GONE, worker(RESPONDS), holder(ending))
    assert status.success?, error
    assert_equal({ 'group' => 'ESRCH', 'failure' => DIAGNOSTIC }, JSON.parse(output.lines.last))
  end

  def holder(ending)
    path = File.join(@dir, 'holder.mjs')
    File.write(path, format(HOLDER, lifeline: File.join(@dir, 'lifeline').to_json, ending: ending))
    "file://#{path}"
  end
end
