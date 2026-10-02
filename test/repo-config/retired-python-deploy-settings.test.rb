# SUT: the edge Worker's deploy config (`workers/edge/wrangler.toml`) and the
# runtime-secrets program (`infra/database-access/runtime-secrets.ts`), after
# issue #1750 retired every setting whose only consumer was the deleted Python
# agent (#1607): the zen/go key, the OpenAI-compatible base URL and key, the
# geocoding key, the Logfire token, the per-environment CORS var, the catalog
# base URL and the edge `APP_ENV`.
#
# Those consumers are gone, so a name that comes back is a declaration nothing
# reads: a secret the program would re-provision into the shared store, or a var
# the next reader mistakes for live configuration. Both files are scanned whole,
# so a reintroduction fails wherever it lands.
require "minitest/autorun"

class RetiredPythonDeploySettingsTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  RETIRED = %w[
    ZEN_GO_API_KEY
    GOOGLE_MAPS_API_KEY
    LOGFIRE_TOKEN
    OPENAI_COMPAT_BASE_URL
    OPENAI_COMPAT_API_KEY
    CORS_ALLOWED_ORIGIN
    CATALOG_API_URL
    APP_ENV
  ].freeze
  SCANNED = [
    "workers/edge/wrangler.toml",
    "infra/database-access/runtime-secrets.ts"
  ].freeze

  def setup
    refute_empty RETIRED, "the retired-name list must not be empty"
    SCANNED.each { |path| assert File.file?(File.join(ROOT, path)), "#{path} is missing from the scan" }
  end

  def test_no_retired_python_deploy_setting_comes_back
    offenders = SCANNED.flat_map { |path| named_lines(path) }
    assert_empty offenders,
                 "these lines reintroduce a setting whose only consumer was the retired Python agent " \
                 "(#1607, issue #1750). Nothing reads it, and a secret it names would be provisioned " \
                 "into the shared store again:\n  #{offenders.join("\n  ")}"
  end

  private

  def named_lines(path)
    File.read(File.join(ROOT, path)).each_line.with_index(1).filter_map do |line, number|
      names = RETIRED.select { |name| line.match?(/\b#{Regexp.escape(name)}\b/) }
      "#{path}:#{number}: #{names.join(', ')}" if names.any?
    end
  end
end
