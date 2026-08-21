#!/usr/bin/env ruby
# frozen_string_literal: true

# Red / restore / green mutation probes for CI↔pre-push parity (#1114).
# Probes mutate throwaway copies only — the signed-in files stay pristine.

require "fileutils"
require "stringio"
require "tmpdir"
require_relative "ci_prepush_parity"

ORIGINAL_STDOUT = $stdout
ORIGINAL_STDERR = $stderr

def run_parity(paths)
  out = StringIO.new
  err = StringIO.new
  $stdout = out
  $stderr = err
  rc = 0
  begin
    found = parity_violations(paths)
    if found.empty?
      puts "CI↔pre-push parity: remainder is fully exempted with reasons"
    else
      puts found.sort
      rc = 1
    end
  ensure
    $stdout = ORIGINAL_STDOUT
    $stderr = ORIGINAL_STDERR
  end
  [out.string + err.string, rc]
end

def real_paths
  default_parity_paths
end

def copy_workflows(src, dst)
  Dir.mkdir(dst)
  Dir.glob(File.join(src, "*.yml")).each { |path| FileUtils.cp(path, dst) }
end

def assert_red(label, paths, fragment)
  text, rc = run_parity(paths)
  abort "FAIL: #{label} must be rejected, got exit #{rc}:\n#{text}" if rc.zero?
  abort "FAIL: #{label} expected #{fragment.inspect}:\n#{text}" unless text.include?(fragment)
  puts "PASS: #{label} rejected (#{fragment})"
end

def assert_green(label, paths)
  text, rc = run_parity(paths)
  abort "FAIL: #{label} must pass, got exit #{rc}:\n#{text}" unless rc.zero?
  abort "FAIL: #{label} missing summary:\n#{text}" unless text.include?("remainder is fully exempted")
  puts "PASS: #{label}"
end

def strip_prepush_copy
  Dir.mktmpdir("parity-strip") do |dir|
    src = real_paths.quality
    copy = File.join(dir, "quality.sh")
    File.write(copy, File.read(src).lines.reject { |line| line.include?("assert-workflow-invariants.rb") }.join)
    paths = real_paths.dup
    paths.quality = copy
    assert_red(
      "strip a covered quality check from a pre-push copy",
      paths,
      "uncovered CI checkpoint not on the exemption list: script:.github/scripts/assert-workflow-invariants.rb"
    )
  end
end

def add_ci_check_copy
  Dir.mktmpdir("parity-add") do |dir|
    wf_dir = File.join(dir, "workflows")
    copy_workflows(real_paths.workflows, wf_dir)
    path = File.join(wf_dir, "pipeline-quality.yml")
    extra = "      - name: Brand-new locally-runnable check\n" \
            "        run: ruby .github/scripts/brand-new-local-check.rb\n"
    File.write(path, File.read(path).sub(/^      - name: Run actionlint\n/, "#{extra}      - name: Run actionlint\n"))
    paths = real_paths.dup
    paths.workflows = wf_dir
    assert_red(
      "add a locally-runnable CI check without hanging it on pre-push",
      paths,
      "uncovered CI checkpoint not on the exemption list: script:.github/scripts/brand-new-local-check.rb"
    )
  end
end

def empty_reason_copy
  Dir.mktmpdir("parity-reason") do |dir|
    copy = File.join(dir, "exemptions.yml")
    text = File.read(real_paths.exemptions).sub(
      "reason: OIDC — Codecov upload authenticates with GitHub OIDC",
      'reason: ""'
    )
    File.write(copy, text)
    paths = real_paths.dup
    paths.exemptions = copy
    assert_red(
      "exemption with an empty reason field",
      paths,
      "exemption reason is empty"
    )
  end
end

strip_prepush_copy
add_ci_check_copy
empty_reason_copy
assert_green("pristine tree (restore/green)", real_paths)
puts "All CI↔pre-push parity mutation probes passed."
