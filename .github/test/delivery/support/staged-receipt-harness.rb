# frozen_string_literal: true
# The world `verify-staged-receipt.test.rb` drives the committed script in: a controller checkout
# whose history holds the commit an earlier CD run staged from, the selected snapshot's files, that
# run's staging receipt, and the GitHub metadata of the receipt artifact, its run attempt and its
# workflow, served through the `gh` fixture. A case changes one document and runs a phase.
#
# Not a `*.test.rb`, so `workflow-invocations.test.rb` does not ask PR verification to invoke it;
# the contract `require_relative`s it instead.
require 'minitest/autorun'
require 'json'
require 'open3'
require 'tmpdir'
require 'fileutils'
require_relative 'github-api-fixture'
require_relative '../fixtures/release/receipt-workers'

class StagedReceiptCase < Minitest::Test
  ACTIONS = 'repos/lifeodyssey/animichi/actions'
  ENTRY = File.expand_path('../../../scripts/release/verify-staged-receipt.rb', __dir__)
  CLOCK = 'entry = ARGV.shift; Time.stub(:now, Time.utc(2026, 11, 25)) { load entry }'
  PRISMA = 'b' * 64
  REPOSITORY = { 'id' => 11, 'full_name' => 'lifeodyssey/animichi' }.freeze

  def setup
    @root = Dir.mktmpdir
    @bin = File.join(@root, 'bin')
    FileUtils.mkdir_p(@bin)
    GithubApiFixture.install(@bin)
    @staged_controller, @controller = controller_history
    @selection = selected_snapshot
    @receipt = staging_receipt
    @artifact, @run, @workflow = receipt_metadata
    @environment = fixture_environment
  end

  def teardown
    FileUtils.remove_entry(@root)
  end

  # Main's history: the commit an earlier CD run staged from, then this controller's own.
  def controller_history
    git('init', '--initial-branch=main')
    [commit('staged'), commit('controller')]
  end

  # What the workflow hands the script, with `gh` answering from the fixture and git kept off the network.
  def fixture_environment
    { 'PATH' => "#{@bin}:#{ENV.fetch('PATH')}", 'RECEIPT_ID' => '20', 'GITHUB_SHA' => @controller,
      'GITHUB_REPOSITORY_ID' => '11', 'GITHUB_OUTPUT' => File.join(@root, 'outputs'),
      'GH_HOST' => 'github.invalid', 'SSH_AUTH_SOCK' => nil, 'GIT_SSH_COMMAND' => 'false' }
  end

  # A phase that refuses, for the reason the check it names gives.
  def assert_refused(phase, reason)
    _output, error, status = phase
    refute status.success?, "accepted; expected the refusal: #{reason}"
    assert_includes error, reason
  end

  def git(*arguments)
    output, error, status = Open3.capture3('git', *arguments, chdir: @root)
    raise error unless status.success?
    output.strip
  end

  def commit(label)
    File.write(File.join(@root, 'source.txt'), label)
    git('add', 'source.txt')
    git('-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid', 'commit', '-m', label)
    git('rev-parse', 'HEAD')
  end

  # A commit on a root of its own: a SHA this controller's history does not contain.
  def unrelated_commit
    git('checkout', '--orphan', 'side')
    commit('side').tap { git('checkout', 'main') }
  end

  def selected_snapshot
    { 'artifact_id' => '7', 'artifact_digest' => "sha256:#{'d' * 64}", 'source_sha' => 'a' * 40, 'run_id' => '5',
      'run_attempt' => '1', 'repository' => 'lifeodyssey/animichi', 'controller_sha' => @controller }
  end

  # What attempt 1 of CD run 9 recorded after its smoke, under the controller it ran from.
  def staging_receipt
    applied = { 'targetHash' => PRISMA, 'markerHash' => PRISMA, 'migrations' => [], 'usedLiveMarker' => true }
    { 'format' => 1, 'environment' => 'staging', 'selection' => @selection.merge('controller_sha' => @staged_controller),
      'images' => {}, 'controller_run_id' => '9', 'controller_run_attempt' => '1', 'smoke' => 'passed',
      'schema' => { 'compatible' => true, 'prisma' => applied }, 'workers' => ReleaseReceiptWorkersFixture.workers }
  end

  def receipt_metadata
    [{ 'id' => 20, 'name' => 'staging-receipt-9-1', 'expired' => false, 'expires_at' => '2026-12-01T00:00:00Z',
       'digest' => "sha256:#{'e' * 64}", 'workflow_run' => { 'id' => 9 } },
     { 'id' => 9, 'workflow_id' => 31, 'run_attempt' => 1, 'head_branch' => 'main',
       'repository' => REPOSITORY.dup, 'head_repository' => REPOSITORY.dup },
     { 'id' => 31, 'path' => '.github/workflows/cd.yml' }]
  end

  def write_json(path, document)
    FileUtils.mkdir_p(File.dirname(File.join(@root, path)))
    File.write(File.join(@root, path), document.to_json)
  end

  # One more read the `gh` fixture answers, under the repository's Actions API.
  def serve(path, body)
    GithubApiFixture.serve(@bin, "#{ACTIONS}/#{path}", body)
  end

  def write_world
    serve('artifacts/20', @artifact)
    serve('runs/9/attempts/1', @run)
    serve('workflows/31', @workflow)
    write_json('selection.json', @selection)
    write_json('release/release.json', { 'images' => {} })
    write_json('release/migrator/bundle/contract.json', { 'storage' => { 'storageHash' => PRISMA } })
    write_json('staging-receipt/receipt.json', @receipt)
  end

  # The phase before the download: the artifact, its producer and its expiry, at a fixed clock.
  def metadata
    write_world
    Open3.capture3(@environment, 'ruby', '-rminitest/mock', '-e', CLOCK, ENTRY, 'metadata', chdir: @root)
  end

  # Both phases, as the workflow runs them; a content case is void unless the metadata passed.
  def verify
    _output, error, status = metadata
    assert status.success?, "the metadata phase refused before the content phase ran: #{error}"
    Open3.capture3(@environment, 'ruby', ENTRY, 'content', chdir: @root)
  end
end
