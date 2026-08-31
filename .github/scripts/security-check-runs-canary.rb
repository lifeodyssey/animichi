#!/usr/bin/env ruby
# frozen_string_literal: true

# Explicit live canary for the Security required check. The normal CI contract
# tests require this file but only pass it a checked-in fixture; this executable
# is intentionally the only path that contacts GitHub.

require "json"
require "net/http"
require "uri"

module SecurityCheckRunsCanary
  API_VERSION = "2022-11-28"
  CI_CONTEXTS = ["PR Verification", "Security"].freeze
  PAGE_SIZE = 100
  MAX_PAGES = 100
  REPOSITORY_PATTERN = /\A[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\z/
  SHA_PATTERN = /\A[0-9a-f]{40}\z/
  ACTIONABLE_PATHS = %r{/(?:actions/runs|runs|checks)/}

  class Failure < StandardError; end

  def self.fail!(message)
    raise Failure, "Security canary: #{message}"
  end

  def self.sha?(value)
    value.is_a?(String) && value.match?(SHA_PATTERN)
  end

  def self.assert!(payload, repo:, expected_sha:, required_contexts: nil)
    contexts = required_contexts || payload.fetch("required_contexts")
    assert_required_contexts(contexts)
    assert_check_runs(payload.fetch("check_runs"), repo, expected_sha)
  rescue KeyError => error
    fail!("payload is missing #{error.key.inspect}")
  end

  def self.assert_required_contexts(contexts)
    actual = Array(contexts)
    expected = CI_CONTEXTS
    return if actual == expected

    fail!("required contexts must be exactly #{expected.join(', ')}, got #{actual.inspect}")
  end

  def self.assert_check_runs(check_runs, repo, expected_sha)
    CI_CONTEXTS.each do |context|
      runs = Array(check_runs).select { |run| run["name"] == context }
      fail!("expected exactly one #{context} check run, got #{runs.size}") unless runs.size == 1
      assert_required_run(runs.first, context, repo, expected_sha)
    end
  end

  def self.assert_required_run(run, context, repo, expected_sha)
    fail!("#{context} head does not match #{expected_sha}") unless run["head_sha"] == expected_sha
    fail!("#{context} is not completed successfully") unless successful?(run)
    assert_actionable_links(run, context, repo)
  end

  def self.successful?(run)
    run["status"] == "completed" && run["conclusion"] == "success"
  end

  def self.assert_actionable_links(run, context, repo)
    %w[details_url html_url].each { |key| assert_url(run[key], context, repo, key) }
    summary = run.dig("output", "summary").to_s
    fail!("#{context} summary is empty") if summary.empty?

    links = summary.scan(%r{https://[^)\s>]+})
    fail!("#{context} summary has no actionable evidence link") unless links.any? { |url| actionable_url?(url, repo) }
  end

  def self.assert_url(url, context, repo, label)
    fail!("#{context} #{label} is missing") unless actionable_url?(url, repo)
  end

  def self.actionable_url?(url, repo)
    uri = URI.parse(url.to_s)
    uri.scheme == "https" && uri.host == "github.com" && uri.path.start_with?("/#{repo}/") && uri.path.match?(ACTIONABLE_PATHS)
  rescue URI::InvalidURIError
    false
  end

  def self.run_live!(repo, target, token: ENV["GH_TOKEN"], client: nil)
    validate_repo!(repo)
    api = client || ApiClient.new(token)
    head_sha = resolve_head(api, repo, target)
    payload = live_payload(api, repo, head_sha)
    assert!(payload, repo: repo, expected_sha: head_sha)
    puts "CI canary: #{repo} #{head_sha} has successful direct required CI checks"
    head_sha
  end

  def self.validate_repo!(repo)
    return if repo.is_a?(String) && repo.match?(REPOSITORY_PATTERN)

    fail!("repository must be OWNER/REPOSITORY")
  end

  def self.resolve_head(api, repo, target)
    return verify_commit(api, repo, target) if sha?(target)

    number = Integer(target, 10)
    fail!("pull request number must be positive") unless number.positive?
    pr = api.get("/repos/#{repo}/pulls/#{number}")
    sha = pr.dig("head", "sha")
    fail!("pull request #{number} did not return a full head SHA") unless sha?(sha)
    sha
  rescue ArgumentError
    fail!("target must be a pull request number or 40-character head SHA")
  end

  def self.verify_commit(api, repo, sha)
    api.get("/repos/#{repo}/commits/#{sha}")
    sha
  end

  def self.live_payload(api, repo, sha)
    checks = paginated_collection(api, "/repos/#{repo}/commits/#{sha}/check-runs?per_page=#{PAGE_SIZE}",
                                  label: "check-runs", key: "check_runs")
    contexts = required_contexts(api, repo)
    { "check_runs" => checks, "required_contexts" => contexts }
  end

  def self.required_contexts(api, repo)
    summaries = paginated_collection(api, "/repos/#{repo}/rulesets?includes_parents=true&per_page=#{PAGE_SIZE}",
                                     label: "ruleset summaries", key: "rulesets")
    active = summaries.select { |ruleset| ruleset["enforcement"] == "active" }
    active.flat_map { |ruleset| ruleset_contexts(api, repo, ruleset.fetch("id")) }
  end

  def self.paginated_collection(api, path, label:, key: nil)
    page = 1
    values = []
    loop do
      payload = api.get(page == 1 ? path : "#{path}&page=#{page}")
      page_values = extract_page_values(payload, label, key)
      values.concat(page_values)
      break if page_values.size < PAGE_SIZE

      page += 1
      fail!("#{label} pagination exceeded #{MAX_PAGES} pages") if page > MAX_PAGES
    end
    values
  end

  def self.extract_page_values(payload, label, key)
    page_values = key && payload.is_a?(Hash) ? payload[key] : payload
    fail!("#{label} response is missing #{key.inspect}") if key && payload.is_a?(Hash) && page_values.nil?
    fail!("#{label} response is not an array") unless page_values.is_a?(Array)

    page_values
  end

  def self.ruleset_contexts(api, repo, id)
    ruleset = api.get("/repos/#{repo}/rulesets/#{id}")
    Array(ruleset["rules"]).select { |rule| rule["type"] == "required_status_checks" }.flat_map do |rule|
      parameters = rule["parameters"] || {}
      entries = parameters["required_status_checks"] || parameters["contexts"] || []
      entries.map { |entry| entry.is_a?(Hash) ? entry["context"] : entry }.compact
    end
  end

  def self.main(argv)
    if argv == ["--help"]
      puts "usage: security-check-runs-canary.rb REPOSITORY PR_NUMBER|HEAD_SHA"
      return 0
    end
    fail!("expected REPOSITORY and PR_NUMBER|HEAD_SHA") unless argv.size == 2
    run_live!(argv.fetch(0), argv.fetch(1))
    0
  rescue Failure => error
    warn error.message
    1
  end

  class ApiClient
    def initialize(token)
      SecurityCheckRunsCanary.fail!("GH_TOKEN is required for live mode") if token.to_s.empty?
      @token = token
    end

    def get(path)
      response = request(path)
      SecurityCheckRunsCanary.fail!("GitHub API #{path} returned #{response.code}") unless response.is_a?(Net::HTTPSuccess)
      JSON.parse(response.body)
    rescue JSON::ParserError => error
      SecurityCheckRunsCanary.fail!("GitHub API returned invalid JSON: #{error.message}")
    end

    private

    def request(path)
      uri = URI("https://api.github.com#{path}")
      request = Net::HTTP::Get.new(uri)
      request["Accept"] = "application/vnd.github+json"
      request["Authorization"] = "Bearer #{@token}"
      request["X-GitHub-Api-Version"] = API_VERSION
      Net::HTTP.start(uri.host, uri.port, use_ssl: true) { |http| http.request(request) }
    rescue StandardError => error
      raise if error.is_a?(SecurityCheckRunsCanary::Failure)

      SecurityCheckRunsCanary.fail!("GitHub API request failed: #{error.message}")
    end
  end
end

exit SecurityCheckRunsCanary.main(ARGV) if $PROGRAM_NAME == __FILE__
