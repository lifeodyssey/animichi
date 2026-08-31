#!/usr/bin/env ruby
# frozen_string_literal: true

# Hermetic tests for the Security check-runs canary. No test in this file
# contacts GitHub; the live API path is exercised with a request-recording fake.

require "json"
require_relative "security-check-runs-canary"

ROOT = File.expand_path("../..", __dir__)
FIXTURE_PATH = File.join(ROOT, ".github", "scripts", "fixtures", "security-check-runs.json")
REPO = "lifeodyssey/animichi"
SHA = "0123456789abcdef0123456789abcdef01234567"
REQUIRED_CONTEXTS = ["PR Verification", "Security"].freeze

FIXTURE = JSON.parse(File.read(FIXTURE_PATH))

class FakeApi
  attr_reader :paths

  def initialize(responses)
    @responses = responses
    @paths = []
  end

  def get(path)
    @paths << path
    @responses.fetch(path)
  end
end

def live_client(required_contexts, check_pages: nil, ruleset_pages: nil)
  pr_path = "/repos/#{REPO}/pulls/1177"
  rulesets_path = "/repos/#{REPO}/rulesets?includes_parents=true&per_page=100"
  ruleset_path = "/repos/#{REPO}/rulesets/42"
  commit_path = "/repos/#{REPO}/commits/#{SHA}"
  checks_path = "/repos/#{REPO}/commits/#{SHA}/check-runs?per_page=100"
  check_pages ||= [copy_fixture.fetch("check_runs")]
  ruleset_pages ||= [[{ "id" => 42, "enforcement" => "active" }]]
  responses = {
    pr_path => { "head" => { "sha" => SHA } },
    commit_path => { "sha" => SHA },
    rulesets_path => ruleset_pages.fetch(0),
    ruleset_path => { "rules" => [{
      "type" => "required_status_checks",
      "parameters" => { "required_status_checks" => required_contexts.map { |context| { "context" => context } } }
    }] },
    checks_path => { "check_runs" => check_pages.fetch(0) }
  }
  check_pages.drop(1).each_with_index do |page, index|
    responses["#{checks_path}&page=#{index + 2}"] = { "check_runs" => page }
  end
  ruleset_pages.drop(1).each_with_index do |page, index|
    responses["#{rulesets_path}&page=#{index + 2}"] = page
  end
  FakeApi.new(responses)
end

def copy_fixture
  JSON.parse(JSON.generate(FIXTURE))
end

def green_case(label)
  yield
  puts "PASS: #{label}"
end

def red_case(label, expected)
  yield
  abort "FAIL: #{label} passed unexpectedly"
rescue SecurityCheckRunsCanary::Failure => error
  abort "FAIL: #{label} omitted #{expected.inspect}: #{error.message}" unless error.message.include?(expected)
  puts "PASS: #{label} rejected"
end

green_case("fixture validates") do
  SecurityCheckRunsCanary.assert!(copy_fixture, repo: REPO, expected_sha: SHA,
                                  required_contexts: REQUIRED_CONTEXTS)
end

red_case("retired aggregate context is rejected", "exactly PR Verification, Security") do
  contexts = [*REQUIRED_CONTEXTS, "CI / verify"]
  SecurityCheckRunsCanary.assert!(copy_fixture, repo: REPO, expected_sha: SHA,
                                  required_contexts: contexts)
end

red_case("duplicate PR Verification runs are rejected", "exactly one PR Verification check run") do
  payload = copy_fixture
  payload["check_runs"] << payload["check_runs"].first
  SecurityCheckRunsCanary.assert!(payload, repo: REPO, expected_sha: SHA,
                                  required_contexts: REQUIRED_CONTEXTS)
end

red_case("failed required result is rejected", "not completed successfully") do
  payload = copy_fixture
  payload["check_runs"].first["conclusion"] = "failure"
  SecurityCheckRunsCanary.assert!(payload, repo: REPO, expected_sha: SHA,
                                  required_contexts: REQUIRED_CONTEXTS)
end

