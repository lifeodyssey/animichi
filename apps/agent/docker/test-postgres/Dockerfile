# Lead-resolved immutable digest (2026-08-13) for postgis/postgis:18-3.6
# (PostgreSQL 18.4, amd64); arm64 developer machines run it emulated.
FROM --platform=linux/amd64 postgis/postgis@sha256:dd844a57310d76c6f7a9941568a573ecb9fe2d6afcb89ab008e5e096e759d314

# 0.8.5 is the pinned pgvector on the base's trixie-pgdg feed
# (Neon branches run 0.8.1 — minor-version drift accepted; ACs assert capability, not version).
ARG PGVECTOR_APT_VERSION=0.8.5-1.pgdg13+1

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        "postgresql-18-pgvector=${PGVECTOR_APT_VERSION}" \
    && rm -rf /var/lib/apt/lists/*

# Throwaway test database: run unprivileged; the postgres entrypoint supports
# starting directly as the postgres user (skips the root chown path).
USER postgres
