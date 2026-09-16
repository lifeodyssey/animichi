# frozen_string_literal: true

require "stringio"
require_relative "card_reconcile_cli_root"

# Runs the CLI over `CliRoot`'s root and returns its status and output.
module CliFixture
  module_function

  def with_root
    Dir.mktmpdir do |root|
      CliRoot.build(root)
      return yield(root)
    end
  end

  def invoke(root, extra = [], degraded: false, pr_state: "OPEN", failed: false)
    stdout = StringIO.new
    stderr = StringIO.new
    argv = ["--lanes", root, "--repo-root", root, "--holds", File.join(root, "card-holds.json"),
            "--now", ReconcileFixtures::NOW.iso8601] + extra
    status = Orca::CardReconcile::CLI.run(argv, stdout: stdout, stderr: stderr,
                                          command: command(root, degraded: degraded,
                                                                pr_state: pr_state,
                                                                failed: failed))
    [status, stdout.string, stderr.string]
  end

  def holds(root, content)
    ReconcileFixtures.write_json(File.join(root, "card-holds.json"), content)
  end

  def command(root, degraded: false, pr_state: "OPEN", failed: false)
    return Orca::CardReconcile::Command.new if root.nil?

    stubbed = CliRoot.responses(root, failed: failed)
    fail_gh(stubbed) if degraded
    stubbed["gh pr view"] = JSON.generate({ "state" => pr_state }) unless degraded
    Orca::CardReconcile::Command.new(ScriptedShell.new(stubbed))
  end

  # The CLI's own default command, for a run that must not touch the machine.
  def stubbed_command
    command(nil)
  end

  def fail_gh(stubbed)
    failed = Orca::CardReconcile::Command::Result.new("", "gh is down", 1)
    stubbed.keys.select { |key| key.start_with?("gh pr list") }.each { |key| stubbed[key] = failed }
  end
end
