# frozen_string_literal: true
require 'json'
require 'open3'
require 'time'
require_relative '../../lib/release/receipt'
require_relative '../../lib/release/staged_receipt'

# Accepts the staging receipt an earlier cd.yml run published for the selected snapshot (ADR 0010),
# in two phases around the official download, which checks the artifact's digest itself:
#   metadata  before it: the artifact RECEIPT_ID names, its expiry and digest, and the cd.yml run
#             attempt on main that uploaded it. It records them and hands the download that run.
#             EXPECTED_DIGEST, when set, is the digest the select job saw, so the receipt accepted
#             after the production approval is the one verified before it.
#   content   after it: ReleaseReceipt.validate for that run and attempt, against this controller's
#             selection carrying the SHA of the controller staging ran, which this one must descend from.
# The transport is resolve.rb's.
STATE = 'staged-receipt.json'
ACTIONS = "repos/#{ReleaseSelection::REPOSITORY}/actions"

def github_api(path)
  output, status = Open3.capture2('gh', 'api', '-H', 'X-GitHub-Api-Version: 2026-03-10', path)
  abort 'staging receipt metadata is unavailable' unless status.success?
  JSON.parse(output)
end

def read_json(path)
  JSON.parse(File.read(path))
end

def producer_of(artifact, id)
  producer = StagedReceipt.validate_artifact(artifact, id: id, now: Time.now)
  run = github_api("#{ACTIONS}/runs/#{producer.fetch('run_id')}/attempts/#{producer.fetch('attempt')}")
  workflow = github_api("#{ACTIONS}/workflows/#{Integer(run.fetch('workflow_id'))}")
  StagedReceipt.validate_producer(run, workflow, ENV.fetch('GITHUB_REPOSITORY_ID'))
  producer
end

def metadata
  id = ENV.fetch('RECEIPT_ID')
  ReleaseSelection.require_value(id.match?(/\A[1-9]\d*\z/), 'invalid staging receipt artifact ID')
  artifact = github_api("#{ACTIONS}/artifacts/#{id}")
  staged = producer_of(artifact, id).merge('artifact_id' => id, 'digest' => artifact.fetch('digest'))
  expected = ENV['EXPECTED_DIGEST']
  abort 'staging receipt digest changed since selection' if expected && expected != staged.fetch('digest')
  File.write(STATE, JSON.pretty_generate(staged))
  File.open(ENV.fetch('GITHUB_OUTPUT'), 'a') { |file| %w[run_id digest].each { |key| file.puts("#{key}=#{staged.fetch(key)}") } }
end

def require_ancestor(controller)
  _, ancestry = Open3.capture2e('git', 'merge-base', '--is-ancestor', controller, ENV.fetch('GITHUB_SHA'))
  abort 'staging ran a controller outside this controller main history' unless ancestry.success?
end

def content
  staged = read_json(STATE)
  receipt = read_json('staging-receipt/receipt.json')
  ReleaseSelection.require_value(receipt.fetch('controller_run_attempt') == staged.fetch('attempt'), 'staging receipt attempt mismatch')
  expected = StagedReceipt.expected_selection(read_json('selection.json'), receipt)
  require_ancestor(expected.fetch('controller_sha'))
  images = read_json('release/release.json').fetch('images')
  prisma_ref = read_json('release/migrator/bundle/contract.json').fetch('storage').fetch('storageHash')
  ReleaseReceipt.validate(receipt, expected, images, run_id: staged.fetch('run_id'), attempt: staged.fetch('attempt'),
                                                     prisma_ref: prisma_ref)
end

case ARGV.fetch(0)
when 'metadata' then metadata
when 'content' then content
else abort 'usage: verify-staged-receipt.rb metadata|content'
end
