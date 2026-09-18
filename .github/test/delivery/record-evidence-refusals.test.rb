# SUT: .github/scripts/release/record-evidence.mjs's refusals (#1695 requirement 2)
# — the credentials this lane must never hold, the origin a service token must
# never reach, and the origin spelling held to the contract module it mirrors.
require 'minitest/autorun'
require_relative 'fixtures/release/deploy-evidence/harness'

class PostDeployEvidenceRefusalsTest < Minitest::Test
  include DeployEvidenceHarness

  def teardown
    cleanup_evidence
  end

  def self.contract
    File.join(DeployEvidenceHarness::ROOT, 'packages/contract/src/access-service-token.ts')
  end

  # Half a service token is refused BY NAME: Access answers it as a login page,
  # which reads as a broken deploy rather than as a missing export.
  def test_half_a_service_token_is_refused_by_name_before_anything_is_sent
    evidence_dir
    start_origin
    out, err, status = record('CF_ACCESS_CLIENT_ID' => 'id.access')
    refute status.success?
    assert_empty out
    assert_includes err, 'CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET must be declared together'
    refute File.exist?(File.join(@dir, 'evidence.json')), 'a refused run must publish nothing'
    assert_empty origin_requests
  end

  def test_the_service_token_is_never_sent_to_a_loopback_origin
    evidence_dir
    start_origin
    out, err, status = record('CF_ACCESS_CLIENT_ID' => 'id.access', 'CF_ACCESS_CLIENT_SECRET' => 'not-a-real-secret')
    refute status.success?
    assert_empty out
    assert_includes err, 'never sent to a loopback origin'
    assert_empty origin_requests.reject { |line| line.include?('access=false') }
  end

  # A write-capable identity is the one credential this lane must never hold: a
  # Neon Auth bearer opens turns and adopts sessions.
  def test_a_signed_in_identity_is_refused_outright
    evidence_dir
    start_origin
    out, err, status = record('AGENT_TURN_BEARER' => 'not-a-real-bearer')
    refute status.success?
    assert_empty out
    assert_includes err, 'must never carry a signed-in staging identity'
    refute File.exist?(File.join(@dir, 'evidence.json'))
  end

  # The loopback list is spelled twice — once in TypeScript, once in the shell
  # and now once in the recorder — so the spellings are held to each other.
  def test_the_loopback_grammar_matches_the_contract_module
    recorder = File.read(DeployEvidenceHarness::RECORDER)
    contract = File.read(self.class.contract)
    %w[localhost .localhost [::1] [::] 0.0.0.0 127.].each do |literal|
      assert_includes recorder, literal
      assert_includes contract, literal
    end
    %w[CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET CF-Access-Client-Id CF-Access-Client-Secret].each do |literal|
      assert_includes recorder, literal
      assert_includes contract, literal
    end
  end
end
