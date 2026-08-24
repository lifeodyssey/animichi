# frozen_string_literal: true

adapter = File.read(".github/scripts/promote-release-unit.sh")
export_at = adapter.index("pulumi stack export")
upload_at = adapter.index("aws s3 cp")
up_at = adapter.index("pulumi up")
abort "infra must export, upload, then apply" unless export_at && upload_at && up_at && export_at < upload_at && upload_at < up_at
abort "empty rollback snapshot must fail closed" unless adapter.include?("empty Pulumi rollback snapshot")
abort "Pulumi backend must be mandatory" unless adapter.include?("required PULUMI_BACKEND_URL")
abort "infra promotion must use the sealed Neon SDK" unless adapter.include?("sealed Neon provider SDK is missing")

cd = File.read(".github/workflows/cd.yml")
abort "foundation must precede migration" unless cd.index("stage-foundation:") < cd.index("stage-migration:")
abort "foundation must use staging protection" unless File.read(".github/workflows/reusable-promote-release-phase.yml").include?("environment: staging")

puts "Infrastructure safety contract: sealed provider and uploaded pre-apply rollback state"