red_case("stale required head is rejected", "head does not match") do
  payload = copy_fixture
  payload["check_runs"].first["head_sha"] = "f" * 40
  SecurityCheckRunsCanary.assert!(payload, repo: REPO, expected_sha: SHA,
                                  required_contexts: REQUIRED_CONTEXTS)
end

red_case("non-actionable evidence is rejected", "actionable evidence link") do
  payload = copy_fixture
  payload["check_runs"].first["output"]["summary"] = "https://example.com/report"
  SecurityCheckRunsCanary.assert!(payload, repo: REPO, expected_sha: SHA,
                                  required_contexts: REQUIRED_CONTEXTS)
end

red_case("empty evidence summary is rejected", "summary is empty") do
  payload = copy_fixture
  payload["check_runs"].first["output"]["summary"] = ""
  SecurityCheckRunsCanary.assert!(payload, repo: REPO, expected_sha: SHA,
                                  required_contexts: REQUIRED_CONTEXTS)
end

green_case("live PR mode resolves the real head and ruleset") do
  checks_path = "/repos/#{REPO}/commits/#{SHA}/check-runs?per_page=100"
  client = live_client(REQUIRED_CONTEXTS)
  result = SecurityCheckRunsCanary.run_live!(REPO, "1177", client: client)
  abort "FAIL: live PR mode resolved the wrong SHA" unless result == SHA
  abort "FAIL: live PR mode did not query check-runs" unless client.paths.include?(checks_path)
end

green_case("live head mode verifies the supplied commit") do
  client = live_client(REQUIRED_CONTEXTS)
  SecurityCheckRunsCanary.run_live!(REPO, SHA, client: client)
  expected = "/repos/#{REPO}/commits/#{SHA}"
  abort "FAIL: live head mode did not verify the commit" unless client.paths.include?(expected)
end

green_case("live mode follows later check-runs and ruleset pages") do
  filler_runs = Array.new(100) { |index| { "name" => "Other #{index}", "head_sha" => SHA } }
  filler_rulesets = Array.new(100) { |index| { "id" => index + 100, "enforcement" => "disabled" } }
  client = live_client(REQUIRED_CONTEXTS, check_pages: [filler_runs, copy_fixture.fetch("check_runs")],
                       ruleset_pages: [filler_rulesets, [{ "id" => 42, "enforcement" => "active" }]])
  SecurityCheckRunsCanary.run_live!(REPO, SHA, client: client)
  checks_page = "/repos/#{REPO}/commits/#{SHA}/check-runs?per_page=100&page=2"
  rulesets_page = "/repos/#{REPO}/rulesets?includes_parents=true&per_page=100&page=2"
  abort "FAIL: live mode did not query the second check-runs page" unless client.paths.include?(checks_page)
  abort "FAIL: live mode did not query the second ruleset page" unless client.paths.include?(rulesets_page)
end

red_case("live mode rejects empty check-runs results", "exactly one PR Verification check run") do
  client = live_client(REQUIRED_CONTEXTS, check_pages: [[]])
  SecurityCheckRunsCanary.run_live!(REPO, SHA, client: client)
end

red_case("live mode rejects empty ruleset results", "exactly PR Verification, Security") do
  client = live_client(REQUIRED_CONTEXTS, ruleset_pages: [[]])
  SecurityCheckRunsCanary.run_live!(REPO, SHA, client: client)
end

red_case("live ruleset rejects a retired aggregate", "exactly PR Verification, Security") do
  contexts = [*REQUIRED_CONTEXTS, "CI / verify"]
  SecurityCheckRunsCanary.run_live!(REPO, "1177", client: live_client(contexts))
end

red_case("live mode requires GH_TOKEN", "GH_TOKEN is required") do
  SecurityCheckRunsCanary.run_live!(REPO, "1177", token: nil)
end

red_case("live mode rejects an unsafe repository name", "repository must be OWNER/REPOSITORY") do
  SecurityCheckRunsCanary.run_live!("owner/../repo", "1177", token: "test")
end

abort "FAIL: --help must be accepted" unless SecurityCheckRunsCanary.main(["--help"]).zero?
puts "All security-check-runs-canary tests passed."
