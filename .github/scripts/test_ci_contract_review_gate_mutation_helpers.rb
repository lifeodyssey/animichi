# frozen_string_literal: true

# Shared red/restore/green harness for Review Gate workflow mutation probes.

require "fileutils"
require "stringio"
require "tmpdir"
require_relative "test_ci_contract_review_gate"

REAL = File.expand_path("../workflows/pipeline-quality.yml", __dir__)
ORIGINAL_STDOUT = $stdout
ORIGINAL_STDERR = $stderr

def run_contract(path)
  out, err = redirect_capture
  rc = invoke_contract(path)
  restore_capture
  [rc, out.string + err.string]
end

def redirect_capture
  out = StringIO.new
  err = StringIO.new
  $stdout = out
  $stderr = err
  [out, err]
end

def restore_capture
  $stdout = ORIGINAL_STDOUT
  $stderr = ORIGINAL_STDERR
end

def invoke_contract(path)
  assert_review_gate_contract(path)
  0
rescue SystemExit => e
  e.status
end

def fetch_named(steps, name)
  found = steps.find { |step| step.is_a?(Hash) && step["name"] == name }
  raise "no step named #{name}" unless found
  found
end

def insert_after(steps, found, anchor)
  list = steps.dup
  list.delete(found)
  index = list.index(anchor) + 1
  list.insert(index, found)
end

def reorder_steps(steps, find_name, after_name)
  insert_after(steps, fetch_named(steps, find_name), fetch_named(steps, after_name))
end

def apply_reorder(wf, reorder)
  return wf unless reorder
  job = wf.fetch("jobs").fetch("invariants")
  job["steps"] = reorder_steps(job.fetch("steps"), reorder[:name], reorder[:after])
  wf
end

def apply_cancel(wf, cancel_in_progress)
  return wf unless cancel_in_progress
  wf["concurrency"]["cancel-in-progress"] = cancel_in_progress
  wf
end

def apply_pr_types(wf, pr_types)
  return wf unless pr_types
  on_map = wf["on"] || wf[true]
  on_map["pull_request"]["types"] = pr_types
  wf
end

def apply_job_name(wf, job_name, legacy_name, legacy_needs)
  wf.fetch("jobs").fetch("invariants")["name"] = job_name if job_name
  legacy = wf.fetch("jobs").fetch("legacy-quality")
  legacy["name"] = legacy_name if legacy_name
  legacy["needs"] = legacy_needs if legacy_needs
  wf
end

def mutated_workflow(reorder: nil, cancel_in_progress: nil, concurrency_group: nil, pr_types: nil, job_name: nil, legacy_name: nil, legacy_needs: nil)
  wf = YAML.safe_load(File.read(REAL))
  wf = apply_reorder(wf, reorder)
  wf = apply_cancel(wf, cancel_in_progress)
  wf["concurrency"]["group"] = concurrency_group if concurrency_group
  wf = apply_pr_types(wf, pr_types)
  apply_job_name(wf, job_name, legacy_name, legacy_needs)
end

def red_probe(label, expected_fragment, wf)
  Dir.mktmpdir("rg-mutation-red") do |dir|
    path = File.join(dir, "pipeline-quality.yml")
    File.write(path, YAML.dump(wf))
    rc, out = run_contract(path)
    abort "FAIL: #{label} must be rejected by the contract, got exit #{rc}:\n#{out}" if rc.zero?
    abort "FAIL: #{label} must fail with #{expected_fragment.inspect} in output:\n#{out}" unless out.include?(expected_fragment)
    puts "PASS: #{label} rejected (#{expected_fragment})"
  end
end

def green_probe(label)
  Dir.mktmpdir("rg-mutation-green") do
    rc, out = run_contract(REAL)
    abort "FAIL: #{label} must pass the contract, got exit #{rc}:\n#{out}" unless rc.zero?
    abort "FAIL: #{label} must produce the one-line summary:\n#{out}" unless out.include?("Review gate:")
    puts "PASS: #{label} (restore/green)"
  end
end

def scope_probe
  scope_cases.each { |event, extension, declaration| scope_case(event, extension, declaration) }
end

def scope_cases
  [["issue_comment", "yml", "issue_comment:\n    types: [created]"], ["pull_request_review", "yaml", "pull_request_review"], ["pull_request_review_comment", "yml", "[pull_request_review_comment]"]]
end

def scope_case(event, extension, declaration)
  Dir.mktmpdir("rg-scope-red") do |dir|
    workflow_paths(File.expand_path("../workflows", __dir__)).each { |path| FileUtils.cp(path, dir) }
    File.write(File.join(dir, "review-only-matrix.#{extension}"), "name: review-only-matrix\non:\n  #{declaration}\njobs:\n  noop:\n    runs-on: ubuntu-latest\n    steps: []\n")
    ENV["REVIEW_GATE_WORKFLOWS_DIR"] = dir
    rc, out = run_contract(REAL)
    ENV.delete("REVIEW_GATE_WORKFLOWS_DIR")
    abort "FAIL: #{event} scope must be rejected, got exit #{rc}:\n#{out}" if rc.zero?
    abort "FAIL: #{event} scope rejection was not explicit:\n#{out}" unless out.include?("review/comment refresh events")
    puts "PASS: #{event} scope rejected (#{extension})"
  end
end
