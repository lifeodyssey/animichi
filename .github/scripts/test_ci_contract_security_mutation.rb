# frozen_string_literal: true

# Red / restore / green probes for the #1177 Security contract. Every child
# lane is mutated independently so a missing dependency or result cannot be
# hidden by the aggregate. The failure-propagation and required-context probes
# cover the two ways a required check can become falsely green or duplicated.

require "json"
require "stringio"
require "tmpdir"
require "yaml"
require_relative "test_ci_contract_security"

ORIGINAL_STDOUT = $stdout
ORIGINAL_STDERR = $stderr

def capture_contract(paths)
  out = StringIO.new
  err = StringIO.new
  $stdout = out
  $stderr = err
  assert_security_contract(**paths)
  [0, out.string + err.string]
rescue SystemExit => error
  [error.status, out.string + err.string]
ensure
  $stdout = ORIGINAL_STDOUT
  $stderr = ORIGINAL_STDERR
end

def fixture_paths(dir)
  {
    ci_path: File.join(dir, "ci.yml"),
    reusable_path: File.join(dir, "reusable-security.yml"),
    codeql_path: File.join(dir, "codeql.yml"),
    ruleset_path: File.join(dir, "ruleset-target.json"),
    aggregate_path: DEFAULT_AGGREGATE
  }
end

def write_fixture(dir, fixture)
  paths = fixture_paths(dir)
  File.write(paths[:ci_path], YAML.dump(fixture.fetch(:ci)))
  File.write(paths[:reusable_path], YAML.dump(fixture.fetch(:reusable)))
  File.write(paths[:codeql_path], YAML.dump(fixture.fetch(:codeql)))
  File.write(paths[:ruleset_path], JSON.pretty_generate(fixture.fetch(:ruleset)))
  paths
end

def fresh_fixture
  {
    ci: load_yaml(DEFAULT_CI),
    reusable: load_yaml(DEFAULT_REUSABLE),
    codeql: load_yaml(DEFAULT_CODEQL),
    ruleset: JSON.parse(File.read(DEFAULT_RULESET))
  }
end

def red_probe(label, expected_fragment)
  Dir.mktmpdir("security-mutation-red") do |dir|
    fixture = fresh_fixture
    yield fixture
    paths = write_fixture(dir, fixture)
    rc, output = capture_contract(paths)
    abort "FAIL: #{label} passed unexpectedly:\n#{output}" if rc.zero?
    unless output.include?(expected_fragment)
      abort "FAIL: #{label} expected #{expected_fragment.inspect}:\n#{output}"
    end
    puts "PASS: #{label} rejected (#{expected_fragment})"
  end
end

def green_probe
  rc, output = capture_contract(
    ci_path: DEFAULT_CI,
    reusable_path: DEFAULT_REUSABLE,
    codeql_path: DEFAULT_CODEQL,
    ruleset_path: DEFAULT_RULESET,
    aggregate_path: DEFAULT_AGGREGATE
  )
  abort "FAIL: pristine Security contract failed:\n#{output}" unless rc.zero?
  abort "FAIL: pristine Security contract omitted its summary" unless output.include?("Security contract:")
  puts "PASS: pristine Security contract (restore/green)"
end

SECURITY_LANES.each do |lane|
  red_probe("summary drops #{lane} dependency", "missing #{lane}") do |fixture|
    needs = fixture.fetch(:reusable).fetch("jobs").fetch("security-summary").fetch("needs")
    needs.delete(lane)
  end
end

SECURITY_LANES.each do |lane|
  red_probe("summary drops #{lane} result", "must report #{lane} result") do |fixture|
    env = fixture.fetch(:reusable).fetch("jobs").fetch("security-summary").fetch("steps").last.fetch("env")
    env["SECURITY_RESULTS"] = env.fetch("SECURITY_RESULTS").lines.reject { |line| line.start_with?("#{lane}=") }.join
  end
end

red_probe("top-level aggregator loses always", "run after scan failures") do |fixture|
  fixture.fetch(:ci).fetch("jobs").fetch("security")["if"] = "${{ success() }}"
end

red_probe("reusable summary loses always", "run after a scan failure") do |fixture|
  fixture.fetch(:reusable).fetch("jobs").fetch("security-summary")["if"] = "${{ success() }}"
end

red_probe("child failures stop being required", "REQUIRE_CHILD_RESULTS=true") do |fixture|
  env = fixture.fetch(:reusable).fetch("jobs").fetch("security-summary").fetch("steps").last.fetch("env")
  env["REQUIRE_CHILD_RESULTS"] = "false"
end

red_probe("required Security context is duplicated by a child", "exactly one Security context") do |fixture|
  fixture.fetch(:ruleset).fetch("required_checks") << "Security / Semgrep (SAST)"
end

red_probe("required Security context is removed", "exactly one Security context") do |fixture|
  fixture.fetch(:ruleset).fetch("required_checks").delete("Security")
end

red_probe("top-level aggregate skips checkout", "top-level Security must checkout") do |fixture|
  steps = fixture.fetch(:ci).fetch("jobs").fetch("security").fetch("steps")
  steps.shift
end

red_probe("summary checkout persists credentials", "security-summary checkout must disable persisted credentials") do |fixture|
  checkout = fixture.fetch(:reusable).fetch("jobs").fetch("security-summary").fetch("steps").first
  checkout.fetch("with")["persist-credentials"] = true
end

green_probe

puts "All test_ci_contract_security mutation probes passed."
