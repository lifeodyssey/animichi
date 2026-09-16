# frozen_string_literal: true
require_relative 'state'
require 'json'

module FailureAlert
  # The dedup identity of a failure and what to do about it (#678 AC1). The
  # identity is workflow + ref + the set of failing jobs: two runs that break the
  # same way are one alert, while a different failing-job set is a different
  # failure and gets its own alert. A run already recorded on its alert resolves
  # to noop, so re-running a failed run publishes nothing at all.
  #
  # The key is a JSON array whose third element is the failing-job list itself,
  # not a string joined from the names. JSON quotes and escapes every name and
  # delimits list elements structurally, so two different name lists are two
  # different keys for *any* names: no separator has to be assumed absent from
  # them, and a single job literally named `a + b` is not the pair `a`, `b`
  # (#678 review).
  module Plan
    CREATE = 'create'
    UPDATE = 'update'
    NOOP = 'noop'

    module_function

    def key(workflow, ref, signature)
      JSON.generate([workflow, ref, signature])
    end

    def decide(workflow:, ref:, signature:, alerts:, run:)
      key = key(workflow, ref, signature)
      previous = alerts.find { |alert| alert.dig('state', 'key') == key }
      return { 'action' => CREATE, 'key' => key, 'state' => State.fresh(run, key) } if previous.nil?
      recorded(previous, run, key)
    end

    def recorded(previous, run, key)
      state = State.record(previous.fetch('state'), run)
      action = state == previous.fetch('state') ? NOOP : UPDATE
      { 'action' => action, 'key' => key, 'issue' => previous.fetch('number'), 'state' => state }
    end
  end
end
