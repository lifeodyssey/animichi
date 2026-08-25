# frozen_string_literal: true

require "json"

manifest = JSON.parse(File.read(".github/ci/components.json"))
components = manifest.fetch("components")
names = components.map { |component| component.fetch("name") }
abort "component names must be unique" unless names.uniq == names
abort "retired doorbell must not be routable" if names.include?("doorbell")
abort "every deploy unit must have an owned path" unless components.all? { |component| component.fetch("deploy_unit").nil? || component.fetch("paths").any? }

cd = File.read(".github/workflows/cd.yml")
abort "CD must route through the canonical change graph" unless cd.include?("change-plan.py") && cd.include?("cd-cohort-plan.py")
abort "CD must exclude CI-only test triggers" unless cd.include?("--purpose deploy")
abort "CD must deploy only the selected release matrix" unless cd.include?("needs.route.outputs.deploy_units")

puts "Affected CD routing contract: canonical component graph selects the deploy cohort"
