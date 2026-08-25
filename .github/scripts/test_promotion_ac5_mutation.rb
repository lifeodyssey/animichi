# frozen_string_literal: true

require "fileutils"
require "stringio"
require "tmpdir"
require_relative "test_promotion_ac5_contract"

REAL_WORKFLOWS = WORKFLOWS
ORIGINAL_STDOUT = $stdout
ORIGINAL_STDERR = $stderr

def run_contract(workflows_dir)
  output = StringIO.new
  $stdout = output
  $stderr = output
  assert_ac5_contract(workflows_dir)
  [output.string, 0]
rescue SystemExit => error
  [output.string, error.status]
ensure
  $stdout = ORIGINAL_STDOUT
  $stderr = ORIGINAL_STDERR
end

def copy_workflows(destination)
  Dir.glob(File.join(REAL_WORKFLOWS, "*.yml")).each { |path| FileUtils.cp(path, destination) }
end

def red_probe(label, message)
  Dir.mktmpdir("ac5-red") do |dir|
    copy_workflows(dir)
    yield(dir)
    output, status = run_contract(dir)
    abort "FAIL: #{label} was accepted" if status.zero?
    abort "FAIL: #{label} did not report #{message}" unless output.include?(message)
    puts "PASS: #{label} rejected"
  end
end

red_probe("tag-triggered CD", "push trigger on tags") do |dir|
  path = File.join(dir, "cd.yml")
  File.write(path, File.read(path).sub("branches: [main]", "branches: [main]\n    tags: ['v*']"))
end

red_probe("production rebuild", "must not run a build command") do |dir|
  path = File.join(dir, "cd.yml")
  source = File.read(path).sub("set -euo pipefail\n          jq -r", "set -euo pipefail\n          pnpm build\n          jq -r")
  File.write(path, source)
end

output, status = run_contract(REAL_WORKFLOWS)
abort "FAIL: pristine AC5 contract failed: #{output}" unless status.zero?
puts "PASS: pristine AC5 workflows"
puts "All test_promotion_ac5 mutation probes passed."
