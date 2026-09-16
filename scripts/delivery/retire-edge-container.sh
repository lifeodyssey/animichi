#!/usr/bin/env bash
# Delete the retired edge container application before the deploy that removes the
# `RuntimeContainer` class it belonged to (#1605, the #1589 migrator shape).
set -euo pipefail
# shellcheck source=scripts/delivery/container-application-retirement.sh
source "$(dirname "${BASH_SOURCE[0]}")/container-application-retirement.sh"

environment="${1:-}"
config="${2:-release/edge/wrangler.json}"

# Wrangler resolves an environment ring's application name as
# `<script name>-<class name lowercased>-<environment>`; both names below are what
# `unstable_readConfig` resolves for the rings CD deploys, read against the config that
# still declared the container: `animichi-staging` and `[env.production] name = "animichi"`.
# They cannot be re-derived from the selected snapshot, which no longer declares it.
retired_application_name() {
  case "$environment" in
    staging) printf '%s\n' 'animichi-staging-runtimecontainer-staging' ;;
    production) printf '%s\n' 'animichi-runtimecontainer-production' ;;
    *) echo "unknown environment: $environment" >&2; return 1 ;;
  esac
}

application_name="$(retired_application_name)"
retire_container_application RuntimeContainer "$application_name" "$environment" "$config"
