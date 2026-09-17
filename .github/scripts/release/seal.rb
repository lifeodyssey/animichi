# frozen_string_literal: true
require 'json'
require_relative "../../lib/release/snapshot"
require_relative "../../lib/release/source_closure"

# #1606: no release unit carries a container any more (#1589 the migrator, #1605 the edge, whose
# container used the agent image), so this snapshot names no image. The key stays — the receipt
# binds it — and snapshot verification refuses any image named in it.
manifest = { 'format' => 1, 'kind' => 'full-snapshot', 'repository' => ENV.fetch('GITHUB_REPOSITORY'),
             'source_sha' => ENV.fetch('GITHUB_SHA'), 'run_id' => ENV.fetch('GITHUB_RUN_ID'),
             'run_attempt' => ENV.fetch('GITHUB_RUN_ATTEMPT'),
             'images' => {},
             'files' => ReleaseSnapshot.hashes('release') }
ReleaseSnapshot.validate('release', manifest, manifest)
ReleaseSourceClosure.validate(manifest.fetch('source_sha'), 'release')
File.write('release/release.json', JSON.pretty_generate(manifest))
