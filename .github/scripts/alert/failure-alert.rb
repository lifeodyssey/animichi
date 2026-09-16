# frozen_string_literal: true
require 'json'
require_relative '../../lib/alert/api'
require_relative '../../lib/alert/cause'
require_relative '../../lib/alert/plan'
require_relative '../../lib/alert/recipient'
require_relative '../../lib/alert/report'
require_relative '../../lib/alert/state'

# Publishes one deduplicated alert for a run whose jobs failed (#678 AC1). A
# workflow invokes this only when a job it needs concluded `failure`, and it
# publishes nothing when the run has no failing job, so a restored workflow and a
# re-run of an already-recorded run are both silent.
# The alert issues already carrying a ledger, read from every open issue because
# the marker is in the body and GitHub cannot search for one (#678 AC1).
# `each_with_object` rather than `filter_map`, because every other Ruby file here
# runs on the runner's 3.x and the developer's system 2.6.
def ledger
  FailureAlert::Api.open_issues.each_with_object([]) do |issue, found|
    state = FailureAlert::State.parse(issue['body'])
    found << { 'number' => issue.fetch('number'), 'state' => state } unless state.nil?
  end
end

def publish(payload, plan, run)
  case plan.fetch('action')
  when FailureAlert::Plan::CREATE then opened(payload)
  when FailureAlert::Plan::UPDATE
    "updated ##{FailureAlert::Api.update_issue(payload, plan.fetch('issue')).fetch('number')}"
  else "run #{run.fetch('id')} is already recorded on ##{plan.fetch('issue')}"
  end
end

# The create-only issue content, audience included: publishing is the moment the
# alert has to reach a person, and the update path narrows to the body alone so a
# repeat never rewrites who the alert is for.
def alert_payload(alert)
  { 'title' => FailureAlert::Report.title(alert), 'body' => FailureAlert::Report.body(alert),
    'assignees' => FailureAlert::Recipient.logins }
end

# Publish, then prove GitHub kept the audience: an assignee it drops is dropped
# silently, and an alert nobody is notified of must not look green (#1718 AC2).
def opened(payload)
  issue = FailureAlert::Api.create_issue(payload)
  FailureAlert::Recipient.confirm(issue, payload)
  "opened ##{issue.fetch('number')}"
end

run = FailureAlert::Api.run
failed = FailureAlert::Cause.detail(FailureAlert::Api.jobs.fetch('jobs'), ENV.fetch('ALERT_SELF_JOB'))
if failed.empty?
  puts "failure-alert: run #{run.fetch('id')} has no failing job; nothing published"
  exit 0
end

alert = { 'run' => run, 'workflow' => ENV.fetch('GITHUB_WORKFLOW'), 'ref' => ENV.fetch('GITHUB_REF_NAME'),
          'repository' => FailureAlert::Api.repo, 'server' => ENV.fetch('GITHUB_SERVER_URL'), 'failed' => failed }
plan = FailureAlert::Plan.decide(workflow: alert.fetch('workflow'), ref: alert.fetch('ref'),
                                 signature: FailureAlert::Cause.signature(failed), alerts: ledger, run: run)
alert['state'] = plan.fetch('state')
payload = alert_payload(alert)
puts "failure-alert: #{plan.fetch('key')} - #{publish(payload, plan, run)}"
