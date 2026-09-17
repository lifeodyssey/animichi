# SUT: the two mutations that make the deploy-evidence mechanism proven rather
# than merely green — a published receipt that does not match what was deployed,
# and a credential-shaped value in the artifact (#1695).
#
# Every mutation is applied to a temp-dir fixture and restored byte-identically
# (the digest is compared across the restore), so neither the committed scripts
# nor a live release directory is ever written to.
require 'minitest/autorun'
require_relative 'fixtures/release/deploy-evidence/harness'

class PostDeployEvidenceMutationTest < Minitest::Test
  include DeployEvidenceHarness

  GITHUB_TOKEN_SHAPE = "ghp_#{'A' * 36}"
  OTHER_VERSION = "#{'4' * 8}-4444-4444-8444-#{'4' * 12}"
  DECLARED_TOKEN = 'cf-dummy-token-value-1234567890'

  def teardown
    cleanup_evidence
  end

  def recorded
    evidence_dir
    start_origin
    _out, err, status = record
    assert status.success?, err
    verify('--card', '1596', '--ac', 'AC5')
  end

  def mutate(path)
    @original = File.read(path)
    @digest = Digest::SHA256.hexdigest(@original)
    File.write(path, yield(@original))
  end

  def restore(path)
    File.write(path, @original)
    assert_equal @digest, Digest::SHA256.hexdigest(File.read(path)), 'the restore must be byte-identical'
  end

  # Mutation 1: the deploy publishes a receipt that does not match what was
  # deployed. The transcript's own platform read-back disagrees, and the check
  # names both versions rather than reporting a healthy release.
  def test_a_receipt_that_names_another_version_goes_red_and_restores_green
    out, err, status = recorded
    assert status.success?, err
    receipt = File.join(@dir, 'receipt.json')
    mutate(receipt) { |source| source.sub(VERSION, OTHER_VERSION) }
    out, _err, status = verify('--card', '1596', '--ac', 'AC5')
    refute status.success?, 'a receipt that does not match the deployment must not verify'
    assert_includes out, 'the receipt does not match what was deployed'
    assert_includes out, "the receipt names edge version #{OTHER_VERSION}, this transcript names #{VERSION}"
    assert_includes out, 'NOT SATISFIED — unbound'
    restore(receipt)
    out, err, status = verify('--card', '1596', '--ac', 'AC5')
    assert status.success?, "the restored receipt must verify again: #{out}#{err}"
    assert_includes out, 'result: 1/1 criteria satisfied'
  end

  # The same mutation one document over. Either document could be the stale one,
  # so the check is symmetric: it compares, and neither is privileged.
  def test_a_transcript_that_names_another_version_goes_red_and_restores_green
    _out, err, status = recorded
    assert status.success?, err
    transcript = File.join(@dir, 'evidence.json')
    mutate(transcript) { |source| source.sub(VERSION, OTHER_VERSION) }
    out, _err, status = verify('--card', '1596', '--ac', 'AC5')
    refute status.success?, 'a transcript that names another version must not verify'
    assert_includes out, 'the receipt does not match what was deployed'
    restore(transcript)
    assert verify('--card', '1596', '--ac', 'AC5').last.success?, 'the restored transcript must verify again'
  end

  # Mutation 2: a credential-shaped value reaches the artifact. The guard names
  # the path and the rule; the value itself never reaches the log.
  def test_a_credential_shaped_value_in_the_artifact_turns_the_guard_red
    _out, err, status = recorded
    assert status.success?, err
    transcript = File.join(@dir, 'evidence.json')
    mutate(transcript) { |source| source.sub("\n  \"observed_at\"", "\n  \"leak\": \"#{GITHUB_TOKEN_SHAPE}\",\n  \"observed_at\"") }
    out, err, status = verify('--card', '1596', '--ac', 'AC5')
    refute status.success?, 'a credential-shaped value must fail the guard'
    assert_includes out + err, 'evidence.json.leak carries github-token'
    refute_includes out + err, GITHUB_TOKEN_SHAPE, 'the guard must never echo the value it found'
    restore(transcript)
    assert verify('--card', '1596', '--ac', 'AC5').last.success?, 'the restored artifact must verify again'
  end

  # The guard's second rule, for a value this process HOLDS: a Cloudflare Access
  # secret is a hex string no shape can tell from a digest, so the environment's
  # own credential values are compared by name.
  def test_a_declared_credential_value_in_the_artifact_turns_the_guard_red
    _out, err, status = recorded
    assert status.success?, err
    transcript = File.join(@dir, 'evidence.json')
    mutate(transcript) { |source| source.sub("\n  \"observed_at\"", "\n  \"leak\": \"#{DECLARED_TOKEN}\",\n  \"observed_at\"") }
    out, err, status = verify('--card', '1596', '--ac', 'AC5', env: { 'CLOUDFLARE_API_TOKEN' => DECLARED_TOKEN })
    refute status.success?
    assert_includes out + err, 'evidence.json.leak carries declared-credential:CLOUDFLARE_API_TOKEN'
    refute_includes out + err, DECLARED_TOKEN
    restore(transcript)
    assert verify('--card', '1596', '--ac', 'AC5').last.success?, 'the restored artifact must verify again'
  end

  # Mutation 3: the credential arrives as an object KEY rather than a value. A
  # recorded response can name a field after a token, so the guard scans keys
  # too — while the path it reports never quotes the key it found, for the key's
  # own finding OR for a finding beneath it (#1713 finding 1). The credential
  # under the credential-shaped key is what pins the second half: if the
  # descendant path kept the key, this run would echo it.
  def test_a_credential_shaped_key_in_the_artifact_turns_the_guard_red
    _out, err, status = recorded
    assert status.success?, err
    transcript = File.join(@dir, 'evidence.json')
    mutate(transcript) { |source| source.sub('"body_json": {', %("body_json": { "#{GITHUB_TOKEN_SHAPE}": { "nested": "#{GITHUB_TOKEN_SHAPE}" },)) }
    out, err, status = verify('--card', '1596', '--ac', 'AC5')
    refute status.success?, 'a credential-shaped KEY must fail the guard'
    assert_includes out + err, 'evidence.json.probes[0].observed.body_json.<key> carries github-token'
    assert_includes out + err, 'evidence.json.probes[0].observed.body_json.<key>.nested carries github-token'
    refute_includes out + err, GITHUB_TOKEN_SHAPE, 'the guard must never echo the key it found or a path under it'
    restore(transcript)
    assert verify('--card', '1596', '--ac', 'AC5').last.success?, 'the restored artifact must verify again'
  end

  # The same gap on the write side: the origin answers with a credential-shaped
  # body KEY, and the recorder must refuse to publish rather than hand the
  # artifact the guard exists to keep clean.
  def test_a_credential_shaped_response_key_stops_the_publish
    evidence_dir
    start_origin('secret-key')
    _out, err, status = record
    refute status.success?
    refute File.exist?(File.join(@dir, 'evidence.json')), 'a document carrying a credential must not be published'
    assert_match(/body_json\.<key> carries github-token/, err)
    refute_includes err, 'ghp_'
  end

  # The recorder's own guard, on the real data path: a response FIELD carrying a
  # credential stops the publish, and an honest origin publishes again.
  def test_a_credential_shaped_response_field_stops_the_publish_and_an_honest_origin_recovers
    evidence_dir
    start_origin('secret-header')
    _out, err, status = record
    refute status.success?
    refute File.exist?(File.join(@dir, 'evidence.json')), 'a document carrying a credential must not be published'
    assert_match(/cf_ray carries github-token/, err)
    refute_includes err, 'ghp_'
    kill_origin
    start_origin
    _out, err, status = record
    assert status.success?, err
    refute_includes File.read(File.join(@dir, 'evidence.json')), 'ghp_'
    assert verify('--card', '1596', '--ac', 'AC5').last.success?
  end
end
