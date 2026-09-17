#!/usr/bin/env ruby
# Stub `gh` for the failure-alert tests (#678 AC1): serves the run, jobs and
# issue-list endpoints from a fixture directory, keeps the opened issues in a
# state file, and records every invocation, so a case can assert what the alert
# published, what it left alone, and that the token it was handed never reached
# argv. ALERT_STUB_FAIL names one "METHOD path" to refuse (query string aside),
# which is how the fail-closed case is driven. ALERT_STUB_DROP_ASSIGNEES reproduces
# the documented silent drop of an assignee the caller may not set: the create
# still answers 201, and the issue comes back carrying nobody.
require "json"

FIXTURES = ENV.fetch("ALERT_FIXTURES")
CALLS = ENV.fetch("ALERT_CALLS")
STATE = ENV.fetch("ALERT_STATE")
# The page size the alerter asks for; the stub answers with the same slices.
PAGE = 100

def fixture(name)
  JSON.parse(File.read(File.join(FIXTURES, name)))
end

def ledger
  File.exist?(STATE) ? JSON.parse(File.read(STATE)) : { "issues" => [], "next" => 901 }
end

def path
  ARGV.find { |argument| argument.start_with?("repos/") }.to_s
end

# The ledger is longer than one page in the real repository, so the stub slices it
# the way GitHub does and a case can put an entry on a later page.
def page_number
  match = path.match(/[?&]page=(\d+)/)
  match.nil? ? 1 : Integer(match[1])
end

def page_of(issues)
  issues.each_slice(PAGE).to_a.fetch(page_number - 1, [])
end

def method_name
  index = ARGV.index("-X")
  index.nil? ? "GET" : ARGV.fetch(index + 1)
end

def target
  "#{method_name} #{path.split('?').first}"
end

def refusing?
  refusal = ENV["ALERT_STUB_FAIL"].to_s
  !refusal.empty? && refusal == target
end

def summary(issue)
  { "number" => issue.fetch("number"), "title" => issue.fetch("title"), "body" => issue.fetch("body"),
    "assignees" => issue["assignees"] }
end

# The API carries an assignee as an object, and drops one the caller may not set
# without changing the status code.
def accepted_assignees(request)
  return [] unless ENV["ALERT_STUB_DROP_ASSIGNEES"].to_s.empty?
  Array(request["assignees"]).map { |login| { "login" => login } }
end

def open_issue(state, number)
  issue = state.fetch("issues").find { |candidate| candidate.fetch("number") == number }
  abort("stub: no issue #{number}") if issue.nil?
  issue
end

File.open(CALLS, "a") { |log| log.puts(JSON.generate(ARGV)) }
abort("stub: refusing #{target}") if refusing?
request = ARGV.include?("--input") ? JSON.parse($stdin.read.force_encoding(Encoding::UTF_8)) : {}
state = ledger
case target
when %r{\AGET repos/\S+/actions/runs/\d+\z} then puts JSON.generate(fixture("run.json"))
when %r{\AGET repos/\S+/actions/runs/\d+/jobs} then puts JSON.generate(fixture("jobs.json"))
when %r{\AGET repos/\S+/issues\z} then puts JSON.generate(page_of(state.fetch("issues")).map { |issue| summary(issue) })
when %r{\APOST repos/\S+/issues\z}
  issue = { "number" => state.fetch("next"), "title" => request.fetch("title"), "body" => request.fetch("body"),
            "labels" => request["labels"], "assignees" => accepted_assignees(request) }
  state["issues"] << issue
  state["next"] += 1
  File.write(STATE, JSON.generate(state))
  puts JSON.generate(summary(issue))
when %r{\APATCH repos/\S+/issues/(?<number>\d+)\z}
  issue = open_issue(state, Integer(Regexp.last_match[:number]))
  issue["body"] = request.fetch("body")
  File.write(STATE, JSON.generate(state))
  puts JSON.generate(summary(issue))
else abort("stub: unhandled #{method_name} #{path}")
end
