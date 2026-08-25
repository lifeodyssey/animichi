# frozen_string_literal: true

require "stringio"
require "tmpdir"
require_relative "test_ci_contract_review_gate"

REAL = File.expand_path("../workflows/review-gate.yml", __dir__)
OUT = $stdout
ERR = $stderr

def run_contract(path)
  out = StringIO.new
  err = StringIO.new
  $stdout = out
  $stderr = err
  assert_split_review_gate(path)
  [0, out.string + err.string]
rescue SystemExit => e
  [e.status, out.string + err.string]
ensure
  $stdout = OUT
  $stderr = ERR
end

def mutate
  value = YAML.safe_load(File.read(REAL).sub(/^on:/, '"on":'))
  yield value
  value
end

def red_probe(label, expected, value)
  Dir.mktmpdir("review-gate-red") do |dir|
    path = File.join(dir, "review-gate.yml")
    File.write(path, YAML.dump(value))
    rc, output = run_contract(path)
    abort "FAIL: #{label} was accepted" if rc.zero?
    abort "FAIL: #{label} lacked #{expected.inspect}: #{output}" unless output.include?(expected)
    puts "PASS: #{label} rejected"
  end
end

def green_probe
  rc, output = run_contract(REAL)
  abort "FAIL: pristine workflow rejected: #{output}" unless rc.zero?
  puts "PASS: pristine review gate restored"
end

def queue_source_red_probe(label, source)
  Dir.mktmpdir("review-gate-queue-red") do |dir|
    path = File.join(dir, "pr-review-gate-step.sh")
    File.write(path, source)
    rejected = false
    begin
      assert_live_queue_association(path)
    rescue SystemExit
      rejected = true
    end
    abort "FAIL: #{label} was accepted" unless rejected
    puts "PASS: #{label} rejected"
  end
end

def queue_source_green_probe
  assert_live_queue_association
  puts "PASS: pristine live queue association restored"
end
