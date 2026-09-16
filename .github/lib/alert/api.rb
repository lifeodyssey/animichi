# frozen_string_literal: true
require 'json'
require 'open3'

module FailureAlert
  # The GitHub REST transport, through the same authenticated `gh api` the release
  # controller uses (`resolve.rb`). Every call is fatal on failure: an alert
  # channel that cannot publish must not look green (#678 AC1). Nothing here
  # reads a GitHub secret — the token is the run's own `github.token`.
  #
  # The ledger is found by reading open issues and matching the marker in their
  # bodies, not by a label. A label is repository configuration this mechanism
  # would then depend on and cannot create for itself, and `POST /issues` rejects
  # an unknown label with 422 — an alerting channel that stops alerting because a
  # label is missing is worse than no channel. Scanning costs one page on a
  # failure path and needs nothing configured.
  module Api
    VERSION = 'X-GitHub-Api-Version: 2026-03-10'
    PAGE = 100
    # A bound, not a policy: the repository holds ~250 open issues. Past it the
    # ledger is refused loudly rather than silently truncated, because a partial
    # ledger cannot tell a repeat from a new failure and would double-alert.
    MAX_PAGES = 10

    module_function

    def repo
      ENV.fetch('GITHUB_REPOSITORY')
    end

    def run_id
      ENV.fetch('GITHUB_RUN_ID')
    end

    def run
      get("repos/#{repo}/actions/runs/#{run_id}")
    end

    def jobs
      get("repos/#{repo}/actions/runs/#{run_id}/jobs?filter=latest&per_page=#{PAGE}")
    end

    def open_issues
      issues = []
      page = 1
      loop do
        batch = get("repos/#{repo}/issues?state=open&per_page=#{PAGE}&page=#{page}")
        issues.concat(batch)
        break if batch.length < PAGE
        abort "failure-alert: over #{MAX_PAGES * PAGE} open issues; the alert ledger cannot be read safely" if page >= MAX_PAGES
        page += 1
      end
      issues
    end

    def create_issue(payload)
      send_json('POST', "repos/#{repo}/issues", payload)
    end

    def update_issue(payload, number)
      send_json('PATCH', "repos/#{repo}/issues/#{number}", payload.slice('body'))
    end

    def get(path)
      output, status = Open3.capture2('gh', 'api', '-H', VERSION, path)
      abort "failure-alert: gh api #{path} failed" unless status.success?
      JSON.parse(output)
    end

    def send_json(method, path, payload)
      output, status = Open3.capture2('gh', 'api', '-X', method, '-H', VERSION, path, '--input', '-',
                                      stdin_data: JSON.generate(payload))
      abort "failure-alert: gh api #{method} #{path} failed" unless status.success?
      JSON.parse(output)
    end
  end
end
