# SUT: the build-script decisions every install and every workspace manifest must state.
#
# pnpm 11 flipped `strictDepBuilds` to true by default (v11.0.0 release notes,
# "Security & Build Defaults"), so a manifest that stays silent about it still
# gate-keeps: a dependency that declares an install script and is missing from
# `allowBuilds` fails the install instead of printing the pnpm 10 warning. That
# is how #1772 reached `main` red: `seal-foundation.sh` runs the one CI install
# that executes scripts, `infra/database-access`'s manifest had named only the
# generated SDK, and protobufjs — reached through @pulumi/pulumi — errored the
# release build after the merge.
#
# Two invariants, quantified over the tree rather than written down as lists:
#   1. every `pnpm-workspace.yaml` in the repository declares `strictDepBuilds`
#      explicitly;
#   2. every `pnpm install` under `.github/**` that does not pass
#      `--ignore-scripts` resolves against a manifest carrying an `allowBuilds`
#      map.
# Whether a map is COMPLETE no static reader can answer — only the install
# itself can, which is what pr-verification's foundation-install job runs at
# PR time against the real seal.
require "minitest/autorun"
require "psych"

class InstallBuildDecisionsTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  GITHUB = ".github"
  INSTALL_LINE = /(?:\A|\s)pnpm\s+install\b/.freeze

  # ---- invariant 1: every workspace manifest states its own strictness ----

  def test_every_workspace_manifest_declares_strict_dep_builds
    silent = workspace_manifests.reject { |relative| document(relative).key?("strictDepBuilds") }
    assert_empty silent,
                 "pnpm 11 defaults strictDepBuilds to true, so an undeclared manifest still refuses builds " \
                 "(#{silent.join(', ')}); each pnpm-workspace.yaml must state the strictness its " \
                 "allowBuilds map answers, or its install decision is whoever pnpm's default is that day"
  end

  def test_strict_dep_builds_is_true_wherever_it_is_declared
    declined = workspace_manifests.select { |relative|
      document(relative).key?("strictDepBuilds") && document(relative)["strictDepBuilds"] != true
    }
    assert_empty declined.map { |relative| "#{relative}: #{document(relative)["strictDepBuilds"].inspect}" },
                 "this repository's decision is that a dependency build script needs an explicit " \
                 "allowBuilds entry; a strictDepBuilds other than true lets one manifest opt the tree " \
                 "back into running whatever installs"
  end

  # ---- invariant 2: an install that runs scripts faces a manifest that decides ----

  def test_every_install_that_runs_scripts_resolves_against_a_manifest_with_allow_builds
    offenders = install_invocations.reject { |invocation| invocation[:text].include?("--ignore-scripts") }
                                   .reject { |invocation| allowing_manifest?(invocation[:directory]) }
    assert_empty offenders.map { |invocation| describe(invocation) },
                 "every `pnpm install` that runs scripts must resolve against a manifest that declares an " \
                 "allowBuilds map — under strictDepBuilds the map is the decision, and an install facing a " \
                 "manifest without one fails on the first script-bearing dependency pnpm names"
  end

  # ---- the tree readers ----

  def workspace_manifests
    Dir.glob("**/pnpm-workspace.yaml", base: ROOT)
       .reject { |relative| relative.split("/").include?("node_modules") }.sort
  end

  def document(relative)
    @documents ||= {}
    @documents[relative] ||= Psych.safe_load(File.read(File.join(ROOT, relative))) || {}
  end

  # Every `pnpm install` invocation under `.github/**`, as file, line, text and
  # the absolute directory it runs in. Workflow and action YAML is read
  # structurally so a step's `working-directory` counts; every other text file
  # is read line by line, following `cd` and the parens that scope it the way
  # bash does.
  def install_invocations
    github_files.flat_map do |relative|
      path = File.join(ROOT, GITHUB, relative)
      if relative.match?(/\.(?:yml|yaml)\z/)
        runs = []
        collect_runs(Psych.safe_load(File.read(path), aliases: true), nil, runs)
        found = runs.map { |text, working_directory|
          scan(text, "#{GITHUB}/#{relative}", join(ROOT.to_s, working_directory || "."), false)
        }.flatten
        locate_lines(path, found)
        found
      else
        scan(File.binread(path), "#{GITHUB}/#{relative}", ROOT.to_s, true)
      end
    end.flatten
  end

  def github_files
    Dir.glob("**/*", base: File.join(ROOT, GITHUB))
       .select { |relative| File.file?(File.join(ROOT, GITHUB, relative)) }
       .reject { |relative| relative.split("/").include?("node_modules") }.sort
  end

  def collect_runs(node, working_directory, runs)
    case node
    when Hash
      run = node["run"]
      runs << [run, working_directory] if run.is_a?(String)
      child_directory = node["working-directory"].is_a?(String) ? node["working-directory"] : working_directory
      node.each_value { |value| collect_runs(value, child_directory, runs) }
    when Array then node.each { |value| collect_runs(value, working_directory, runs) }
    end
  end

  # One bash reading: a leading `(cd <dir>` opens a subshell already moved, a
  # bare `)` closes the innermost one, and a plain `cd` moves the rest of the
  # script. An install is recorded before the closing paren of its own line pops
  # the subshell it runs in. YAML run blocks keep `numbered` false — their line
  # index is the block's, not the file's.
  def scan(text, file, directory, numbered)
    found = []
    stack = []
    text.lines.each_with_index do |line, index|
      if (nested = line.match(/\A\s*\(\s*cd\s+(\S+)/))
        stack.push(directory)
        directory = join(directory, nested[1])
      elsif line.match?(/\A\s*\(\s*\z/)
        stack.push(directory)
      elsif (moved = line.match(/\A\s*cd\s+(\S+)/))
        directory = join(directory, moved[1])
      end
      if line.match?(INSTALL_LINE)
        found << { file: file, line: numbered ? index + 1 : nil,
                   text: line.strip.sub(/\)\z/, ""), directory: directory }
      end
      directory = stack.pop if stack.any? && line.rstrip.end_with?(")")
    end
    found
  end

  # A block scalar's lines sit verbatim in the file, and a plain-scalar run's
  # text sits inside its `- run:` line, so each invocation's line in its own
  # file is findable by text. One that cannot be found keeps no line rather
  # than a wrong one.
  def locate_lines(path, found)
    lines = File.binread(path).lines
    found.each do |invocation|
      index = lines.index { |line| line.include?(invocation[:text]) }
      invocation[:line] = index + 1 if index
    end
  end

  def join(directory, target)
    return target if target.start_with?("/")

    File.expand_path(target, directory)
  end

  # The manifest an install resolves against: the nearest `pnpm-workspace.yaml`
  # at or above the invocation directory, and whether it carries an `allowBuilds`
  # map. A `--dir` into an untracked seal copy (`release/foundation/...`) walks
  # out to the root manifest here; the sealed copies are the committed manifests'
  # own bytes, which invariant 1 and the PR-time install already cover.
  def allowing_manifest?(directory)
    path = File.expand_path(directory)
    while path == ROOT.to_s || path.start_with?("#{ROOT}/")
      candidate = File.join(path, "pnpm-workspace.yaml")
      if File.file?(candidate)
        manifest = Psych.safe_load(File.read(candidate)) || {}
        return manifest["allowBuilds"].is_a?(Hash)
      end
      parent = File.dirname(path)
      return false if parent == path

      path = parent
    end
    false
  end

  def describe(invocation)
    where = invocation[:line] ? "#{invocation[:file]}:#{invocation[:line]}" : invocation[:file]
    "#{where} runs `#{invocation[:text]}`"
  end
end
