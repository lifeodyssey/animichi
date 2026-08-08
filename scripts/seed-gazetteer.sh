#!/usr/bin/env bash
# Loads the gazetteer seed (geonames + MLIT station data) into a database
# whose schema already exists. The seed SQL is generated output
# (workers/catalog/data/gazetteer_seed.sql) and idempotent by construction
# (INSERT ... ON CONFLICT DO NOTHING), so re-running is a no-op.
#
# Usage: DATABASE_URL=postgres://... scripts/seed-gazetteer.sh
#   DATABASE_URL must target a database with the locations/location_aliases
#   schema applied (Atlas migrations/neon chain) — the seed never creates
#   schema. See docs/data-sources.md for provenance and regeneration.
set -euo pipefail
umask 077

readonly SEED_REL="workers/catalog/data/gazetteer_seed.sql"

die() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

: "${DATABASE_URL:?DATABASE_URL is required}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT
readonly SEED_FILE="$ROOT/$SEED_REL"
[[ -f "$SEED_FILE" ]] || die "seed file not found: $SEED_REL"
for command in psql python3; do
  command -v "$command" >/dev/null 2>&1 || die "required command not found: $command"
done

# Credential hygiene: never put the DSN (which embeds the password) on a
# process argv. Derive a pg_service.conf + pgpass like scripts/neon-test-base.sh
# does, then connect by service name only.
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
PGSERVICEFILE="$TMP_DIR/pg_service.conf"
PGPASSFILE="$TMP_DIR/pgpass"
: >"$PGSERVICEFILE"
: >"$PGPASSFILE"
chmod 600 "$PGSERVICEFILE" "$PGPASSFILE"
export PGSERVICEFILE PGPASSFILE

python3 - "$PGSERVICEFILE" "$PGPASSFILE" <<'PY'
import os
import pathlib
import sys
import urllib.parse

service_path, pass_path = sys.argv[1:]
parsed = urllib.parse.urlparse(os.environ["DATABASE_URL"])
host = parsed.hostname or ""
port = parsed.port or 5432
database = urllib.parse.unquote(parsed.path.lstrip("/"))
user = urllib.parse.unquote(parsed.username or "")
password = urllib.parse.unquote(parsed.password or "")
query = urllib.parse.parse_qs(parsed.query)
sslmode = query.get("sslmode", ["require"])[0]
if not all((host, database, user, password)):
    raise SystemExit("database URI omitted a required connection field")
with pathlib.Path(service_path).open("a", encoding="utf-8") as config:
    config.write(
        f"[gazetteer-seed]\nhost={host}\nport={port}\ndbname={database}\n"
        f"user={user}\nsslmode={sslmode}\n"
    )
escape = lambda value: value.replace("\\", "\\\\").replace(":", "\\:")
with pathlib.Path(pass_path).open("a", encoding="utf-8") as password_file:
    fields = (host, str(port), database, user, password)
    password_file.write(":".join(escape(value) for value in fields) + "\n")
PY

psql -X --set=ON_ERROR_STOP=1 "service=gazetteer-seed" --file="$SEED_FILE" >/dev/null
printf 'PASS gazetteer seed loaded (idempotent; see %s)\n' "$SEED_REL"
