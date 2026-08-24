# frozen_string_literal: true

require "yaml"

EXPECTED = { "group" => "affected-cd-main", "cancel-in-progress" => false }.freeze
DEFAULTS = [".github/workflows/cd.yml", ".github/workflows/rollback.yml"].freeze

def validate_actionlint_queue!(paths = DEFAULTS)
  values = paths.map { |path| YAML.safe_load(File.read(path), aliases: true).fetch("concurrency") }
  values.each { |value| raise "concurrency must equal #{EXPECTED}" unless value == EXPECTED }
  raise "CD and rollback must share one concurrency group" unless values.map { |value| value["group"] }.uniq.one?
end

if $PROGRAM_NAME == __FILE__
  validate_actionlint_queue!
  puts "actionlint concurrency contract: native keys only, shared group, cancellation disabled"
end
