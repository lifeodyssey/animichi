# frozen_string_literal: true

require "yaml"

config = YAML.safe_load(File.read("codecov.yml"))
target = config.dig("coverage", "status", "patch", "default", "target")
informational = config.dig("coverage", "status", "patch", "default", "informational")

abort "Codecov patch target must remain 95%, got #{target.inspect}" unless target == "95%"
abort "Codecov patch status must be blocking" if informational == true

puts "Codecov patch policy: target=#{target}, informational=#{informational || false}"
