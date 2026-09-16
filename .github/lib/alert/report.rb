# frozen_string_literal: true
require_relative 'state'

module FailureAlert
  # Renders the alert an operator can act on (#678 AC1): which workflow failed on
  # which ref, the run and its revision, when it started, the jobs and steps that
  # failed, and how often this same failure has recurred.
  module Report
    module_function

    def title(alert)
      "Failure alert: #{alert.fetch('workflow')} on #{alert.fetch('ref')}"
    end

    def body(alert)
      [headline(alert), facts(alert), failures(alert), notes, State.marker(alert.fetch('state'))].join("\n\n")
    end

    def headline(alert)
      "## #{alert.fetch('workflow')} failed on `#{alert.fetch('ref')}`"
    end

    def facts(alert)
      run = alert.fetch('run')
      [run_fact(alert, run), occurrence_fact(alert)].join("\n")
    end

    def run_fact(alert, run)
      "- **Run:** [#{run.fetch('id')} attempt #{run.fetch('run_attempt')}](#{run_url(alert, run.fetch('id'))})" \
        " - #{run.fetch('event')}, revision `#{run.fetch('head_sha')}`, started #{run.fetch('run_started_at')}"
    end

    def occurrence_fact(alert)
      state = alert.fetch('state')
      seen = state.fetch('runs').map { |entry| run_link(alert, entry) }.join(', ')
      "- **Occurrences:** #{state.fetch('occurrences')} - #{seen}"
    end

    def failures(alert)
      lines = alert.fetch('failed').map { |entry| failure(entry) }
      ['### What failed', *lines].join("\n")
    end

    def failure(entry)
      steps = entry.fetch('steps')
      "- **#{entry.fetch('job')}** - #{steps.empty? ? 'no failing step reported' : steps.join(', ')}"
    end

    def notes
      ['### Operator notes',
       '- Open the run and read the failing step, then fix the cause.',
       '- Find every open alert with `is:issue is:open in:title "Failure alert:"`.',
       '- A repeat of this same failure updates this issue in place and sends no further notification.',
       '- Close this issue once the fix is verified; the next failure on this cause opens a new alert.'].join("\n")
    end

    def run_link(alert, entry)
      "[#{entry.fetch('id')}](#{run_url(alert, entry.fetch('id'))})"
    end

    def run_url(alert, id)
      "#{alert.fetch('server')}/#{alert.fetch('repository')}/actions/runs/#{id}"
    end
  end
end
