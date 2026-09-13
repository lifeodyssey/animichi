# SUT: .gitleaks.toml and its default-rule inheritance.
# CI parity comes only from these exact Ruby invocations in
# `.github/workflows/pr-verification.yml`: `ruby test/repo-config/gitleaks-mutation.test.rb`
# and `ruby test/repo-config/gitleaks.test.rb`; `quality.sh` was retired on this base.
# Regex and stopword checks see only the finite probe shapes declared below.
# `.gitleaksignore`, inline `gitleaks:allow`, and allowlist `commits` are out of
# scope by design.
require "minitest/autorun"

class GitleaksConfigTest < Minitest::Test
  ROOT = File.expand_path("../..", __dir__)
  CONFIG = ENV.fetch("GITLEAKS_CONFIG", File.join(ROOT, ".gitleaks.toml"))
  CONSEQUENCE = 'gitleaks runs with zero rules and reports "no leaks found" for every secret'
  ABSENT = "gitleaks falls back to its default rules and loses the atlas.sum allowlist this file exists for"
  DISABLED = 'the named rules stop running and gitleaks reports "no leaks found" for the secrets they catch'
  REDEFINED = "redefining that inherited rule can stop it from reporting the secrets it is meant to catch"
  EXEMPTED = 'every matching file is exempt from every rule and gitleaks reports "no leaks found" for its secrets'
  HIDDEN = 'the matching secrets are dropped before they are reported, whatever rule found them'
  SILENCED = 'every secret containing it is dropped, silencing that rule class at any entropy'

  # Snapshot of the 222 IDs in gitleaks v8.30.1's bundled default config.
  # Source: https://github.com/gitleaks/gitleaks/blob/v8.30.1/config/gitleaks.toml
  DEFAULT_RULE_IDS = %w[
    1password-secret-key 1password-service-account-token adafruit-api-key
    adobe-client-id adobe-client-secret age-secret-key airtable-api-key
    airtable-personnal-access-token algolia-api-key alibaba-access-key-id
    alibaba-secret-key anthropic-admin-api-key anthropic-api-key artifactory-api-key
    artifactory-reference-token asana-client-id asana-client-secret atlassian-api-token
    authress-service-client-access-key aws-access-token aws-amazon-bedrock-api-key-long-lived
    aws-amazon-bedrock-api-key-short-lived azure-ad-client-secret beamer-api-token
    bitbucket-client-id bitbucket-client-secret bittrex-access-key bittrex-secret-key
    cisco-meraki-api-key clickhouse-cloud-api-secret-key clojars-api-token
    cloudflare-api-key cloudflare-global-api-key cloudflare-origin-ca-key codecov-access-token
    cohere-api-token coinbase-access-token confluent-access-token confluent-secret-key
    contentful-delivery-api-token curl-auth-header curl-auth-user databricks-api-token
    datadog-access-token defined-networking-api-token digitalocean-access-token
    digitalocean-pat digitalocean-refresh-token discord-api-token discord-client-id
    discord-client-secret doppler-api-token droneci-access-token dropbox-api-token
    dropbox-long-lived-api-token dropbox-short-lived-api-token duffel-api-token
    dynatrace-api-token easypost-api-token easypost-test-api-token etsy-access-token
    facebook-access-token facebook-page-access-token facebook-secret fastly-api-token
    finicity-api-token finicity-client-secret finnhub-access-token flickr-access-token
    flutterwave-encryption-key flutterwave-public-key flutterwave-secret-key flyio-access-token
    frameio-api-token freemius-secret-key freshbooks-access-token gcp-api-key
    generic-api-key github-app-token github-fine-grained-pat github-oauth github-pat
    github-refresh-token gitlab-cicd-job-token gitlab-deploy-token
    gitlab-feature-flag-client-token gitlab-feed-token gitlab-incoming-mail-token
    gitlab-kubernetes-agent-token gitlab-oauth-app-secret gitlab-pat gitlab-pat-routable
    gitlab-ptt gitlab-rrt gitlab-runner-authentication-token
    gitlab-runner-authentication-token-routable gitlab-scim-token gitlab-session-cookie
    gitter-access-token gocardless-api-token grafana-api-key grafana-cloud-api-token
    grafana-service-account-token harness-api-key hashicorp-tf-api-token
    hashicorp-tf-password heroku-api-key heroku-api-key-v2 hubspot-api-key
    huggingface-access-token huggingface-organization-api-token infracost-api-token
    intercom-api-key intra42-client-secret jfrog-api-key jfrog-identity-token jwt jwt-base64
    kraken-access-token kubernetes-secret-yaml kucoin-access-token kucoin-secret-key
    launchdarkly-access-token linear-api-key linear-client-secret linkedin-client-id
    linkedin-client-secret lob-api-key lob-pub-api-key looker-client-id looker-client-secret
    mailchimp-api-key mailgun-private-api-token mailgun-pub-key mailgun-signing-key
    mapbox-api-token mattermost-access-token maxmind-license-key messagebird-api-token
    messagebird-client-id microsoft-teams-webhook netlify-access-token
    new-relic-browser-api-token new-relic-insert-key new-relic-user-api-id
    new-relic-user-api-key notion-api-token npm-access-token nuget-config-password
    nytimes-access-token octopus-deploy-api-key okta-access-token openai-api-key
    openshift-user-token perplexity-api-key pkcs12-file plaid-api-token plaid-client-id
    plaid-secret-key planetscale-api-token planetscale-oauth-token planetscale-password
    postman-api-token prefect-api-token private-key privateai-api-token pulumi-api-token
    pypi-upload-token rapidapi-access-token readme-api-token rubygems-api-token
    scalingo-api-token sendbird-access-id sendbird-access-token sendgrid-api-token
    sendinblue-api-token sentry-access-token sentry-org-token sentry-user-token
    settlemint-application-access-token settlemint-personal-access-token
    settlemint-service-access-token shippo-api-token shopify-access-token
    shopify-custom-access-token shopify-private-app-access-token shopify-shared-secret
    sidekiq-secret sidekiq-sensitive-url slack-app-token slack-bot-token
    slack-config-access-token slack-config-refresh-token slack-legacy-bot-token
    slack-legacy-token slack-legacy-workspace-token slack-user-token slack-webhook-url
    snyk-api-token sonar-api-token sourcegraph-access-token square-access-token
    squarespace-access-token stripe-access-token sumologic-access-id sumologic-access-token
    telegram-bot-api-token travisci-access-token twilio-api-key twitch-api-token
    twitter-access-secret twitter-access-token twitter-api-key twitter-api-secret
    twitter-bearer-token typeform-api-token vault-batch-token vault-service-token
    yandex-access-token yandex-api-key yandex-aws-access-token zendesk-secret-key
  ].freeze

  SCANNED = [".", ".env", "workers/edge/src/entry.ts"].freeze

  PROBE_BODY = "QWERTYUIOPASDFGHJKLZXCVBNM0123456789"

  REPORTABLE = [
    "ghp_#{PROBE_BODY}",
    "AKIA#{PROBE_BODY[0, 16]}",
    "glpat-#{PROBE_BODY[0, 20]}",
    "AIzaSy#{PROBE_BODY[0, 33]}"
  ].freeze

  LITERAL = /'''(.*?)'''|"""(.*?)"""|'([^']*)'|"((?:[^"\\]|\\.)*)"/m

  def tables(path)
    current = nil
    File.readlines(path, chomp: true).each_with_object({}) do |raw, grouped|
      line = raw.strip
      next if line.empty? || line.start_with?("#")

      header = line[/\A\[\[?\s*([^\[\]]+?)\s*\]\]?\z/, 1]
      current = header || current
      grouped[current] ||= []
      grouped[current] << line unless header
    end
  end

  def allowlist_lines(config)
    config.select { |table, _| table.to_s.split(".").last.to_s.start_with?("allowlist") }
          .values.flatten
  end

  def allowlist_values(config, key)
    keyed = /^#{Regexp.escape(key)}\s*=\s*\[(.*?)\]/m
    arrays = allowlist_lines(config).join("\n").scan(keyed).flatten
    arrays.flat_map { |array| array.scan(LITERAL).flat_map(&:compact) }
  end

  def exempts_scanned_paths?(pattern)
    regexp = Regexp.new(pattern)
    SCANNED.any? { |path| regexp.match?(path) }
  end

  def hides_reported_secret?(pattern)
    regexp = Regexp.new(pattern)
    REPORTABLE.any? { |secret| regexp.match?(secret) }
  end

  def silences_reported_secret?(stopword)
    REPORTABLE.any? { |secret| secret.downcase.include?(stopword.downcase) }
  end

  def redefined_default_rule(config)
    config.fetch("rules", []).find do |line|
      id = line[/\Aid\s*=\s*["']([^"']+)["']/, 1]
      id && DEFAULT_RULE_IDS.include?(id)
    end
  end

  def setup
    assert File.file?(CONFIG), "#{CONFIG} is missing — #{ABSENT}"
    @config = tables(CONFIG)
  end

  def test_default_rules_remain_enabled
    assert @config.key?("extend"), "#{CONFIG}: no [extend] table — #{CONSEQUENCE}"
    assignment = @config.fetch("extend").find { |line| line.match?(/\AuseDefault\s*=/) }
    refute_nil assignment, "#{CONFIG}: [extend] never sets useDefault — #{CONSEQUENCE}"
    assert_match(/\AuseDefault\s*=\s*true\s*(#.*)?\z/, assignment,
                 "#{CONFIG}: [extend] must set useDefault = true — #{CONSEQUENCE}")
  end

  def test_no_inherited_rule_is_disabled
    disabled = @config.fetch("extend", []).find { |line| line.match?(/\AdisabledRules\s*=/) }
    assert_nil disabled, "#{CONFIG}: [extend] drops inherited rules — #{DISABLED}"
  end

  def test_no_default_rule_is_redefined
    redefined = redefined_default_rule(@config)
    assert_nil redefined, "#{CONFIG}: #{redefined} — #{REDEFINED}"
  end

  def test_allowlist_does_not_exempt_scanned_paths
    exempted = allowlist_values(@config, "paths").find { |pattern| exempts_scanned_paths?(pattern) }
    assert_nil exempted, "#{CONFIG}: allowlist path #{exempted.inspect} — #{EXEMPTED}"
  end

  def test_allowlist_does_not_hide_reported_values
    hidden = allowlist_values(@config, "regexes").find { |pattern| hides_reported_secret?(pattern) }
    assert_nil hidden, "#{CONFIG}: allowlist regex #{hidden.inspect} — #{HIDDEN}"
  end

  def test_allowlist_does_not_silence_rule_classes
    silenced = allowlist_values(@config, "stopwords").find { |word| silences_reported_secret?(word) }
    assert_nil silenced, "#{CONFIG}: allowlist stopword #{silenced.inspect} — #{SILENCED}"
  end
end
