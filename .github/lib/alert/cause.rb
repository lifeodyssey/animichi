# frozen_string_literal: true

module FailureAlert
  # What failed in a run, read from the jobs API payload. The cause is the set of
  # jobs that concluded `failure`: a `cancelled` job is a human decision (a
  # withdrawn production approval) and a `skipped` job never ran, so neither is a
  # failure to wake anyone for (#678 AC1). The alerting job excludes itself, so a
  # retried alert transport does not change what the alert is about.
  module Cause
    FAILURE = 'failure'

    module_function

    def detail(jobs, self_job)
      jobs.select { |job| failed?(job, self_job) }
          .map { |job| { 'job' => job.fetch('name'), 'steps' => failed_steps(job) } }
          .sort_by { |entry| entry.fetch('job') }
    end

    # The failing job names, as the list they are. This list is the dedup identity
    # of the cause, and it is carried as a list rather than joined into a string:
    # a joined key needs a separator no job name may contain, so a single job
    # literally named `a + b` would have been the same failure as the pair `a`,
    # `b` (#678 review). JSON quotes each name and delimits the elements
    # structurally, so two different lists are two different keys for any names.
    def signature(detail)
      detail.map { |entry| entry.fetch('job') }
    end

    def failed?(job, self_job)
      job['conclusion'] == FAILURE && job['name'] != self_job
    end

    def failed_steps(job)
      job.fetch('steps', []).select { |step| step['conclusion'] == FAILURE }.map { |step| step.fetch('name') }
    end
  end
end
