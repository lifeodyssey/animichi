# frozen_string_literal: true

require_relative "test_helper"
require_relative "runtime_fixtures"

class CleanupRuntimeFenceTest < Minitest::Test
  include HeadlessFixture
  include RuntimeFixtures
  include CleanupTestFixture

  MUTATION_REQUESTS = %w[worker-release-request.json terminal-close-request.json].freeze

  STAGES = [
    { name: "worker_inspection", label: "worker inspection", position: 0, calls: 1, mutations: 0 },
    { name: "terminal_inspection", label: "terminal inspection", position: 1, calls: 2, mutations: 0 },
    { name: "run_inspection", label: "run inspection", position: 2, calls: 3, mutations: 0 },
    { name: "settlement_inspection", label: "settlement inspection", position: 3, calls: 4,
      mutations: 0 },
    { name: "worker_release", label: "worker release", position: 4, calls: 5, mutations: 1 },
    { name: "terminal_close", label: "terminal close", position: 6, calls: 7, mutations: 2 }
  ].freeze

  def setup
    super
    write_positive_exit_receipts
  end

  STAGES.each do |stage|
    define_method("test_refuses_#{stage[:name]}_from_another_runtime") do
      assert_refused_foreign_runtime(stage)
    end
  end

  private

  def assert_refused_foreign_runtime(stage)
    runner = foreign_runtime_runner(stage)
    code, _out, err = invoke(cleanup_args, runner)
    assert_equal 1, code
    assert_match(/#{stage[:label]} came from another or unknown runtime/, err)
    assert_equal stage[:calls], runner.calls.length
    assert_attempted_mutations(stage[:mutations])
  end

  def foreign_runtime_runner(stage)
    responses = cleanup_responses
    responses[stage[:position]] = foreign_runtime(responses[stage[:position]])
    FakeCommandRunner.new(responses.map { |item| command_result(item) })
  end

  def cleanup_responses
    [worker_show_response("completed", "succeeded"), terminal_show_response, run_show_response,
     settlement_response, release_response, terminal_show_response, close_response]
  end

  def foreign_runtime(response)
    response.merge("_meta" => { "runtimeId" => "runtime-foreign" })
  end

  def assert_attempted_mutations(count)
    attempted = MUTATION_REQUESTS.select { |request| File.exist?(state_path(request)) }
    assert_equal MUTATION_REQUESTS.take(count), attempted
  end

  def state_path(request)
    File.join(@state, request)
  end
end
