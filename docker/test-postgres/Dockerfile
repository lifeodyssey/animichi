# Lead-resolved immutable digest (2026-07-18).
# postgis/postgis:16-3.4 is amd64-only; arm64 developer machines run it emulated.
FROM --platform=linux/amd64 postgis/postgis:16-3.4@sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5

# 0.8.5 is the oldest-supported pgvector on the base's bullseye-pgdg feed
# (Neon branches run 0.8.1 — minor-version drift accepted; ACs assert capability, not version).
ARG PGVECTOR_APT_VERSION=0.8.5-1.pgdg11+1

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        "postgresql-16-pgvector=${PGVECTOR_APT_VERSION}" \
    && rm -rf /var/lib/apt/lists/*
