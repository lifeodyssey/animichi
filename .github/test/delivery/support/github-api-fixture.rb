# frozen_string_literal: true
# A `gh` for the release scripts' tests: `gh api <path>` answers from a JSON file the case wrote
# for exactly that path, and any other request fails, so a case serves the reads it means to and a
# read it did not plan is a refusal rather than a pass. `GH_EXIT` fails every call. A case can also
# move answers mid-run: once a given path has been read, later reads get the bodies it queued.
#
# Not a `*.test.rb`, so `workflow-invocations.test.rb` does not ask PR verification to invoke it;
# the contracts that use it `require_relative` it instead.
require "json"
require "fileutils"

module GithubApiFixture
  SCRIPT = <<~'SH'
    #!/usr/bin/env bash
    set -euo pipefail
    [ "${GH_EXIT:-0}" = 0 ] || exit "$GH_EXIT"
    [ "$1" = api ]
    answer="$(dirname "$0")/$(printf '%s' "${@: -1}" | tr -c 'A-Za-z0-9' '-')"
    cat "$answer.json"
    [ ! -d "$answer.then" ] || cp "$answer.then"/*.json "$(dirname "$0")/"
  SH

  module_function

  def install(directory)
    File.write(File.join(directory, "gh"), SCRIPT)
    File.chmod(0o755, File.join(directory, "gh"))
  end

  def serve(directory, path, body)
    File.write(answer(directory, path), body.to_json)
  end

  # From the read of `path` on, each later path answers with its new body, as a run that moves
  # between two reads would: an approval landing while a check is still listing runs.
  def serve_after(directory, path, later)
    moved = answer(directory, path).sub(/\.json\z/, ".then")
    FileUtils.mkdir_p(moved)
    later.each { |later_path, body| serve(moved, later_path, body) }
  end

  # The file that answers `path`.
  def answer(directory, path)
    File.join(directory, "#{path.gsub(/[^A-Za-z0-9]/, '-')}.json")
  end
end
