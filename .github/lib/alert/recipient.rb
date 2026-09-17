# frozen_string_literal: true
require_relative 'api'

module FailureAlert
  # Who a published alert reaches (#1718 AC2). An issue opened by the run's own
  # token with no assignee and no label notifies nobody by default, and #1715 leaves
  # this alert as the only signal standing between a red merge and a production
  # approval, so the alert has to name the person it is for.
  #
  # That name is the repository's owner, read from the slug the run is already given
  # rather than written down here: the owner is the account that necessarily holds
  # the push access GitHub requires before it keeps an assignee, and reading it means
  # a transfer or rename cannot leave every future alert pointing at an account that
  # no longer owns the repository. The repository carries no `CODEOWNERS` file to
  # read instead, and a label would be repository configuration this mechanism
  # cannot create for itself (see `api.rb`).
  module Recipient
    module_function

    def logins
      [FailureAlert::Api.repo.split('/').first]
    end

    # The create response is the only witness that the audience survived: `POST
    # /issues` answers 201 and silently drops an assignee the caller may not set, so
    # an unverified channel would publish an issue that reaches nobody and looks
    # exactly like one that reached someone. Fail the step instead.
    def confirm(issue, payload)
      requested = Array(payload['assignees'])
      accepted = logins_of(issue)
      return if requested.any? && (requested - accepted).empty?
      abort "failure-alert: issue ##{issue.fetch('number')} notifies nobody: " \
            "requested #{requested.inspect}, the issue carries #{accepted.inspect}"
    end

    def logins_of(issue)
      Array(issue['assignees']).map { |user| user['login'] }
    end
  end
end
