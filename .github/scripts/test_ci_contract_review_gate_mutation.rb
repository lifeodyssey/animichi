# frozen_string_literal: true

require_relative "test_ci_contract_review_gate_mutation_helpers"

red_probe("candidate pull_request trigger", "candidate events", mutate { |wf| wf.fetch("on")["pull_request"] = {} })

red_probe("workflow display name drift", "workflow display name must be Review Gate", mutate do |wf|
  wf["name"] = "Review decision refresh"
end)

red_probe("candidate checkout", "immutable trusted-source SHA", mutate do |wf|
  step = wf.fetch("jobs").fetch("refresh").fetch("steps").find { |item| item.key?("uses") }
  step.fetch("with")["ref"] = "${{ github.event.pull_request.head.sha }}"
end)

red_probe("checkout before pending bootstrap", "claim pending before", mutate do |wf|
  steps = wf.fetch("jobs").fetch("refresh").fetch("steps")
  checkout = steps.delete_at(steps.index { |item| item.key?("uses") })
  steps.unshift(checkout)
end)

red_probe("claim failure leaves stale green", "attempt a red status", mutate do |wf|
  step = wf.fetch("jobs").fetch("refresh").fetch("steps").first
  step["run"] = step.fetch("run").sub("post_with_retry pending || { post_with_retry failure || true; exit 2; }",
                                         "post_with_retry pending")
end)

red_probe("superseded runs serialize", "cancel superseded", mutate do |wf|
  wf.fetch("concurrency")["cancel-in-progress"] = false
end)

red_probe("workflow_run bridge removed", "missing trusted events", mutate do |wf|
  wf.fetch("on").delete("workflow_run")
end)

red_probe("squash title validation removed", "missing step Validate squash title", mutate do |wf|
  steps = wf.fetch("jobs").fetch("refresh").fetch("steps")
  steps.reject! { |step| step["name"] == "Validate squash title" }
end)

red_probe("event pull-request JSON trusted", "must not trust workflow_run event evidence", mutate do |wf|
  step = wf.fetch("jobs").fetch("refresh").fetch("steps").find { |item| item["name"] == "Evaluate head-bound review evidence" }
  step.fetch("env")["QUEUE_PULL_REQUESTS"] = "${{ toJson(github.event.workflow_run.pull_requests) }}"
end)

red_probe("unguarded final", "newest-run ownership guard", mutate do |wf|
  step = wf.fetch("jobs").fetch("refresh").fetch("steps").last
  step["run"] = step.fetch("run").sub("finish-status", "final-status")
end)

red_probe("Actions job named required context", "must not be named Review Gate", mutate do |wf|
  wf.fetch("jobs").fetch("refresh")["name"] = "Review Gate"
end)

red_probe("second status writer added", "only refresh may hold statuses", mutate do |wf|
  wf.fetch("jobs")["rogue"] = {
    "runs-on" => "ubuntu-latest", "timeout-minutes" => 1,
    "permissions" => { "statuses" => "write" }, "steps" => [{ "run" => "true" }]
  }
end)

queue_source = File.read(GATE_STEP)
queue_source_red_probe("workflow-run repository identity removed", queue_source.sub(".repository.full_name", ".repository.owner.login"))
queue_source_red_probe("direct workflow-run PR association removed", queue_source.sub("/pull_requests?per_page=100", "/commits/$2/pulls?per_page=100"))
queue_source_red_probe("PR Verification run binding removed", queue_source.sub('validate_ci_check "$1" "$2" "$3" "PR Verification"', 'validate_ci_check "$1" "$2" "$3" "CI / verify"'))
queue_source_red_probe("Security run binding removed", queue_source.sub('validate_ci_check "$1" "$2" "$3" "Security"', 'validate_ci_check "$1" "$2" "$3" "CI / security"'))
queue_source_red_probe("associated PR uniqueness removed", queue_source.sub("n not in seen", "True"))
queue_source_red_probe("main-target constraint removed", queue_source.sub('base.get("ref")=="main"', "isinstance(base,dict)"))
queue_source_red_probe("commit ancestry restored as membership evidence", "#{queue_source}\n# /compare/ is forbidden\n")

green_probe
queue_source_green_probe
puts "All review-gate mutation probes passed."
