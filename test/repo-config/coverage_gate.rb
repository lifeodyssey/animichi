# A package's node coverage gate, as its own manifest declares it (#1766).
#
# node's test runner matches `--test-coverage-include` against paths relative to its startup
# cwd, and when nothing matches its report is empty and its table prints `100.00` — its own
# percentage of zero lines out of zero — so a 95 % threshold passes having measured nothing,
# and no node flag refuses that. The gate here reads the lcov report the run wrote and
# refuses it unless it measured the package: at least one `SF:` entry, and every entry one
# of the package's own files at its repository-root-relative path.
#
# Which packages are gated is read, never listed: any workspace script that runs node with
# `--experimental-test-coverage` is one. Its include glob and lcov destination are taken
# from that same command and read from the repository root, because every such script `cd`s
# there first so that `SF:` paths stay root-relative for Codecov — the convention the second
# half of the check holds in place. Ruby 2.6 (the macOS system ruby the pre-push gate runs)
# must be able to load this file.
require "json"
require "psych"

# What one node command declares about its coverage: the include globs and the lcov report.
# node pairs each `--test-reporter` with the `--test-reporter-destination` in the same position.
class NodeCoverageRun
  MARKER = "--experimental-test-coverage".freeze

  attr_reader :includes, :report

  def initialize(command)
    @command = command
    @includes = values("test-coverage-include")
    lcov = values("test-reporter").index("lcov")
    @report = lcov && values("test-reporter-destination")[lcov]
  end

  private

  # A flag's values in the order written, however each is quoted.
  def values(flag)
    @command.scan(/--#{flag}=(?:'([^']*)'|"([^"]*)"|(\S+))/).map { |spellings| spellings.compact.first }
  end
end

# The lcov file a run left behind, read from the repository root.
class LcovReport
  def initialize(root, path)
    @root, @path = root, path
  end

  def written?
    File.file?(File.join(@root, @path))
  end

  def sources
    @sources ||= File.readlines(File.join(@root, @path)).grep(/\ASF:/).map { |line| line.chomp.sub("SF:", "") }
  end
end

class CoverageGate
  def self.in_workspace(root)
    globs = Psych.safe_load(File.read(File.join(root, "pnpm-workspace.yaml"))).fetch("packages")
    directories = globs.flat_map { |glob| Dir.glob(File.join(root, glob, "package.json")) }
    directories.map { |path| File.dirname(path).sub("#{root}/", "") }.sort
               .flat_map { |directory| declared_in(root, directory) }
  end

  def self.declared_in(root, directory)
    scripts = JSON.parse(File.read(File.join(root, directory, "package.json"))).fetch("scripts", {})
    scripts.select { |_, command| command.include?(NodeCoverageRun::MARKER) }
           .map { |script, command| new(root, directory, script, NodeCoverageRun.new(command)) }
  end

  attr_reader :directory

  def initialize(root, directory, script, run)
    @root, @directory, @script, @run = root, directory, script, run
  end

  def report
    @run.report
  end

  def refusals
    return ["#{directory}: `#{@script}` runs node's coverage but writes no lcov report to check"] if report.nil?
    lcov = LcovReport.new(@root, report)
    return ["#{directory}: no coverage report at #{report} — the coverage run left nothing behind"] unless lcov.written?
    return [measured_nothing] if lcov.sources.empty?
    foreign = lcov.sources.reject { |source| own?(source) }
    foreign.empty? ? [] : [measured_elsewhere(foreign)]
  end

  private

  def own?(source)
    source.start_with?("#{directory}/") && File.file?(File.join(@root, source))
  end

  def measured_nothing
    "#{directory}: coverage report #{report} measured no files, so its percentage is 0 of 0 — " \
      "--test-coverage-include #{@run.includes.map { |glob| "'#{glob}'" }.join(' ')} matched nothing " \
      "from the repository root (#1766)"
  end

  def measured_elsewhere(foreign)
    "#{directory}: coverage report #{report} names files that are not #{directory}'s own at their " \
      "repository-root-relative path: #{foreign.join(', ')} (#1766)"
  end
end
