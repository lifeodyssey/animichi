# frozen_string_literal: true
#
# Red / restore / green mutation probes for the ruleset migration contract
# (issue #679 AC6). Each probe mutates a THROWAWAY copy of the ruleset target /
# workflow set and proves the contract rejects the exact migration hazard:
#
#   RED  add an orphan required check (no producing job)      -> ADD-before-REMOVE
#   RED  remove a required check WITHOUT recording retirement -> silent drop
#   GREEN pristine snapshot                                    -> contract passes
#
require "json"
require "stringio"
require "fileutils"
require "tmpdir"
require_relative "test_ci_contract_ruleset_migration"

REAL_RULESET = DEFAULT_RULESET

ORIGINAL_STDOUT = $stdout
ORIGINAL_STDERR = $stderr

def capture(&_block)
  out = StringIO.new
  err = StringIO.new
  $stdout = out
  $stderr = err
  yield
  [out.string + err.string, 0]
rescue SystemExit => e
  [out.string + err.string, e.status]
ensure
  $stdout = ORIGINAL_STDOUT
  $stderr = ORIGINAL_STDERR
end

def run_contract(ruleset_path, workflows_dir)
  capture do
    assert_ruleset_migration_contract(ruleset_path: ruleset_path, workflows_dir: workflows_dir)
  end.tap { |result| result[0] }
end

def copy_tree(src_dir, dst_dir)
  Dir.glob(File.join(src_dir, "*.yml")).sort.each do |path|
    FileUtils.cp(path, File.join(dst_dir, File.basename(path)))
  end
end

def red_probe(label, expected_fragment)
  Dir.mktmpdir("rs-mutation-red") do |dir|
    ruleset = JSON.parse(File.read(REAL_RULESET))
    workflows_dir = File.join(dir, "workflows")
    Dir.mkdir(workflows_dir)
    copy_tree(DEFAULT_WORKFLOWS, workflows_dir)
    yield(ruleset, workflows_dir)
    ruleset_path = File.join(dir, "ruleset-target.json")
    File.write(ruleset_path, JSON.pretty_generate(ruleset))
    text, rc = run_contract(ruleset_path, workflows_dir)
    abort "FAIL: #{label} must be rejected, got exit #{rc}:
#{text}" unless !rc.zero?
    abort "FAIL: #{label} must fail with #{expected_fragment.inspect}:
#{text}" unless text.include?(expected_fragment)
    puts "PASS: #{label} rejected (#{expected_fragment})"
  end
end

def green_probe(label)
  Dir.mktmpdir("rs-mutation-green") do |dir|
    text, rc = run_contract(REAL_RULESET, DEFAULT_WORKFLOWS)
    abort "FAIL: #{label} must pass, got exit #{rc}:
#{text}" unless rc.zero?
    abort "FAIL: #{label} must produce the one-line summary" unless text.include?("Ruleset migration:")
    puts "PASS: #{label} (restore/green)"
  end
end

red_probe("orphan required check added", "no producing job") do |ruleset, _wf|
  ruleset["required_checks"] = ruleset["required_checks"] + ["Ghost / never-produced"]
end

red_probe("required check removed without retirement", "REQUIRED_CONTEXTS lists a non-required check") do |ruleset, _wf|
  ruleset["required_checks"] = ruleset["required_checks"] - ["Security"]
end

red_probe("retired context restored as required (overlap)", "cannot be both required and retired") do |ruleset, _wf|
  ruleset["required_checks"] = ruleset["required_checks"] + [ruleset.fetch("_retired_contexts").fetch(0)]
end

green_probe("pristine ruleset + workflows")

puts "All test_ci_contract_ruleset_migration mutation probes passed."
