# SUT: .github/lib/release/observations.mjs — observed Worker deployments identify
# one fully deployed selected version, a refused observation names the Worker it
# read, and the migrator's schema view names the packaged contract with nothing
# left to apply.
# frozen_string_literal: true
require 'minitest/autorun'
require 'json'
require 'open3'

class ReleaseObservationTest < Minitest::Test
  def setup
    @source = 'b' * 40
    @deployment = { 'id' => '11111111-1111-4111-8111-111111111111',
                    'versions' => [{ 'version_id' => '22222222-2222-4222-8222-222222222222', 'percentage' => 100 }] }
    @version = { 'id' => '22222222-2222-4222-8222-222222222222', 'annotations' => { 'workers/tag' => "sha-#{@source}" } }
    # The staging edge: its unit and its script name share no word, so a message
    # carrying only one of them cannot pass for a message carrying both.
    @unit = 'api'
    @script_name = 'animichi-staging'
  end

  def observe
    file = File.expand_path('../../lib/release/observations.mjs', __dir__)
    source = "import {deploymentIdentity} from #{file.to_json}; const input=JSON.parse(process.argv[1]); console.log(JSON.stringify(deploymentIdentity(...input)))"
    Open3.capture3('node', '--input-type=module', '-e', source, [@deployment, @version, @source, @unit, @script_name].to_json)
  end

  # #2126: a refusal used to say why but not which of the five Workers it read.
  # Each test below holds one assertion's whole message, the reason and the names.
  def refusal
    _output, error, status = observe
    refute status.success?
    error
  end

  def test_records_distinct_script_scoped_actual_ids
    output, error, status = observe
    assert status.success?, error
    assert_equal @version['id'], JSON.parse(output).fetch('version_id')
    assert_equal @deployment['id'], JSON.parse(output).fetch('deployment_id')
  end

  def test_refuses_a_deployment_without_an_actual_id
    @deployment.delete('id')
    assert_includes refusal, 'missing actual deployment ID (unit api, script animichi-staging)'
  end

  def test_refuses_a_version_without_an_actual_id
    @version.delete('id')
    assert_includes refusal, 'missing actual version ID (unit api, script animichi-staging)'
  end

  def test_refuses_a_different_live_release_tag
    @version['annotations']['workers/tag'] = "sha-#{'c' * 40}"
    assert_includes refusal, 'live Worker is not the selected source (unit api, script animichi-staging)'
  end

  def test_refuses_split_traffic
    @deployment['versions'].first['percentage'] = 50
    assert_includes refusal, 'release must serve all traffic (unit api, script animichi-staging)'
  end

  def test_refuses_a_version_from_a_different_deployment
    @version['id'] = '33333333-3333-4333-8333-333333333333'
    assert_includes refusal, 'release must serve all traffic (unit api, script animichi-staging)'
  end

  # The receipt's schema view: the migrator's `/preflight` answer read after the apply. The
  # workerd suite feeds the same check the migrator's real answer
  # (`workers/migrator/test/integration/prisma.workerd.integration.ts`).
  def applied_view
    { 'compatible' => true,
      'prisma' => { 'targetHash' => PRISMA_REF, 'markerHash' => PRISMA_REF, 'migrations' => [], 'usedLiveMarker' => true } }
  end

  def observe_schema(schema)
    file = File.expand_path('../../lib/release/observations.mjs', __dir__)
    source = "import {appliedSchema} from #{file.to_json}; appliedSchema(JSON.parse(process.argv[1]), process.argv[2])"
    Open3.capture3('node', '--input-type=module', '-e', source, schema.to_json, PRISMA_REF)
  end

  PRISMA_REF = 'd' * 64

  def test_accepts_a_schema_view_naming_the_packaged_contract_with_nothing_pending
    _output, error, status = observe_schema(applied_view)
    assert status.success?, error
  end

  def test_refuses_a_schema_view_that_never_read_the_live_marker
    view = applied_view
    view['prisma']['usedLiveMarker'] = false
    refute observe_schema(view).last.success?
  end

  def test_refuses_a_schema_view_with_migrations_still_pending
    view = applied_view
    view['prisma'] = view['prisma'].merge('markerHash' => 'empty', 'migrations' => [{ 'dirName' => 'baseline' }])
    refute observe_schema(view).last.success?
  end
end
