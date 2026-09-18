# A throwaway pnpm workspace holding coverage-gated packages, for the coverage-report
# contract's own tests (#1766). Each package is a manifest whose `test` script runs node's
# test runner with coverage the way the real ones do — from the repository root, so the
# include glob and the lcov destination are root-relative — plus one source file and,
# when asked, the lcov report a finished run would have left behind.
require "fileutils"
require "json"

class CoverageWorkspace
  attr_reader :root

  def initialize(root)
    @root = root
    File.write(File.join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n  - workers/*\n")
  end

  # The script a coverage-gated package declares; `include` is the glob as written.
  def self.gated_script(directory, include: "#{directory}/src/**/*.mjs")
    "mkdir -p coverage && cd ../.. && node --test --experimental-test-coverage " \
      "--test-coverage-include='#{include}' --test-coverage-lines=95 " \
      "--test-reporter=spec --test-reporter-destination=stdout " \
      "--test-reporter=lcov --test-reporter-destination=#{directory}/coverage/lcov.info " \
      "'#{directory}/test/*.test.mjs'"
  end

  def package(directory, script: self.class.gated_script(directory))
    write(File.join(directory, "package.json"), JSON.generate("name" => File.basename(directory),
                                                               "scripts" => { "test" => script }))
    write(File.join(directory, "src/a.mjs"), "export const a = () => 1;\n")
    directory
  end

  # The report a run left, naming `sources` as its SF entries (none: an empty report).
  def report(directory, sources)
    records = sources.map { |source| "SF:#{source}\nLF:1\nLH:1\nend_of_record\n" }
    write(File.join(directory, "coverage/lcov.info"), "TN:\n#{records.join}")
  end

  def write(relative, content)
    path = File.join(root, relative)
    FileUtils.mkdir_p(File.dirname(path))
    File.write(path, content)
  end
end
