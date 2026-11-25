# frozen_string_literal: true
require 'json'
require 'open3'
require_relative '../../lib/release/selection'

# Refuses a production topology run while a full promotion is running (ADR 0010): a cd.yml
# `CD / production` job that is `in_progress`, `queued` or `requested`. A job at its approval prompt
# (`waiting`) or behind the `cd-production` group (`pending`) cannot run without the owner's approval,
# so it does not refuse. The topology workflow holds its own concurrency group, not `cd-production`,
# so this read is what keeps it from overlapping a full promotion: every unfinished cd.yml run, listed
# under each unfinished status GitHub reports, then the jobs of its latest attempt. A listed status is
# a snapshot, so the job's own status decides; a listing longer than the one page read refuses.
# Parked statuses are listed before running ones: an approval that moves a run out of `waiting`
# during the check leaves it in the waiting listing, already read, or puts it in a running listing
# read after it. A pending job reaches the prompt before it can run, so `pending` is read first.
# The transport is resolve.rb's; the jobs read is the failure alert's (`.github/lib/alert/api.rb`).
UNFINISHED = %w[pending waiting requested queued in_progress].freeze
RUNNING = %w[in_progress queued requested].freeze
PROMOTION = 'CD / production'
PAGE = 100
ACTIONS = "repos/#{ReleaseSelection::REPOSITORY}/actions"

def github_api(path)
  output, status = Open3.capture2('gh', 'api', '-H', 'X-GitHub-Api-Version: 2026-03-10', path)
  abort "refuse-during-promotion: gh api #{path} failed" unless status.success?
  JSON.parse(output)
end

def unfinished_runs
  UNFINISHED.flat_map do |status|
    listing = github_api("#{ACTIONS}/workflows/cd.yml/runs?status=#{status}&per_page=#{PAGE}")
    next listing.fetch('workflow_runs') if listing.fetch('total_count') <= PAGE

    abort "refuse-during-promotion: over #{PAGE} #{status} CD runs, and one page cannot show none is a promotion"
  end.uniq { |run| run.fetch('id') }
end

def promotions(run)
  github_api("#{ACTIONS}/runs/#{run.fetch('id')}/jobs?filter=latest&per_page=#{PAGE}").fetch('jobs')
    .select { |job| job.fetch('name') == PROMOTION && RUNNING.include?(job.fetch('status')) }
    .map { |job| "#{run.fetch('html_url')} (#{job.fetch('status')})" }
end

active = unfinished_runs.flat_map { |run| promotions(run) }
abort "refuse-during-promotion: a full promotion is running: #{active.join(', ')}" unless active.empty?
puts "refuse-during-promotion: no #{PROMOTION} job is running"
