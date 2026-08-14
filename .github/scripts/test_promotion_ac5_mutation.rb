# frozen_string_literal: true
#
# Red / restore / green mutation probes for the #1013 AC5 promotion contract.
# Each probe mutates a THROWAWAY copy of the deploy workflows and proves the
# contract rejects exactly the AC5 hazard; the pristine set then proves it
# passes (green). Mutation is the only valid green-light proof (owner
# commitment #5: promotion-specific mutation hardening in the quality lane).
#
#   RED  tag-triggered deploy (tags: added to deploy.yml)  -> contract rejects
#   RED  promoted component builds (build gate removed)    -> contract rejects
#   GREEN pristine workflows                               -> contract passes

require "stringio"
require "fileutils"
require "tmpdir"
require_relative "test_promotion_ac5_contract"

REAL_WORKFLOWS = WORKFLOWS

ORIGINAL_STDOUT = $stdout
ORIGINAL_STDERR = $stderr

def run_contract(workflows_dir)
  out = StringIO.new
  err = StringIO.new
  $stdout = out
  $stderr = err
  begin
    assert_ac5_contract(workflows_dir)
    rc = 0
  rescue SystemExit => e
    rc = e.status
  ensure
    $stdout = ORIGINAL_STDOUT
    $stderr = ORIGINAL_STDERR
  end
  [out.string + err.string, rc]
end

def copy_tree(src_dir, dst_dir)
  Dir.glob(File.join(src_dir, "*.yml")).sort.each { |path| FileUtils.cp(path, File.join(dst_dir, File.basename(path))) }
end

def red_probe(label, expected_fragment)
  Dir.mktmpdir("ac5-mutation-red") do |dir|
    workflows_dir = File.join(dir, "workflows")
    Dir.mkdir(workflows_dir)
    copy_tree(REAL_WORKFLOWS, workflows_dir)
    yield(workflows_dir)
    text, rc = run_contract(workflows_dir)
    abort "FAIL: #{label} must be rejected, got exit #{rc}:\n#{text}" unless !rc.zero?
    abort "FAIL: #{label} must fail with #{expected_fragment.inspect}:\n#{text}" unless text.include?(expected_fragment)
    puts "PASS: #{label} rejected (#{expected_fragment})"
  end
end

red_probe("tag-triggered deploy added", "must not have a push trigger on tags") do |workflows_dir|
  path = File.join(workflows_dir, "deploy.yml")
  text = File.read(path).sub(/^on:\s*$\n[ \t]*workflow_dispatch:\s*$/m,
    "on:\n  push:\n    tags: ['v*']\n  workflow_dispatch:")
  File.write(path, text)
end

red_probe("promoted component rebuild (build gate removed)", "promotion_artifact_digest == ''") do |workflows_dir|
  path = File.join(workflows_dir, "reusable-deploy-component.yml")
  text = File.read(path)
  text = text.gsub("&& inputs.promotion_artifact_digest == ''", "")
  File.write(path, text)
end

# GREEN: the pristine workflow set passes.
Dir.mktmpdir("ac5-mutation-green") do |dir|
  text, rc = run_contract(REAL_WORKFLOWS)
  abort "FAIL: green probe must pass, got exit #{rc}:\n#{text}" unless rc.zero?
  abort "FAIL: green probe must print the AC5 summary" unless text.include?("no build command runs in the promoted path")
  puts "PASS: pristine AC5 workflows (restore/green)"
end

puts "All test_promotion_ac5 mutation probes passed."
