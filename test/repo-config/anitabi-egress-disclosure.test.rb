# SUT: what a reader of this PUBLIC repository can learn about the egress
# (#1792). Two facts must not be in the tree at all:
#
#   the signing key  — a value, in any form, including a placeholder default or
#                      a test fixture. Every key this repository's tests use is
#                      generated at run time.
#   the egress address — the asset. The upstream allowlists one address; the
#                      repository is public, so publishing it would announce
#                      which address holds that privilege.
#
# The address is pinned WITHOUT disclosing it: `check-egress-address.ts` reads
# the expected value from the operator's environment (`ANITABI_EGRESS_EXPECTED_IPV4`)
# and compares it against Fly. A hash in the tree was considered and rejected —
# the whole IPv4 space brute-forces in seconds, so a committed hash discloses
# the address while looking like it pins it.
require "minitest/autorun"

class AnitabiEgressDisclosureTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))

  # Where the address could leak: the service itself, and the runbook an
  # operator copies commands out of. Scanned rather than the whole tree,
  # because a version string or an SVG path in an unrelated file is not an
  # egress address and a contract that cannot tell them apart gets switched off.
  SCANNED = ["apps/anitabi-egress", "docs/ops/anitabi-egress.md"].freeze

  # RFC 5737 documentation ranges, plus the loopback and unspecified addresses a
  # test binds or calls — none of which is an egress address.
  DOCUMENTATION_RANGES = [/\A192\.0\.2\./, /\A198\.51\.100\./, /\A203\.0\.113\./, /\A127\./, /\A0\.0\.0\.0\z/].freeze
  IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/

  # A credential-shaped literal: no hyphens, no spaces, no words — a base64 or
  # hex key. A descriptive placeholder (`current-key-value-from-fly-secrets`)
  # is not a key and is not flagged; an actual key would be.
  SIGNING_KEY_ASSIGNMENT = /INGEST_SIGNING_KEY\w*\s*[:=]\s*["']([A-Za-z0-9+\/=]{24,})["']/
  # The one documented form that looks like an assignment but generates a value.
  KEY_GENERATOR = /openssl rand/

  def test_no_egress_address_is_committed
    offenders = scanned_files.flat_map { |path| addresses_in(path) }
    assert_empty(offenders,
                 "the egress address is the asset the upstream allowlists, and this repository is public. " \
                 "Keep it in the operator's environment (ANITABI_EGRESS_EXPECTED_IPV4) and read the live value " \
                 "from `fly ips list`; only RFC 5737 documentation addresses belong in tests:\n  " \
                 "#{offenders.join("\n  ")}")
  end

  def test_no_signing_key_value_is_committed
    offenders = scanned_files.flat_map { |path| key_values_in(path) }
    assert_empty(offenders,
                 "a signing key value must never be in the tree, in any form — not as a default, not as a " \
                 "fixture. Generate one in the test (`crypto.getRandomValues` / `randomBytes`) or read it " \
                 "from the environment:\n  #{offenders.join("\n  ")}")
  end

  def test_the_expected_address_comes_from_outside_the_tree
    check = File.read(File.join(ROOT, "apps/anitabi-egress/src/check-egress-address.ts"))
    guard = File.read(File.join(ROOT, "apps/anitabi-egress/src/egress-address-guard.ts"))
    assert_includes check, "process.env",
                    "the expected address must reach the guard from the operator's environment or CI secret"
    assert_includes guard, "EXPECTED_ADDRESS_VAR",
                    "the guard's subject is the environment-supplied address, not a committed one"
    assert_empty addresses_in_text(guard),
                 "the guard itself must carry no address — the address lives outside the tree"
  end

  def test_the_scanner_permits_a_documentation_address_and_flags_a_real_one
    assert_empty addresses_in_text('const EGRESS = "203.0.113.9";'),
                 "RFC 5737 documentation addresses are the only IPv4 literals these tests may carry"
    assert_equal ["203.0.114.9"], addresses_in_text('const EGRESS = "203.0.114.9";'),
                 "an address just outside the documentation ranges must be flagged — the scanner can fail"
  end

  private

  def scanned_files
    SCANNED.flat_map do |entry|
      path = File.join(ROOT, entry)
      File.file?(path) ? [entry] : Dir.glob(File.join(path, "**", "*")).map { |file| file.delete_prefix("#{ROOT}/") }
    end.reject { |path| path.split("/").include?("dist") || path.split("/").include?("node_modules") }
       .select { |path| File.file?(File.join(ROOT, path)) }
       .sort
  end

  def addresses_in(path)
    addresses_in_text(File.binread(File.join(ROOT, path)).force_encoding(Encoding::UTF_8).scrub)
      .map { |address| "#{path}: #{address}" }
  end

  # The scanner's own subject, over a string rather than a file.
  def addresses_in_text(text)
    text.scan(IPV4).reject { |address| DOCUMENTATION_RANGES.any? { |range| address.match?(range) } }
  end

  def key_values_in(path)
    text = File.binread(File.join(ROOT, path)).force_encoding(Encoding::UTF_8).scrub
    text.each_line.with_index(1).filter_map do |line, number|
      next if line.match?(KEY_GENERATOR)

      match = line.match(SIGNING_KEY_ASSIGNMENT)
      "#{path}:#{number}: a key-shaped literal" unless match.nil?
    end
  end

  def read(path)
    File.read(File.join(ROOT, path))
  end
end
