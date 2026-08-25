# frozen_string_literal: true

require "tmpdir"
require "yaml"
require_relative "actionlint-queue-contract"

def reject_mutation(label)
  Dir.mktmpdir("queue-contract") do |dir|
    paths = DEFAULTS.map { |path| File.join(dir, File.basename(path)) }
    DEFAULTS.zip(paths).each { |source, target| File.write(target, File.read(source)) }
    yield paths
    validate_actionlint_queue!(paths)
    abort "#{label} passed unexpectedly"
  rescue RuntimeError
    puts "PASS: #{label} rejected"
  end
end

def mutate(path, key, value)
  data = YAML.safe_load(File.read(path), aliases: true)
  data.fetch("concurrency")[key] = value
  File.write(path, YAML.dump(data))
end

reject_mutation("unsupported queue key") { |paths| mutate(paths.first, "queue", "max") }
reject_mutation("cancellation enabled") { |paths| mutate(paths.last, "cancel-in-progress", true) }
reject_mutation("group split") { |paths| mutate(paths.last, "group", "rollback-only") }
validate_actionlint_queue!
puts "PASS: pristine native concurrency contract"
