# pglayers/pglayers-full:18 ships PostgreSQL 18.6, PostGIS 3.6, and pgvector
# 0.8.6 in a single image maintained by the pglayers community project
# (github.com/pglayers/pglayers, MIT). The amd64 digest is pinned so that
# arm64 developer machines and CI run identical binaries (arm64 emulated).
FROM --platform=linux/amd64 ghcr.io/pglayers/pglayers-full@sha256:2b0e78218990a184fd3201f19a5c99ea070d31fa5b1be447d4fe0fe063941183

# The base image pre-loads age (Apache AGE graph extension) in
# shared_preload_libraries but does not CREATE EXTENSION it during init,
# which causes "schema ag_catalog does not exist" errors.  Strip it from the
# sample config so initdb produces a clean postgresql.conf.  Each pattern is
# anchored to the quote that bounds the list, so a library whose name merely
# ends in "age" cannot be matched.
RUN sed -i "/^shared_preload_libraries/s/'age,/'/; /^shared_preload_libraries/s/,age'/'/" \
      /usr/share/postgresql/18/postgresql.conf.sample

# Throwaway test database: run unprivileged; the postgres entrypoint supports
# starting directly as the postgres user (skips the root chown path).
USER postgres
