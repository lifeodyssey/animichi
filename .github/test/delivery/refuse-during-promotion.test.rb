# SUT: .github/scripts/release/refuse-during-promotion.rb — the production topology workflow's
# refusal while a full promotion is running. It reads every unfinished CD run by status, the parked
# statuses before the running ones, then each run's latest jobs, and refuses on a `CD / production`
# job that is `in_progress`, `queued` or `requested`, on an unreadable listing, and on a listing
# longer than the one page it reads. A job at its approval prompt (`waiting`) or behind the
# `cd-production` group (`pending`) cannot run without the owner's approval, so it does not refuse.
# frozen_string_literal: true
require 'minitest/autorun'
require 'open3'
require 'tmpdir'
require 'fileutils'
require_relative '../repository-yaml'
require_relative 'support/github-api-fixture'

class RefuseDuringPromotionTest < Minitest::Test
  ACTIONS = 'repos/lifeodyssey/animichi/actions'
  UNFINISHED = %w[queued in_progress waiting requested pending].freeze
  # The name GitHub reports for cd.yml's production job, read from cd.yml itself: renaming that job
  # without the script turns the refusals below red instead of letting the check pass unseen.
  PROMOTION = RepositoryYaml.load_file(File.expand_path('../../workflows/cd.yml', __dir__))
                            .dig('jobs', 'promote-production', 'name')

  def setup
    @root = Dir.mktmpdir
    GithubApiFixture.install(@root)
    UNFINISHED.each { |status| serve_runs(status, []) }
    @environment = { 'PATH' => "#{@root}:#{ENV.fetch('PATH')}", 'GH_HOST' => 'github.invalid',
                     'SSH_AUTH_SOCK' => nil, 'GIT_SSH_COMMAND' => 'false' }
  end

  def teardown
    FileUtils.remove_entry(@root)
  end

  def runs_path(status)
    "#{ACTIONS}/workflows/cd.yml/runs?status=#{status}&per_page=100"
  end

  def jobs_path(id)
    "#{ACTIONS}/runs/#{id}/jobs?filter=latest&per_page=100"
  end

  def runs(listed, total = listed.length)
    { 'total_count' => total, 'workflow_runs' => listed }
  end

  def jobs(pairs)
    listing = pairs.map { |name, status| { 'name' => name, 'status' => status } }
    { 'total_count' => listing.length, 'jobs' => listing }
  end

  def serve_runs(status, listed, total = listed.length)
    GithubApiFixture.serve(@root, runs_path(status), runs(listed, total))
  end

  # A CD run whose latest attempt holds these jobs, each a name and a status.
  def cd_run(id, pairs)
    GithubApiFixture.serve(@root, jobs_path(id), jobs(pairs))
    { 'id' => id, 'html_url' => "https://github.com/lifeodyssey/animichi/actions/runs/#{id}" }
  end

  # A promotion parked at its prompt, approved the moment the `running` listing has been read: from
  # then on GitHub lists the run under `running` and reports its job so.
  def approve_after_listing(running)
    parked = cd_run(16, [[PROMOTION, 'waiting']])
    serve_runs('waiting', [parked])
    GithubApiFixture.serve_after(@root, runs_path(running), runs_path('waiting') => runs([]),
                                                            runs_path(running) => runs([parked]),
                                                            jobs_path(16) => jobs([[PROMOTION, running]]))
  end

  def check
    entry = File.expand_path('../../scripts/release/refuse-during-promotion.rb', __dir__)
    Open3.capture3(@environment, 'ruby', entry, chdir: @root)
  end

  # A refusal naming the run whose promotion is running, and that job's status.
  def assert_refused_naming(id, job_status)
    _output, error, status = check
    refute status.success?, 'a running promotion did not refuse'
    assert_includes error, 'refuse-during-promotion: a full promotion is running: ' \
                           "https://github.com/lifeodyssey/animichi/actions/runs/#{id} (#{job_status})"
  end

  def test_a_running_production_job_refuses_and_names_its_run
    serve_runs('in_progress', [cd_run(8, [[PROMOTION, 'in_progress']])])
    assert_refused_naming 8, 'in_progress'
  end

  def test_a_production_job_queued_for_a_runner_refuses_and_names_its_run
    serve_runs('queued', [cd_run(10, [[PROMOTION, 'queued']])])
    assert_refused_naming 10, 'queued'
  end

  def test_a_requested_production_job_refuses_and_names_its_run
    serve_runs('requested', [cd_run(11, [[PROMOTION, 'requested']])])
    assert_refused_naming 11, 'requested'
  end

  def test_a_production_job_awaiting_approval_does_not_refuse
    serve_runs('waiting', [cd_run(7, [['CD / staging', 'completed'], [PROMOTION, 'waiting']])])
    _output, error, status = check
    assert status.success?, error
  end

  def test_a_production_job_pending_behind_the_group_does_not_refuse
    serve_runs('pending', [cd_run(9, [[PROMOTION, 'pending']])])
    _output, error, status = check
    assert status.success?, error
  end

  # A listed run status is a snapshot, and the job read after it decides.
  def test_a_promotion_started_after_its_run_was_listed_as_pending_refuses
    serve_runs('pending', [cd_run(15, [[PROMOTION, 'in_progress']])])
    assert_refused_naming 15, 'in_progress'
  end

  # An approval between two listings: read before every running listing, the waiting listing still
  # holds the run, and its job's own status refuses. Read after one, the run would be in neither.
  def test_a_promotion_approved_after_the_in_progress_listing_refuses
    approve_after_listing('in_progress')
    assert_refused_naming 16, 'in_progress'
  end

  def test_a_promotion_approved_after_the_queued_listing_refuses
    approve_after_listing('queued')
    assert_refused_naming 16, 'queued'
  end

  def test_a_promotion_approved_after_the_requested_listing_refuses
    approve_after_listing('requested')
    assert_refused_naming 16, 'requested'
  end

  def test_an_unreadable_listing_refuses
    @environment['GH_EXIT'] = '1'
    _output, error, status = check
    refute status.success?
    assert_match %r{refuse-during-promotion: gh api #{ACTIONS}/workflows/cd\.yml/runs\?status=\w+&per_page=100 failed}, error
  end

  def test_a_listing_longer_than_one_page_refuses
    serve_runs('waiting', [], 101)
    _output, error, status = check
    refute status.success?
    assert_includes error, 'refuse-during-promotion: over 100 waiting CD runs'
  end

  def test_a_staging_job_in_flight_does_not_refuse
    serve_runs('in_progress', [cd_run(12, [['CD / select artifact', 'completed'], ['CD / staging', 'in_progress']])])
    _output, error, status = check
    assert status.success?, error
  end

  def test_a_finished_production_job_in_an_unfinished_run_does_not_refuse
    serve_runs('in_progress', [cd_run(13, [[PROMOTION, 'completed'], ['Ops / failure alert', 'in_progress']])])
    _output, error, status = check
    assert status.success?, error
  end

  def test_no_unfinished_cd_run_does_not_refuse
    _output, error, status = check
    assert status.success?, error
  end
end
