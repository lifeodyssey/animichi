# frozen_string_literal: true
require 'json'

module FailureAlert
  # The recurrence ledger that the alert issue itself carries (#678 AC1). The key
  # is machine-readable in the body marker, so a repeat is matched to its alert
  # with no store of our own, and a re-run of a run already recorded is
  # recognized rather than counted as another occurrence.
  module State
    MARKER = /<!-- failure-alert:v1 (?<state>\{.*?\}) -->/
    HISTORY = 5

    module_function

    def fresh(run, key)
      { 'key' => key, 'first_seen' => started(run), 'last_seen' => started(run),
        'occurrences' => 1, 'runs' => [occurrence(run)] }
    end

    def record(previous, run)
      return previous if seen?(previous, run)
      { 'key' => previous.fetch('key'), 'first_seen' => previous.fetch('first_seen'),
        'last_seen' => started(run), 'occurrences' => previous.fetch('occurrences') + 1,
        'runs' => (previous.fetch('runs') + [occurrence(run)]).last(HISTORY) }
    end

    def seen?(state, run)
      state.fetch('runs').any? { |entry| entry.fetch('id') == run.fetch('id') }
    end

    def parse(body)
      match = MARKER.match(body.to_s)
      match.nil? ? nil : JSON.parse(match[:state])
    end

    def marker(state)
      "<!-- failure-alert:v1 #{JSON.generate(state)} -->"
    end

    def started(run)
      run.fetch('run_started_at')
    end

    def occurrence(run)
      { 'id' => run.fetch('id'), 'started' => started(run) }
    end
  end
end
