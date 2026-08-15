# #1051 — one-shot Atlas migration container (Migration Executor).
#
# Official Atlas image as base plus the committed Neon migrations directory.
# The agent image is untouched (owner decision Q2): this is a separate, small,
# ephemeral batch image. Its only capability is "apply the committed chain";
# there is no schema drop, no arbitrary SQL, no down-migration.
#
# Version-aligned with the pinned Atlas CLI the deploy lanes used (v0.30.0),
# so the container's Atlas matches what CI previously invoked.
FROM arigaio/atlas:0.30.0

# The committed Neon migrations (the single Atlas authority).
COPY migrations/neon /migrations

# Wrapper: append search_path=public to the DSN (the reusable-deploy
# component's comment documents why — stray schemas like neon_auth / an
# orphaned atlas_schema_revisions schema must not trip Atlas's
# "database is not clean" check) and run the pinned apply to head.
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
