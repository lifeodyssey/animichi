#!/usr/bin/env bash
# Delete the legacy migrator container application before its DO class deletion deploy.
set -euo pipefail
# shellcheck source=scripts/delivery/container-application-retirement.sh
source "$(dirname "${BASH_SOURCE[0]}")/container-application-retirement.sh"

environment="${1:-}"
config="${2:-release/migrator/wrangler.json}"

retired_application_name() {
  case "$environment" in
    staging) printf '%s\n' 'migrator-staging-migrationcontainer-staging' ;;
    production) printf '%s\n' 'migrator-production-migrationcontainer-production' ;;
    *) echo "unknown environment: $environment" >&2; return 1 ;;
  esac
}

application_name="$(retired_application_name)"
retire_container_application MigrationContainer "$application_name" "$environment" "$config"
