# SUT: .github/lib/release/observations.mjs — observed container identities match
# the selected Worker and immutable image.
# frozen_string_literal: true
require 'minitest/autorun'
require 'json'
require 'tmpdir'
require 'fileutils'
require 'open3'

class ReleaseContainerObservationTest < Minitest::Test
  READ = 'read'
  SLEEP = 'sleep'
  READ_FAILURE = 'containers info 11111111-1111-4111-8111-111111111111 did not answer within 1000ms'

  def setup
    @image = "registry.cloudflare.com/#{'a' * 32}/animichi-agent@sha256:#{'d' * 64}"
    @container = { 'name' => 'agent-staging', 'class_name' => 'AgentContainer' }
    @application = { 'id' => '11111111-1111-4111-8111-111111111111', 'name' => 'agent-staging',
                     'configuration' => { 'image' => @image }, 'durable_objects' => { 'namespace_id' => 'owned-namespace' } }
    @binding = { 'type' => 'durable_object_namespace', 'class_name' => 'AgentContainer', 'namespace_id' => 'owned-namespace' }
    @version = { 'resources' => { 'bindings' => [@binding] } }
    @dir = Dir.mktmpdir('release-container-observation-')
    @log = File.join(@dir, 'poll.log')
  end

  def teardown
    FileUtils.remove_entry(@dir)
  end

  def library
    File.expand_path('../../lib/release/observations.mjs', __dir__)
  end

  def observe
    source = "import {containerIdentity} from #{library.to_json}; const input=JSON.parse(process.argv[1]); console.log(JSON.stringify(containerIdentity(...input)))"
    Open3.capture3('node', '--input-type=module', '-e', source, [@application, @version, @container, @image, 'edge-staging'].to_json)
  end

  # Drives the bounded wait with a fake reader that serves `outcomes` in order and
  # repeats the last one, plus a fake sleep, so nothing here depends on wall time.
  # A nil outcome is a read the caller's timeout killed: the reader raises instead
  # of answering. Every read and sleep is appended to a log the test asserts on.
  def poll(outcomes, attempts: 3, delay_ms: 1000)
    source = <<~JS
      import {appendFileSync} from 'node:fs';
      import {awaitContainerImage, containerIdentity} from #{library.to_json};
      const input = JSON.parse(process.argv[1]);
      let reads = 0;
      const read = () => {
        appendFileSync(input.log, 'read\\n');
        const outcome = input.outcomes[Math.min(reads++, input.outcomes.length - 1)];
        if (outcome === null) throw new Error(input.readFailure);
        return {...input.application, configuration: {image: outcome}};
      };
      const sleep = () => appendFileSync(input.log, 'sleep\\n');
      const application = awaitContainerImage(read, input.image, {attempts: input.attempts, delayMs: input.delayMs, sleep});
      console.log(JSON.stringify(containerIdentity(application, input.version, input.container, input.image, 'edge-staging')));
    JS
    payload = { 'application' => @application, 'version' => @version, 'container' => @container, 'image' => @image,
                'outcomes' => outcomes, 'readFailure' => READ_FAILURE, 'attempts' => attempts, 'delayMs' => delay_ms, 'log' => @log }
    Open3.capture3('node', '--input-type=module', '-e', source, payload.to_json)
  end

  def poll_trace
    File.readlines(@log).map(&:strip)
  end

  def previous_image
    @image.sub('d' * 64, 'e' * 64)
  end

  def test_accepts_native_script_local_durable_object_binding
    output, error, status = observe
    assert status.success?, error
    assert_equal 'owned-namespace', JSON.parse(output).fetch('namespace_id')
    assert_equal @image, JSON.parse(output).fetch('image')
  end

  def test_refuses_application_from_another_namespace
    @application['durable_objects']['namespace_id'] = 'other-namespace'
    refute observe.last.success?
  end

  def test_refuses_container_from_another_worker_script
    @binding['script_name'] = 'edge-production'
    refute observe.last.success?
  end

  def test_refuses_another_container_class
    @binding['class_name'] = 'OtherContainer'
    refute observe.last.success?
  end

  def test_refuses_the_same_application_name_running_another_digest
    @application['configuration']['image'] = @image.sub('d' * 64, 'e' * 64)
    refute observe.last.success?
  end

  def test_refuses_the_same_namespace_under_another_application_name
    @application['name'] = 'agent-production'
    refute observe.last.success?
  end

  def test_refuses_missing_platform_application_identity
    @application.delete('id')
    refute observe.last.success?
  end

  # #1683: `wrangler containers info` reports the configuration the scheduler is
  # still replacing, so a receipt read straight after the publish sees the
  # previous digest and the container identity must be polled to convergence.
  def test_records_the_selected_image_after_the_application_converges
    output, error, status = poll([previous_image, previous_image, @image], attempts: 5)
    assert status.success?, error
    assert_equal({ 'application_id' => @application['id'], 'name' => @application['name'],
                   'image' => @image, 'namespace_id' => 'owned-namespace' }, JSON.parse(output))
    assert_equal [READ, SLEEP, READ, SLEEP, READ], poll_trace
  end

  # #1683 review: the first read is immediate, so `attempts` reads contain only
  # `attempts - 1` waits. The failure message must state that implemented number:
  # the declared production wait is 12 reads and 11 x 15 s = 165 s, not 180 s.
  def test_unconverged_application_fails_with_both_digests_and_the_implemented_budget
    output, error, status = poll([previous_image], attempts: 12, delay_ms: 15_000)
    refute status.success?
    assert_equal ([READ, SLEEP] * 11) + [READ], poll_trace
    assert_empty output
    assert_includes error, "expected #{@image}"
    assert_includes error, "last observed #{previous_image}"
    assert_includes error, '12 attempts'
    assert_includes error, '165s wait budget'
  end

  # #1683 review: `wrangler containers info` is run under a bounded timeout, and
  # a read that timeout kills is one failed attempt — the poll re-reads — rather
  # than a crash that ends the receipt.
  def test_a_killed_read_is_one_failed_attempt_and_the_poll_re_reads
    output, error, status = poll([nil, nil, @image], attempts: 4)
    assert status.success?, error
    assert_equal @image, JSON.parse(output).fetch('image')
    assert_equal [READ, SLEEP, READ, SLEEP, READ], poll_trace
  end

  def test_reads_that_never_answer_are_never_reported_as_converged
    output, error, status = poll([nil], attempts: 3)
    refute status.success?
    assert_empty output
    assert_equal [READ, SLEEP, READ, SLEEP, READ], poll_trace
    assert_includes error, "expected #{@image}"
    assert_includes error, 'last observed none'
    assert_includes error, READ_FAILURE
  end

  def test_a_killed_read_keeps_the_last_observed_digest_in_the_diagnostic
    output, error, status = poll([previous_image, nil], attempts: 2)
    refute status.success?
    assert_empty output
    assert_includes error, "last observed #{previous_image}"
    assert_includes error, READ_FAILURE
  end

  def test_convergence_never_trades_away_the_namespace_check
    @application['durable_objects']['namespace_id'] = 'other-namespace'
    _output, error, status = poll([previous_image, @image], attempts: 3)
    refute status.success?
    assert_includes error, 'container belongs to another Worker'
  end
end
